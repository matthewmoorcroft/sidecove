// When a window closes and another stays open, its ordinary tabs open again as tabs in the window
// that is left, in the same spaces and places (see closed-window-reopen.js). Nothing here touches
// chrome.* or the DOM, so the rules can be tested on their own.
import { pageOf } from '../shared/saved-favorites.js';

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
// A space's list is copied once, and every window that has tabs in that space shares the copy.
export function windowContents(spaces, tabs) {
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    const result = {};
    const lists = new Map();
    for (const tab of tabs) result[tab.windowId] ||= { tabs: [], layouts: {} };
    for (const space of spaces) {
        for (const id of space.temporaryTabs || []) {
            const tab = byId.get(id);
            if (!tab || tab.pinned || !isReopenablePage(pageOf(tab))) continue;
            const entry = result[tab.windowId];
            entry.tabs.push({ tabId: id, url: pageOf(tab), spaceId: space.id });
            if (!lists.has(space.id)) lists.set(space.id, [...space.temporaryTabs]);
            entry.layouts[space.id] ||= lists.get(space.id);
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
// Sidecove's copies are still open. `copies` are { copyId, url, windowIds, batch, restoredIn }: the
// page the copy was opened with, the windows open then, the closed window it stands in for, and the
// window that has brought that one back, once one has. A copy stands in for the closed tab only
// until you use it (see closed-window-reopen.js), so it is matched by the page it was opened with
// even if that page has since redirected. Without the sessions permission a new window could be
// Chrome's restore or just a new window, so the evidence is: Chrome restores a tab on its page
// already, with no opener (a new link tab has only the address it is going to), in a window that
// was not open then, `win`; and with it, in that window (`windowTabs`), the pages of at least two of
// the batch's copies still waiting, or of its only one. The earliest copy goes first. A private
// tab, or one in a window that cannot take tabs, is never the original.
export function copyReplacedBy(copies, tab, win, windowTabs = [tab]) {
    const url = tab.url;
    if (!isReopenablePage(url) || tab.openerTabId !== undefined || tab.incognito || !canTakeTabs(win)) return null;
    const waits = copy =>
        copy.copyId !== tab.id &&
        !copy.windowIds.includes(tab.windowId) &&
        (copy.restoredIn === undefined || copy.restoredIn === tab.windowId);
    const copy = copies.find(other => other.url === url && waits(other));
    if (!copy) return null;
    if (copy.restoredIn !== undefined) return copy;
    const batch =
        copy.batch === undefined ? [copy] : copies.filter(other => other.batch === copy.batch && waits(other));
    const back = new Set(broughtBack(tab, windowTabs).map(other => other.url));
    return batch.filter(other => back.has(other.url)).length >= Math.min(2, batch.length) ? copy : null;
}

// The tabs in `tab`'s window that may be Chrome's restore: on their page already, with no opener.
const broughtBack = (tab, windowTabs) =>
    [tab, ...windowTabs.filter(other => other.id !== tab.id)].filter(
        other => other.windowId === tab.windowId && other.openerTabId === undefined && isReopenablePage(other.url)
    );

// Once `tab` has shown its window to be the closed one back (copyReplacedBy gave `copy`), each
// copy of that window whose page is back in it is replaced, each by its own tab: Chrome may report
// the restored tabs one at a time, so an earlier one could not show it yet.
export function batchReplacements(copies, copy, tab, windowTabs) {
    const pairs = [[copy, tab]];
    if (copy.batch === undefined) return pairs;
    const used = new Set([tab.id, ...copies.map(other => other.copyId)]);
    for (const other of copies) {
        if (other === copy || other.batch !== copy.batch || other.windowIds.includes(tab.windowId)) continue;
        const match = broughtBack(tab, windowTabs).find(
            candidate => !used.has(candidate.id) && candidate.url === other.url
        );
        if (!match) continue;
        used.add(match.id);
        pairs.push([other, match]);
    }
    return pairs.sort((a, b) => copies.indexOf(a[0]) - copies.indexOf(b[0]));
}
