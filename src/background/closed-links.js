import {
    CLOSED_LINKS_KEY,
    CLOSED_LINKS_MESSAGE,
    addLinks,
    archiveEntryOf,
    clearSpace,
    linkForClosedTab,
    linksFrom,
    openPagesOf,
    splitIdle,
    withoutDeletedSpaces,
    withoutLink,
    withoutPage
} from '../shared/closed-links.js';
import { pageOf } from '../shared/saved-favorites.js';
import { Logger } from '../shared/logger.js';
import { Utils } from '../shared/utils.js';

// What the worker last knew of each open tab, kept for the browser session so a tab that closes
// with its window can still be named after the worker slept: Chrome reports only its id then.
const TAB_INFO_KEY = 'closedLinkTabInfo';
const SAVE_DELAY_MS = 300;

// Keeps the links a closed window leaves behind (see shared/closed-links.js). The worker is the
// only writer; panels ask through CLOSED_LINKS_MESSAGE. Nothing in `run` calls the space store,
// because the store waits for this module when a tab closes and would wait for itself.
export function registerClosedLinks({
    chromeApi = chrome,
    spaceStore,
    addArchivedTab = entry => Utils.addArchivedTab(entry),
    removeArchivedTab = (url, spaceId) => Utils.removeArchivedTab(url, spaceId),
    now = Date.now,
    newId = () => crypto.randomUUID(),
    schedule = setTimeout
} = {}) {
    let links = [];
    let tabInfo = new Map();
    let loading;
    let chain = Promise.resolve();
    let saveTimer = null;

    const run = operation => {
        const pending = chain.then(async () => {
            await (loading ||= load().catch(error => {
                loading = null;
                throw error;
            }));
            return operation();
        });
        chain = pending.catch(error => Logger.error('Closed links update failed:', error));
        return pending;
    };

    const noteTab = tab => {
        if (tab?.id == null) return;
        const url = pageOf(tab);
        const known = tabInfo.get(tab.id);
        const next = {
            url: url || known?.url || '',
            title: tab.title || (url === known?.url ? known?.title : '') || '',
            incognito: Boolean(tab.incognito)
        };
        if (known && known.url === next.url && known.title === next.title && known.incognito === next.incognito) return;
        tabInfo.set(tab.id, next);
        saveTabInfoSoon();
    };

    function saveTabInfoSoon() {
        if (saveTimer) return;
        saveTimer = schedule(() => {
            saveTimer = null;
            chromeApi.storage.session
                .set({ [TAB_INFO_KEY]: [...tabInfo] })
                .catch(error => Logger.warn('Could not save the tab names for closed links:', error));
        }, SAVE_DELAY_MS);
    }

    async function load() {
        const [local, session, tabs] = await Promise.all([
            chromeApi.storage.local.get(CLOSED_LINKS_KEY),
            chromeApi.storage.session.get(TAB_INFO_KEY),
            chromeApi.tabs.query({})
        ]);
        links = linksFrom(local);
        tabInfo = new Map(session[TAB_INFO_KEY] || []);
        // Names of tabs that are gone are kept: a worker woken by a window closing finds that window's
        // tabs already gone, and these names are all it has to make their links. Each is dropped as
        // its tab's removal is reported.
        for (const tab of tabs) noteTab(tab);
        // Pages already open (Chrome restored them while the worker was not running) have used up
        // their links.
        const pages = openPagesOf(tabs);
        const rest = links.filter(link => !pages.has(link.url));
        if (rest.length !== links.length) {
            links = rest;
            await save();
        }
    }

    const save = () => chromeApi.storage.local.set({ [CLOSED_LINKS_KEY]: links });

    async function toArchived(entries) {
        const results = [];
        for (const link of entries) {
            const added = await addArchivedTab(archiveEntryOf(link)).catch(error => {
                Logger.warn('Could not archive a link:', error);
                return false;
            });
            results.push({ link, addedToArchive: added === true });
        }
        return results;
    }

    // A tab closed. The space store calls this for every closing tab, in order, with the record
    // it kept of a tab that closed with its window.
    function onTabRemoved({ tabId, info, record }) {
        return run(async () => {
            const tab = tabInfo.get(tabId);
            tabInfo.delete(tabId);
            saveTabInfoSoon();
            if (!record) return;
            // A page that is open in a window that stays is not closed: it stays a tab there.
            const others = (await chromeApi.tabs.query({})).filter(other => other.windowId !== info?.windowId);
            const link = linkForClosedTab({
                record,
                tab,
                openElsewhere: openPagesOf(others).has(tab?.url),
                windowId: info?.windowId,
                links,
                now: now(),
                newId
            });
            if (!link) return;
            const added = addLinks(links, [link]);
            links = added.links;
            await save();
            await toArchived(added.overflow);
        });
    }

    // A page opened in any window uses up its link, so a tab Chrome restores does not leave the
    // link behind, and closing that tab later does not bring the link back.
    const opened = tab =>
        run(async () => {
            noteTab(tab);
            if (tab.incognito) return;
            const page = pageOf(tab);
            if (!page || !links.some(link => link.url === page)) return;
            links = withoutPage(links, page);
            await save();
        });

    chromeApi.tabs.onCreated.addListener(tab => opened(tab));
    chromeApi.tabs.onUpdated.addListener((id, change, tab) => {
        if (change.url || change.title) opened(tab);
    });
    chromeApi.tabs.onReplaced.addListener((added, removed) =>
        run(async () => {
            tabInfo.delete(removed);
            noteTab(await chromeApi.tabs.get(added).catch(() => null));
        })
    );
    chromeApi.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.spaces) return;
        run(async () => {
            const rest = withoutDeletedSpaces(links, changes.spaces.newValue || []);
            if (rest.length === links.length) return;
            links = rest;
            await save();
        });
    });

    spaceStore.onTabRemoved = onTabRemoved;

    // Picking a link opens its page in the window you are in, in the space it was in, and uses it up.
    async function open({ linkId, windowId }) {
        const link = await run(async () => {
            const found = links.find(item => item.id === linkId);
            if (!found) return null;
            links = withoutLink(links, linkId);
            await save();
            return found;
        });
        if (!link) return;
        let tab;
        try {
            tab = await chromeApi.tabs.create({ windowId, url: link.url, active: true });
        } catch (error) {
            // Nothing opened, so the link stays.
            await run(() => putBack([link]));
            throw error;
        }
        // The page is open now, so the link stays used up even if its space is gone.
        await spaceStore
            .dispatch({ action: 'assign', tabId: tab.id, spaceId: link.spaceId })
            .catch(error => Logger.warn('Could not file the opened link in its space:', error));
    }

    // Clear: the space's links leave the list for Archived, and Undo can bring them back.
    const clear = ({ spaceId }) =>
        run(async () => {
            const pages = openPagesOf(await chromeApi.tabs.query({}));
            const result = clearSpace(links, spaceId, pages);
            if (!result.cleared.length) return { cleared: [] };
            links = result.links;
            await save();
            return { cleared: await toArchived(result.cleared) };
        });

    // Links back in the list (Undo, or a page that could not open); any pushed past the cap go to Archived.
    async function putBack(entries) {
        const added = addLinks(links, entries, { keepExisting: true });
        links = added.links;
        await save();
        await toArchived(added.overflow);
    }

    const restore = ({ cleared }) =>
        run(async () => {
            await putBack(cleared.map(entry => entry.link));
            for (const { link, addedToArchive } of cleared) {
                if (addedToArchive) await removeArchivedTab(link.url, link.spaceId);
            }
        });

    const remove = ({ linkId }) =>
        run(async () => {
            links = withoutLink(links, linkId);
            await save();
        });

    // Auto-archive: links older than the idle setting go to Archived.
    const archiveIdle = idleMs =>
        run(async () => {
            const result = splitIdle(links, now(), idleMs);
            if (!result.idle.length) return;
            links = result.links;
            await save();
            await toArchived(result.idle);
        });

    const actions = { open, clear, restore, remove };
    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== CLOSED_LINKS_MESSAGE || !Object.hasOwn(actions, message.action)) return;
        actions[message.action](message).then(
            result => sendResponse({ success: true, ...result }),
            error => sendResponse({ success: false, error: error.message })
        );
        return true;
    });

    run(() => {}).catch(() => {});
    return { archiveIdle };
}
