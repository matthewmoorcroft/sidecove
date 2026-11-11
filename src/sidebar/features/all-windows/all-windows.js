// "Show tabs and favorites from all windows": each window's panel lists the open tabs and the
// top-bar favorites of every window, and which window a tab lives in does not show. Chrome keeps
// each tab in exactly one window, so picking a page that is open only in another window opens it
// again here and leaves the other window's tab where it is.

export { ALL_WINDOWS_SETTING } from '../../../shared/saved-favorites.js';

export const isOtherWindow = (tab, windowId) => tab?.windowId != null && tab.windowId !== windowId;

// The page a tab shows. Two tabs on the same address are one entry in the list.
export const pageOf = tab => tab?.url || tab?.pendingUrl || '';

// This window's tabs, or with the setting on every window's. Incognito and normal windows never
// show each other's tabs.
export function visibleWindowTabs(tabs, win, allWindows) {
    return tabs.filter(
        tab => tab.windowId === win.id || (allWindows && Boolean(tab.incognito) === Boolean(win.incognito))
    );
}

// Keeps all of this window's tabs, and another window's tab only when no tab kept so far, or of
// this window, shows its page. This window's copy therefore always stands for a page.
export function onePerPage(tabs, windowId) {
    const seen = new Set(tabs.filter(tab => !isOtherWindow(tab, windowId)).map(pageOf));
    return tabs.filter(tab => {
        if (!isOtherWindow(tab, windowId)) return true;
        const page = pageOf(tab);
        if (seen.has(page)) return false;
        seen.add(page);
        return true;
    });
}

// The live tabs of a space's list, in the space's order, one per page. A pinned tab binds to its
// bookmark one window at a time, so a pinned tab open in another window is left to that window.
export function selectListedTabs(space, tabs, win, allWindows) {
    const pinnedIds = new Set(space?.spaceBookmarks || []);
    const byId = new Map(
        visibleWindowTabs(tabs, win, allWindows)
            .filter(tab => !tab.pinned && (tab.windowId === win.id || !pinnedIds.has(tab.id)))
            .map(tab => [tab.id, tab])
    );
    const ids = new Set([...(space?.spaceBookmarks || []), ...(space?.temporaryTabs || [])]);
    const listed = [...ids].map(id => byId.get(id)).filter(Boolean);
    return allWindows ? onePerPage(listed, win.id) : listed;
}

// Top-bar favorites (Chrome pins), one per page: this window's first in tab strip order, then
// each other window's. With separate favorites per space, only the pins of `spaceTabIds` show.
export function selectFavoriteTabs(tabs, win, { allWindows = false, perSpace = false, spaceTabIds = new Set() } = {}) {
    const pins = visibleWindowTabs(tabs, win, allWindows)
        .filter(tab => tab.pinned && (!perSpace || spaceTabIds.has(tab.id)))
        .sort(
            (a, b) =>
                isOtherWindow(a, win.id) - isOtherWindow(b, win.id) || a.windowId - b.windowId || a.index - b.index
        );
    return allWindows ? onePerPage(pins, win.id) : pins;
}

// What picking an entry does: switch to it when it is in this window, otherwise open its page
// here as a new tab (pinned for a favorite). Nothing in the other window changes.
export function pickAction(tab, windowId) {
    if (!isOtherWindow(tab, windowId)) return { activate: tab.id };
    return { open: { windowId, url: pageOf(tab), pinned: Boolean(tab.pinned), active: true } };
}

// The tabs a close removes: the entry stands for its page in every window, so every open tab of
// that page in the space's list closes and the entry leaves the list.
export function pageTabIds(space, tabs, win, tab) {
    const page = pageOf(tab);
    const listed = new Set(space?.temporaryTabs || []);
    const copies = visibleWindowTabs(tabs, win, true).filter(
        other => other.id !== tab.id && !other.pinned && listed.has(other.id) && page && pageOf(other) === page
    );
    return [tab.id, ...copies.map(other => other.id)];
}
