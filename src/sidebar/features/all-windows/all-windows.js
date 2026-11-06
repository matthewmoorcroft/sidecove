// "Show tabs and favorites from all windows": which tabs a window's panel lists, and which of
// them live in another window. Chrome keeps each tab in exactly one window, so a panel can only
// list another window's tab and mark it; picking it switches to that window.

export const ALL_WINDOWS_SETTING = 'showTabsFromAllWindows';

export const isOtherWindow = (tab, windowId) => tab?.windowId != null && tab.windowId !== windowId;

// This window's tabs, or with the setting on every window's. Incognito and normal windows never
// show each other's tabs.
export function visibleWindowTabs(tabs, win, allWindows) {
    return tabs.filter(
        tab => tab.windowId === win.id || (allWindows && Boolean(tab.incognito) === Boolean(win.incognito))
    );
}

// The live tabs of a space's list, in the space's order. A pinned tab binds to its bookmark one
// window at a time, so a pinned tab open in another window is left to that window's panel.
export function selectListedTabs(space, tabs, win, allWindows) {
    const pinnedIds = new Set(space?.spaceBookmarks || []);
    const byId = new Map(
        visibleWindowTabs(tabs, win, allWindows)
            .filter(tab => !tab.pinned && (tab.windowId === win.id || !pinnedIds.has(tab.id)))
            .map(tab => [tab.id, tab])
    );
    const ids = new Set([...(space?.spaceBookmarks || []), ...(space?.temporaryTabs || [])]);
    return [...ids].map(id => byId.get(id)).filter(Boolean);
}

// Top-bar favorites (Chrome pins): this window's first in tab strip order, then each other
// window's. With separate favorites per space, only the pins of `spaceTabIds` show.
export function selectFavoriteTabs(tabs, win, { allWindows = false, perSpace = false, spaceTabIds = new Set() } = {}) {
    return visibleWindowTabs(tabs, win, allWindows)
        .filter(tab => tab.pinned && (!perSpace || spaceTabIds.has(tab.id)))
        .sort(
            (a, b) =>
                isOtherWindow(a, win.id) - isOtherWindow(b, win.id) || a.windowId - b.windowId || a.index - b.index
        );
}
