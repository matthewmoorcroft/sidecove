import { ownerOf, tabIds } from '../shared/space-store.js';
import { Logger } from '../shared/logger.js';
import { TabRecency } from './tab-recency.js';

export const RECENT_TAB_COMMAND = 'RecentTabInSpace';
export const RECENCY_STORAGE_KEY = 'tabRecency'; // storage.session: tab ids end with the browser session.
const SAVE_DELAY_MS = 1000;

// Activate the most recently used tab of the focused window's current space; pressing again
// within the cycle window goes further back. `chromeApi` is passed in so tests can fake it.
export async function jumpToRecentTab({ chromeApi, spaces, recency, now }) {
    const window = await chromeApi.windows.getLastFocused({ windowTypes: ['normal'] });
    const [active] = await chromeApi.tabs.query({ active: true, windowId: window.id });
    if (!active) return null;
    const { activeSpaces = {} } = await chromeApi.storage.session.get('activeSpaces');
    const space = ownerOf(spaces, active.id) || spaces.find(s => s.id === activeSpaces[window.id]);
    if (!space) return null;
    const owned = new Set(tabIds(space));
    const windowTabs = await chromeApi.tabs.query({ windowId: window.id });
    const candidates = windowTabs.map(tab => tab.id).filter(id => owned.has(id));
    const targetId = recency.press({ candidates, activeId: active.id, now });
    if (targetId === null) return null;
    try {
        await chromeApi.tabs.update(targetId, { active: true });
    } catch (error) {
        // The tab closed between the query and the update; the next press skips it.
        recency.remove(targetId);
        Logger.warn('[Recent tab] Could not activate tab:', error);
        return null;
    }
    return targetId;
}

// Registers the listeners that keep the use order, and returns the shortcut handler.
// Recording is an in-memory list update plus a delayed write, and the saved copy only
// lets the order survive the service worker being stopped.
export function registerRecentTab({ chromeApi = chrome, spaceStore, now = Date.now } = {}) {
    const recency = new TabRecency();
    const ready = chromeApi.storage.session.get(RECENCY_STORAGE_KEY).then(
        stored => {
            const saved = stored?.[RECENCY_STORAGE_KEY];
            if (Array.isArray(saved)) recency.load(saved);
        },
        error => Logger.warn('[Recent tab] Could not read the saved order:', error)
    );

    let saveTimer;
    const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(
            () =>
                chromeApi.storage.session
                    .set({ [RECENCY_STORAGE_KEY]: recency.toJSON() })
                    .catch(error => Logger.warn('[Recent tab] Could not save the order:', error)),
            SAVE_DELAY_MS
        );
    };
    const update =
        change =>
        async (...args) => {
            await ready;
            change(...args);
            scheduleSave();
        };

    chromeApi.tabs.onActivated.addListener(update(info => recency.record(info.tabId)));
    chromeApi.tabs.onRemoved.addListener(update(tabId => recency.remove(tabId)));
    chromeApi.tabs.onReplaced.addListener(update((added, removed) => recency.replace(removed, added)));

    return async function onRecentTabCommand() {
        try {
            await ready;
            const spaces = await spaceStore.dispatch({ action: 'get' });
            await jumpToRecentTab({ chromeApi, spaces, recency, now: now() });
        } catch (error) {
            Logger.error('[Recent tab] Could not switch to the recent tab:', error);
        }
    };
}
