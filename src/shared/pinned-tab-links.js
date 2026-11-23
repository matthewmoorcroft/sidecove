// Links opened from a space's pinned tab. By default they open in the tab list like any other
// link from outside it (see link-tab-placement.js). With the setting on, each becomes a new pinned
// tab directly beneath the pinned tab it came from, in the same folder. Links from a favourite
// (a top-bar pin) always open in the tab list.
//
// The service worker does this, so it works with the side panel closed: it files the tab under
// the space's pinned tabs as soon as Chrome reports it, then creates its bookmark once Chrome
// names its address, and names the bookmark after the page once it has loaded.

import { createSpacePin } from './space-pin.js';
import { isNewTabPage } from './new-tab-page.js';
import { Logger } from './logger.js';

export const PINNED_TAB_LINKS_SETTING = 'pinnedTabLinks';
export const PINNED_TAB_LINKS = { LIST: 'list', PIN: 'pin' };

/** Whether the setting, as stored, makes links from a pinned tab new pinned tabs. */
export const opensLinksAsPinnedTabs = value => value === PINNED_TAB_LINKS.PIN;

/**
 * Where the bookmark of a link opened from a pinned tab goes in the opener's folder: directly
 * beneath the opener, after the links already opened from it since it was last switched to, as
 * the tab list does.
 *
 * @param {Array<{id: string}>} children the bookmarks and folders in the opener's folder, in order
 * @param {string} openerBookmarkId the opener's bookmark
 * @param {Map<string, number>} tabByBookmark the open pinned tab of each bookmark, by bookmark id
 * @param {number} openerId the pinned tab the link was opened from
 * @param {number} newId the new tab
 * @param {import('./link-tab-placement.js').LinkTails} tails remembers the new tab as a link of the opener
 * @returns {number} the index for the new bookmark in that folder
 */
export function pinnedLinkIndex(children, openerBookmarkId, tabByBookmark, openerId, newId, tails) {
    const rows = children.map(child =>
        String(child.id) === String(openerBookmarkId)
            ? openerId
            : (tabByBookmark.get(String(child.id)) ?? `bookmark:${child.id}`)
    );
    return tails.place(rows, openerId, newId, false).indexOf(newId);
}

/** What the worker remembers between a link tab opening and its pin being finished. */
export class LinkPins {
    /** @param {{waiting?: Array<[number, number]>, titles?: Array<[number, {bookmarkId: string, title: string}]>}} [entries] */
    constructor({ waiting = [], titles = [] } = {}) {
        // New tab -> the pinned tab it was opened from, until Chrome names its address.
        this.waiting = new Map(waiting);
        // New pinned tab -> its bookmark and the title it was given, until its page has loaded.
        this.titles = new Map(titles);
    }

    entries() {
        return { waiting: [...this.waiting], titles: [...this.titles] };
    }

    wait(tabId, openerId) {
        this.waiting.set(tabId, openerId);
    }

    closed(id) {
        this.waiting.delete(id);
        this.titles.delete(id);
        for (const [tabId, openerId] of this.waiting) if (openerId === id) this.waiting.delete(tabId);
    }

    /** Chrome swapped a tab for another (a prerendered page, say) and the new one takes its place. */
    replaced(added, removed) {
        for (const map of [this.waiting, this.titles]) {
            if (!map.has(removed)) continue;
            map.set(added, map.get(removed));
            map.delete(removed);
        }
        for (const [tabId, openerId] of this.waiting) if (openerId === removed) this.waiting.set(tabId, added);
    }
}

/** The folder of the bookmark, or one of its parents, is the space's folder. */
async function isInSpaceFolder(chromeApi, node, folderId) {
    let parentId = node.parentId;
    for (let depth = 0; parentId && depth < 16; depth++) {
        if (String(parentId) === String(folderId)) return true;
        const [parent] = await chromeApi.bookmarks.get(String(parentId)).catch(() => []);
        parentId = parent?.parentId;
    }
    return false;
}

// Creates the bookmark beneath the opener's. Returns null when the link cannot be a pinned tab
// there, and it then opens in the tab list instead.
async function pinBeneathOpener(chromeApi, store, space, tab, openerId, url) {
    if (!space.spaceBookmarks.includes(openerId)) return null;
    const opener = await chromeApi.tabs.get(openerId).catch(() => null);
    // A link opened into another window (Shift+click, a popup) is not beneath the pinned tab.
    if (!opener || opener.windowId !== tab.windowId) return null;
    const { pinnedTabStatesById: bindings = {} } = await chromeApi.storage.local.get('pinnedTabStatesById');
    const openerBookmarkId = bindings[openerId]?.bookmarkId;
    if (!openerBookmarkId) return null;
    const [mark] = await chromeApi.bookmarks.get(String(openerBookmarkId)).catch(() => []);
    if (!mark?.url || !(await isInSpaceFolder(chromeApi, mark, space.bookmarkFolderId))) return null;
    const tabByBookmark = new Map();
    for (const id of space.spaceBookmarks) {
        const bookmarkId = bindings[id]?.bookmarkId;
        if (bookmarkId && !tabByBookmark.has(String(bookmarkId))) tabByBookmark.set(String(bookmarkId), id);
    }
    const children = await chromeApi.bookmarks.getChildren(String(mark.parentId));
    const index = pinnedLinkIndex(children, mark.id, tabByBookmark, openerId, tab.id, store.linkTails);
    return createSpacePin(chromeApi, tab, { parentId: String(mark.parentId), index, title: tab.title || url, url });
}

/**
 * Finishes the pin of a link tab the store filed under the pinned tabs, once Chrome has named its
 * address. If it cannot be pinned, it goes to the tab list as it would with the setting off.
 * Runs inside the store's queue.
 */
export async function pinWaitingLink(chromeApi, store, tab) {
    const openerId = store.linkPins.waiting.get(tab.id);
    if (openerId === undefined) return;
    const url = tab.url || tab.pendingUrl;
    // A page opened with window.open starts blank before it loads its address.
    if (!url || url === 'about:blank') return;
    store.linkPins.waiting.delete(tab.id);
    const space = store.spaces.find(s => s.spaceBookmarks.includes(tab.id));
    if (!space) return;
    let bookmark = null;
    // Chrome can name the pinned tab as the opener of a New Tab; that is not a link to pin.
    if (!isNewTabPage(url)) {
        try {
            bookmark = await pinBeneathOpener(chromeApi, store, space, tab, openerId, url);
        } catch (error) {
            Logger.warn('Could not pin a link opened from a pinned tab:', error);
        }
    }
    if (bookmark) {
        store.linkPins.titles.set(tab.id, { bookmarkId: String(bookmark.id), title: bookmark.title });
        // The page may have finished loading before its pin did, and then no later update names it.
        const now = await chromeApi.tabs.get(tab.id).catch(() => null);
        if (now) await nameLinkPin(chromeApi, store, now);
        return;
    }
    space.spaceBookmarks = space.spaceBookmarks.filter(id => id !== tab.id);
    if (isNewTabPage(url)) space.temporaryTabs.push(tab.id);
    else space.temporaryTabs = store.linkTails.place(space.temporaryTabs, openerId, tab.id, store.invertTabOrder);
}

/**
 * A new pinned tab's bookmark is named before its page has a title. Once the page has loaded, it
 * takes the page's title, unless it was renamed in the meantime.
 */
export async function nameLinkPin(chromeApi, store, tab) {
    const entry = store.linkPins.titles.get(tab.id);
    if (!entry || tab.status !== 'complete') return;
    store.linkPins.titles.delete(tab.id);
    if (!tab.title || tab.title === entry.title) return;
    const [bookmark] = await chromeApi.bookmarks.get(entry.bookmarkId).catch(() => []);
    if (bookmark?.title === entry.title) await chromeApi.bookmarks.update(bookmark.id, { title: tab.title });
}
