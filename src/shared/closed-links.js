// Closed links: when a window closes, each of its ordinary tabs whose page is not open in any other
// window is kept as a dimmed link row at the bottom of its space's list, in every window. The
// service worker is the only writer. Nothing here touches chrome.* or the DOM, so the rules can be
// tested on their own.
//
// A link is { id, url, title, spaceId, closedAt, batchAt, windowId, order }:
//   closedAt  when its tab closed; auto-archive counts its age from here.
//   batchAt   when the first tab of the same window closed, so one window's links stay together.
//   order     the tab's place in the space's list, which keeps a window's links in the order they had.

import { pageOf } from './saved-favorites.js';

export const CLOSED_LINKS_KEY = 'closedLinks';
export const CLOSED_LINKS_MESSAGE = 'closedLinks';
export const CLOSED_LINKS_LIMIT = 100;
// Tabs of one window close within moments of each other.
export const BATCH_MS = 10000;

// Only pages a new tab can open and that mean something later. New Tab, chrome://, about:blank,
// extension pages and local files never leave a link.
export const isLinkablePage = url => /^https?:\/\//i.test(url || '');

export const linksFrom = stored => (Array.isArray(stored?.[CLOSED_LINKS_KEY]) ? stored[CLOSED_LINKS_KEY] : []);

export const byDisplayOrder = (a, b) => a.batchAt - b.batchAt || a.order - b.order;

// The link a closing tab leaves, or null. `tab` is what the worker last knew of it ({ url, title,
// incognito }); `openElsewhere` says its page is open in a window that is staying.
export function linkForClosedTab({ record, tab, openElsewhere, windowId, links, now, newId }) {
    if (record?.section !== 'temporaryTabs' || !tab || tab.incognito) return null;
    if (!isLinkablePage(tab.url) || openElsewhere) return null;
    const sameWindow = links.find(link => link.windowId === windowId && now - link.closedAt <= BATCH_MS);
    return {
        id: newId(),
        url: tab.url,
        title: tab.title || tab.url,
        spaceId: record.spaceId,
        closedAt: now,
        batchAt: sameWindow ? sameWindow.batchAt : now,
        windowId,
        order: record.order ?? 0
    };
}

// Adds links, one per page: a page closed again replaces its older link, unless `keepExisting`
// (Undo must not push out a newer link). Past the limit the oldest are returned as `overflow`
// for Archived.
export function addLinks(links, incoming, { limit = CLOSED_LINKS_LIMIT, keepExisting = false } = {}) {
    const taken = new Set(keepExisting ? links.map(link => link.url) : []);
    const fresh = [];
    for (const link of incoming) {
        if (taken.has(link.url)) continue;
        taken.add(link.url);
        fresh.push(link);
    }
    const replaced = new Set(fresh.map(link => link.url));
    const all = [...links.filter(link => !replaced.has(link.url)), ...fresh].sort(byDisplayOrder);
    const cut = Math.max(0, all.length - limit);
    return { links: all.slice(cut), overflow: all.slice(0, cut) };
}

// Pages open in a normal window. A link for one of them is hidden, so a page is one entry whichever
// way it is open.
export const openPagesOf = tabs => new Set(tabs.filter(tab => !tab.incognito).map(pageOf));

// The rows a space shows, bottom of its list, in the order its open tabs would be drawn.
export function visibleLinks(links, spaceId, openPages, { invertTabOrder = true } = {}) {
    const rows = links.filter(link => link.spaceId === spaceId && !openPages.has(link.url)).sort(byDisplayOrder);
    return invertTabOrder ? rows.reverse() : rows;
}

// A page was opened: its link is used up, so it does not come back when that tab closes.
export const withoutPage = (links, page) => links.filter(link => link.url !== page);

export const withoutLink = (links, id) => links.filter(link => link.id !== id);

// A deleted space takes its links with it. An empty list of spaces is a store that has not loaded.
export const withoutDeletedSpaces = (links, spaces) =>
    spaces.length ? links.filter(link => spaces.some(space => space.id === link.spaceId)) : links;

// Clear: the space's visible links leave the list and go to Archived.
export function clearSpace(links, spaceId, openPages) {
    const cleared = new Set(visibleLinks(links, spaceId, openPages).map(link => link.id));
    return { links: links.filter(link => !cleared.has(link.id)), cleared: links.filter(link => cleared.has(link.id)) };
}

// Auto-archive: a link older than the idle setting moves to Archived.
export function splitIdle(links, now, idleMs) {
    return {
        links: links.filter(link => now - link.closedAt <= idleMs),
        idle: links.filter(link => now - link.closedAt > idleMs)
    };
}

export const archiveEntryOf = link => ({ url: link.url, name: link.title || link.url, spaceId: link.spaceId });

// A page open in a surviving window keeps the place it had in the list. The list puts a page where
// the earliest tab showing it sits, so when that tab is one of a closing window's, the page's
// earliest tab in another window takes its place. Returns the space's new tab order without the
// closed tab, or null when the closed tab's slot was not the page's. A saved list may have lost the
// closed tab already, so `slot` (the place it was last saved at) stands in for its index then.
export function orderAfterWindowClose({ order, removedId, page, windowId, incognito = false, slot, tabs }) {
    const found = order.indexOf(removedId);
    const at = found >= 0 ? found : Number.isInteger(slot) ? Math.min(slot, order.length) : -1;
    if (at < 0 || !page) return null;
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    const heir = order.find(id => {
        const tab = byId.get(id);
        return (
            tab &&
            id !== removedId &&
            !tab.pinned &&
            tab.windowId !== windowId &&
            Boolean(tab.incognito) === Boolean(incognito) &&
            pageOf(tab) === page
        );
    });
    if (heir === undefined || order.indexOf(heir) < at) return null;
    const next = order.filter(id => id !== removedId && id !== heir);
    next.splice(at, 0, heir);
    return next;
}
