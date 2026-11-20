// When a window closes and another stays open, its ordinary tabs open again as tabs in the window
// that is left, in the same spaces and places (see closed-window-reopen.js). Nothing here touches
// chrome.* or the DOM, so the rules can be tested on their own.

// Only pages a new tab can open and that mean something later. New Tab, chrome://, about:blank,
// extension pages and local files are not reopened.
export const isReopenablePage = url => /^https?:\/\//i.test(url || '');

// Tabs only go back into a browser window with a tab strip. Chrome reports Meet's
// picture-in-picture window as "normal" but always on top; a tab put there cannot be seen, and
// Brave crashes. A private window is not one Sidecove may put pages in.
export const canTakeTabs = win => win?.type === 'normal' && !win.alwaysOnTop && !win.incognito;

// What each open window holds, taken while it is open: by the time a window has closed, its tabs
// are gone from Chrome and from the space lists, so this is the only record of them.
//   tabs     { tabId, url, spaceId } for each ordinary tab, in list order.
//   layouts  each of those spaces' lists, which is the order to put the tabs back in.
// Every window that has a tab gets an entry, even with nothing to reopen. Pinned tabs and favorites
// (any section but the space's ordinary tabs) and pages that cannot be reopened are left out.
export function windowContents(spaces, tabs) {
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    const result = {};
    for (const tab of tabs) result[tab.windowId] ||= { tabs: [], layouts: {} };
    for (const space of spaces) {
        for (const id of space.temporaryTabs || []) {
            const tab = byId.get(id);
            if (!tab || tab.pinned || !isReopenablePage(tab.url || tab.pendingUrl)) continue;
            const entry = result[tab.windowId];
            entry.tabs.push({ tabId: id, url: tab.url || tab.pendingUrl, spaceId: space.id });
            entry.layouts[space.id] ||= [...space.temporaryTabs];
        }
    }
    return result;
}

// The record of a window that has closed, as a batch to reopen: only the tabs that closed with it.
// A tab still open was moved into another window, which is not closing it.
export function closedBatch(contents, openTabIds) {
    const tabs = (contents?.tabs || []).filter(tab => !openTabIds.has(tab.tabId));
    const spaceIds = new Set(tabs.map(tab => tab.spaceId));
    const layouts = Object.fromEntries(Object.entries(contents?.layouts || {}).filter(([id]) => spaceIds.has(id)));
    return { tabs, layouts };
}

// The key for a page in a space, for `openPages` below.
export const pageInSpace = (spaceId, url) => `${spaceId} ${url}`;

// The tabs to open again, in the order they were listed. A page still open as an ordinary tab of
// the same space in a window that stays is not opened twice (`openPages` holds `pageInSpace` keys);
// a space that is gone takes its tabs with it.
export function tabsToReopen(batch, { openPages, spaceIds }) {
    const spaces = [...new Set(batch.tabs.map(tab => tab.spaceId))];
    const rank = tab => {
        const at = (batch.layouts[tab.spaceId] || []).indexOf(tab.tabId);
        return at < 0 ? Infinity : at;
    };
    return batch.tabs
        .filter(tab => spaceIds.has(tab.spaceId) && !openPages.has(pageInSpace(tab.spaceId, tab.url)))
        .sort((a, b) => spaces.indexOf(a.spaceId) - spaces.indexOf(b.spaceId) || rank(a) - rank(b));
}

// The space's list with the reopened tabs back where the closed ones were. `layout` is the list
// just before the window closed, `current` the list now and `reopened` maps each closed tab id to
// its new tab's id. Each new tab goes just after the nearest tab above it in `layout` that is in
// the list now, so tabs opened or moved since keep their places.
export function placeReopened(current, layout, reopened) {
    const added = new Set(reopened.values());
    const result = current.filter(id => !added.has(id));
    layout.forEach((oldId, index) => {
        const newId = reopened.get(oldId);
        if (newId === undefined) return;
        let at = 0;
        for (let above = index - 1; above >= 0; above--) {
            const found = result.indexOf(reopened.get(layout[above]) ?? layout[above]);
            if (found >= 0) {
                at = found + 1;
                break;
            }
        }
        result.splice(at, 0, newId);
    });
    return result;
}

// The window to reopen tabs in: the one focused most recently. `focusedAt` maps window ids to when
// each was last focused.
export function pickTargetWindow(windows, focusedAt = {}) {
    if (!windows.length) return null;
    const when = win => focusedAt[win.id] ?? (win.focused ? 0 : -1);
    return windows.reduce((best, win) => (when(win) > when(best) ? win : best));
}

// A reopened tab has its own name once its page has a title (Chrome shows the address until then)
// or has finished loading; it can then be unloaded and keep that name.
export function hasItsName(change, tab) {
    if (change.status === 'complete') return true;
    const title = change.title ?? tab?.title;
    return Boolean(title && tab?.url && !tab.url.includes(title));
}

// Reopening the closed window afterwards (Cmd+Shift+T, or History) brings back its own tabs while
// Sidecove's copies are still open. `copies` are { copyId, url, windowIds }: the page the copy was
// opened with, and the windows open then. A copy stands in for the closed tab only until you use it
// (see closed-window-reopen.js), so it is matched by the page it was opened with even if that page
// has since redirected. A tab that opens with that page in a window that was not open then, `win`,
// is the original coming back, so it replaces the copy; the earliest copy goes first. A private
// tab, or one in a window that cannot take tabs, is never the original.
export function copyReplacedBy(copies, tab, win) {
    const url = tab.url || tab.pendingUrl;
    if (!isReopenablePage(url) || tab.incognito || !canTakeTabs(win)) return null;
    return (
        copies.find(copy => copy.url === url && copy.copyId !== tab.id && !copy.windowIds.includes(tab.windowId)) ||
        null
    );
}
