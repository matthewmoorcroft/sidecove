// When a window closes and another stays open, its ordinary tabs open again as tabs in the window
// that is left, in the same spaces and places (see closed-window-reopen.js). Nothing here touches
// chrome.* or the DOM, so the rules can be tested on their own.

// Only pages a new tab can open and that mean something later. New Tab, chrome://, about:blank,
// extension pages and local files are not reopened.
export const isReopenablePage = url => /^https?:\/\//i.test(url || '');

// A closing window's tabs, gathered as each one's removal is reported:
//   tabs     { tabId, url, spaceId } in the order they closed.
//   layouts  each space's list of tab ids just before the window's first tab in it closed, which
//            is the order to put them back in.
export const emptyBatch = () => ({ tabs: [], layouts: {} });

// Adds one closed tab. Pinned tabs and favorites (any section but the space's ordinary tabs) and
// pages that cannot be reopened are left out.
export function noteClosedTab(batch, { tabId, record, layout }) {
    if (record?.section !== 'temporaryTabs' || !isReopenablePage(record.url)) return batch;
    const layouts = Object.hasOwn(batch.layouts, record.spaceId)
        ? batch.layouts
        : { ...batch.layouts, [record.spaceId]: [...(layout || [])] };
    return { tabs: [...batch.tabs, { tabId, url: record.url, spaceId: record.spaceId }], layouts };
}

// The tabs to open again, in the order they were listed. A page still open in a window that stays
// is not closed, so it is not opened twice; a space that is gone takes its tabs with it.
export function tabsToReopen(batch, { openPages, spaceIds }) {
    const spaces = [...new Set(batch.tabs.map(tab => tab.spaceId))];
    const rank = tab => {
        const at = (batch.layouts[tab.spaceId] || []).indexOf(tab.tabId);
        return at < 0 ? Infinity : at;
    };
    return batch.tabs
        .filter(tab => spaceIds.has(tab.spaceId) && !openPages.has(tab.url))
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
