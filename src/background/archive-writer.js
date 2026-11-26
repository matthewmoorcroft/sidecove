import { ARCHIVE_MESSAGE, ARCHIVED_TABS_KEY } from '../shared/archive-client.js';
import { Logger } from '../shared/logger.js';
import { addEntry, removeEntry } from './archive-list.js';

// The service worker is the only writer of the archive, as it is of spaces. Auto-archive, the
// panels' Archive and Clear, and every restore change it through one queue, and each change
// reads the stored list afresh: two changes at once cannot overwrite each other, and a worker
// that stops between two changes loses nothing.
export function createArchiveWriter({ chromeApi = chrome, spaceStore, now = Date.now }) {
    // The store's first load can rewrite the space ids in the archive, so changes wait for it.
    let chain = spaceStore.run(() => {}).catch(() => {});
    const run = operation => {
        const pending = chain.then(async () => {
            const stored = await chromeApi.storage.local.get(ARCHIVED_TABS_KEY);
            return operation(stored?.[ARCHIVED_TABS_KEY] || []);
        });
        chain = pending.catch(error => Logger.warn('[Archive] A change failed:', error));
        return pending;
    };
    const save = list => chromeApi.storage.local.set({ [ARCHIVED_TABS_KEY]: list });

    async function store(list, entry) {
        const result = addEntry(list, entry, now());
        if (result.stored) {
            await save(result.list);
            Logger.log(`Archived tab: ${entry.name} from space ${entry.spaceId}`);
        }
        return result;
    }

    const add = entry =>
        run(async list => {
            const { stored, list: tabs } = await store(list, entry);
            return { stored, tabs };
        });

    const remove = (url, spaceId) =>
        run(async list => {
            if (!url || !spaceId) return { tabs: list };
            const tabs = removeEntry(list, url, spaceId);
            if (tabs.length !== list.length) await save(tabs);
            return { tabs };
        });

    // Archives an open tab under the space that lists it, then closes it.
    const archiveTab = tabId =>
        run(async list => {
            const tab = await chromeApi.tabs.get(tabId);
            const spaces = await spaceStore.dispatch({ action: 'get' });
            const space = spaces.find(s => [...s.spaceBookmarks, ...s.temporaryTabs].includes(tabId));
            if (!tab || !space) return { tabs: list };
            const { list: tabs } = await store(list, { url: tab.url, name: tab.title, spaceId: space.id });
            await chromeApi.tabs.remove(tabId);
            return { tabs };
        });

    // Reopens an archived page in its space and takes it out of the archive.
    const restore = (entry, windowId) =>
        run(async list => {
            const tab = await chromeApi.tabs.create({
                url: entry.url,
                active: true,
                ...(windowId ? { windowId } : {})
            });
            await spaceStore.dispatch({ action: 'assign', tabId: tab.id, spaceId: entry.spaceId });
            const tabs = removeEntry(list, entry.url, entry.spaceId);
            await save(tabs);
            return { tab, tabs };
        });

    return { add, remove, archiveTab, restore };
}

// The worker's archive, and the messages the panels change it with.
export function registerArchive({ chromeApi = chrome, spaceStore }) {
    const writer = createArchiveWriter({ chromeApi, spaceStore });
    const actions = {
        add: message => writer.add(message.entry),
        remove: message => writer.remove(message.url, message.spaceId),
        archiveTab: message => writer.archiveTab(message.tabId),
        restore: message => writer.restore(message.entry, message.windowId)
    };
    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== ARCHIVE_MESSAGE || !actions[message.action]) return;
        actions[message.action](message).then(
            result => sendResponse({ success: true, ...result }),
            error => sendResponse({ success: false, error: error.message })
        );
        return true;
    });
    return writer;
}
