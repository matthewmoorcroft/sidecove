import { sections } from './space-membership.js';
import { orderAfterWindowClose } from './closed-links.js';
import { ALL_WINDOWS_SETTING } from './saved-favorites.js';
import { Logger } from './logger.js';

// With every window's tabs shown, a page open in two windows is one entry at the earliest tab's
// place. When that tab closes with its window, the page's tab in the window that is left takes the
// place, so the page does not move. With the setting off a window lists its own tabs, which do not
// move.
async function keepPageInPlace(store, id, info, record) {
    const space = store.spaces.find(s => s.id === record.spaceId);
    if (!space || info.windowId === undefined) return;
    const settings = await chrome.storage.sync.get({ [ALL_WINDOWS_SETTING]: true });
    if (settings[ALL_WINDOWS_SETTING] === false) return;
    const order = orderAfterWindowClose({
        order: space.temporaryTabs,
        removedId: id,
        page: record.url,
        windowId: info.windowId,
        slot: record.order,
        tabs: await chrome.tabs.query({})
    });
    if (order) space.temporaryTabs = order;
}

// A tab closed: the space store forgets it. A tab closed with its window is also queued to take its
// place again if Chrome reopens it, and `onTabRemoved` (set by the closed links) hears of it.
export async function removeTab(store, id, info) {
    const record = store.snapshotByTab.get(id);
    // A tab Clean All is hiding is in no space now; the old record must not bring it back.
    const closedWithWindow = Boolean(
        info?.isWindowClosing && record && !store.hidden.has(id) && store.spaces.some(s => s.id === record.spaceId)
    );
    if (closedWithWindow) {
        store.restoreQueue.push(record);
        try {
            await keepPageInPlace(store, id, info, record);
        } catch (error) {
            // The page may move in the list; the tab must still be forgotten.
            Logger.warn('Could not keep a page in place:', error);
        }
    }
    store.snapshotByTab.delete(id);
    store.provisional.delete(id);
    store.hidden.delete(id);
    store.linkTails.closed(id);
    for (const space of store.spaces) {
        for (const key of sections) space[key] = space[key].filter(t => t !== id);
        if (space.lastTab === id) delete space.lastTab;
    }
    try {
        await store.onTabRemoved?.({ tabId: id, info, record: closedWithWindow ? record : null });
    } catch (error) {
        Logger.warn('Closed links could not note a closed tab:', error);
    }
}
