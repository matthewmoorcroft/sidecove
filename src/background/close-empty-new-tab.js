import { Utils } from '../shared/utils.js';
import { Logger } from '../shared/logger.js';
import { isNewTabPage, isUntouchedPage } from '../shared/new-tab-page.js';
import { shouldCloseEmptyNewTab } from './empty-new-tab.js';

export const EMPTY_TAB_STORAGE_KEY = 'emptyNewTabs'; // storage.session: tab ids end with the browser session.
const RETRY_DELAY_MS = 300;

// Closes a new tab you leave without typing or opening anything. It remembers which tabs began
// as an empty new tab and which tab each window showed last, since the activation event names
// only the tab that was switched to. Tabs seen opening are tracked, and so are new tab pages
// already open when tracking starts from nothing (install, update, reload, browser start).
export function registerCloseEmptyNewTab({ chromeApi = chrome, spaceStore, getSettings = Utils.getSettings } = {}) {
    const untouched = new Set();
    const shown = new Map(); // windowId -> the tab shown there
    const save = () =>
        chromeApi.storage.session
            .set({ [EMPTY_TAB_STORAGE_KEY]: { untouched: [...untouched], shown: [...shown] } })
            .catch(error => Logger.warn('[Empty new tab] Could not save the tracked tabs:', error));

    const ready = (async () => {
        let stored;
        let readSaved = false;
        try {
            stored = (await chromeApi.storage.session.get(EMPTY_TAB_STORAGE_KEY))?.[EMPTY_TAB_STORAGE_KEY];
            for (const id of stored?.untouched || []) untouched.add(id);
            for (const [windowId, tabId] of stored?.shown || []) shown.set(windowId, tabId);
            readSaved = true;
        } catch (error) {
            Logger.warn('[Empty new tab] Could not read the tracked tabs:', error);
        }
        // A window the saved list does not cover (the worker restarted) starts from what it shows now.
        for (const tab of await chromeApi.tabs.query({ active: true })) {
            if (!shown.has(tab.windowId)) shown.set(tab.windowId, tab.id);
        }
        // Nothing saved means tracking starts now, so a New Tab already open could not be seen
        // opening. One showing only the new tab page is taken as empty. Saving even an empty list
        // makes a later worker restart read it back, so a tab seen going to a site is not re-seeded.
        if (readSaved && !stored) {
            for (const tab of await chromeApi.tabs.query({})) {
                if (isNewTabPage(tab.url || tab.pendingUrl) && isUntouchedPage(tab)) untouched.add(tab.id);
            }
            save();
        }
    })().catch(error => Logger.warn('[Empty new tab] Could not start tracking:', error));

    // The tab is shown again if the user went straight back, or may have moved to another window.
    const isShown = tabId => [...shown.values()].includes(tabId);

    async function closeIfEmpty(tabId, windowId) {
        const settings = await getSettings();
        if (!settings.closeEmptyNewTabs) return;
        const tab = await chromeApi.tabs.get(tabId);
        if (tab.windowId !== windowId) return;
        const [windowTabs, { spaces, hidden }, bindings] = await Promise.all([
            chromeApi.tabs.query({ windowId }),
            spaceStore.run(() => ({ spaces: spaceStore.spaces, hidden: new Set(spaceStore.hidden) })),
            Utils.getPinnedTabStates()
        ]);
        const close = shouldCloseEmptyNewTab({
            enabled: true,
            tab,
            untouched: untouched.has(tabId),
            // Tabs Clean All is hiding are about to close, so they do not make this tab less than the last.
            windowTabCount: windowTabs.filter(windowTab => !hidden.has(windowTab.id)).length,
            protectedIds: new Set(spaces.flatMap(space => space.spaceBookmarks)),
            bindings
        });
        if (!close || isShown(tabId)) return;
        try {
            await chromeApi.tabs.remove(tabId);
        } catch (error) {
            // Chrome refuses while a tab is being dragged; try again once it has settled.
            Logger.warn('[Empty new tab] Could not close the tab at once:', error);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            if (!isShown(tabId)) await chromeApi.tabs.remove(tabId).catch(() => {});
        }
    }

    chromeApi.tabs.onCreated.addListener(async tab => {
        await ready;
        if (!isNewTabPage(tab.pendingUrl || tab.url)) return;
        untouched.add(tab.id);
        save();
    });
    chromeApi.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
        await ready;
        if (!untouched.has(tabId) || isUntouchedPage(tab)) return;
        untouched.delete(tabId);
        save();
    });
    chromeApi.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
        await ready;
        const left = shown.get(windowId);
        if (left !== tabId) {
            shown.set(windowId, tabId);
            save();
        }
        if (left === undefined || left === tabId || !untouched.has(left)) return;
        try {
            await closeIfEmpty(left, windowId);
        } catch (error) {
            // The tab may already be gone, which is fine.
            Logger.warn('[Empty new tab] Could not check the tab you left:', error);
        }
    });
    chromeApi.tabs.onRemoved.addListener(async tabId => {
        await ready;
        if (untouched.delete(tabId)) save();
    });
    chromeApi.windows.onRemoved.addListener(async windowId => {
        await ready;
        if (shown.delete(windowId)) save();
    });
    chromeApi.tabs.onReplaced.addListener(async (added, removed) => {
        await ready;
        if (untouched.delete(removed)) save();
        for (const [windowId, tabId] of shown) if (tabId === removed) shown.set(windowId, added);
    });
    return { ready };
}
