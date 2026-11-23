// Links opened from a space's pinned tab. By default they open in the tab list like any other
// link from outside it (see link-tab-placement.js). With the setting on, each becomes a new pinned
// tab directly beneath the pinned tab it came from, in the same folder. Links from a favourite
// (a top-bar pin) always open in the tab list.
//
// The service worker does this, so it works with the side panel closed. The tab first goes to the
// tab list as it would with the setting off. Once Chrome names its address, the worker creates its
// bookmark and only then moves it to the pinned tabs, so a link that never gets an address, or
// cannot be pinned, simply stays in the list. When the page has loaded, the bookmark takes the
// address it landed on and the page's title.

import { createSpacePin } from './space-pin.js';
import { isNewTabPage } from './new-tab-page.js';
import { LinkTails } from './link-tab-placement.js';
import { Utils } from './utils.js';
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
 * @param {LinkTails} tails remembers the new tab as a link of the opener
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
    /** @param {{waiting?: Array<[number, number]>, titles?: Array<[number, object]>}} [entries] */
    constructor({ waiting = [], titles = [] } = {}) {
        // New tab -> the pinned tab it was opened from, until Chrome names its address.
        this.waiting = new Map(waiting);
        // New pinned tab -> its bookmark and the title and address it was given, until its page
        // has loaded and has a title.
        this.titles = new Map(titles);
    }

    entries() {
        return { waiting: [...this.waiting], titles: [...this.titles] };
    }

    /**
     * A tab Chrome has just created, once the store has filed it. With the setting on, a link from
     * a pinned tab that went to the tab list of the opener's space waits to be pinned. A tab Chrome
     * restored is not a new link, and a New Tab page that names the pinned tab as an incidental
     * opener is not a link at all.
     */
    noteNewTab(store, tab) {
        if (!store.pinsLinks || tab.openerTabId === undefined || store.restoredRanks?.has(tab.id)) return;
        if (isNewTabPage(tab.url || tab.pendingUrl)) return;
        const space = store.spaces.find(s => s.temporaryTabs.includes(tab.id));
        if (space?.spaceBookmarks.includes(tab.openerTabId)) this.waiting.set(tab.id, tab.openerTabId);
    }

    closed(id) {
        this.waiting.delete(id);
        this.titles.delete(id);
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
// there, and it then stays in the tab list.
async function pinBeneathOpener(chromeApi, store, space, tab, openerId, url) {
    if (!space.spaceBookmarks.includes(openerId)) return null;
    const opener = await chromeApi.tabs.get(openerId).catch(() => null);
    // A link opened into another window (Shift+click, a popup) is not beneath the pinned tab, and
    // Duplicate Tab names the tab it copies as the opener.
    if (!opener || opener.windowId !== tab.windowId || opener.url === url) return null;
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
    // Its place among the pinned tabs replaces its place in the list.
    store.linkTails.closed(tab.id);
    const index = pinnedLinkIndex(children, mark.id, tabByBookmark, openerId, tab.id, store.linkTails);
    return createSpacePin(chromeApi, tab, { parentId: String(mark.parentId), index, title: tab.title || url, url });
}

/**
 * Pins a waiting link tab once Chrome has named its address. Runs inside the store's queue.
 * @returns {Promise<boolean>} whether the tab moved to the pinned tabs
 */
export async function pinWaitingLink(chromeApi, store, tab) {
    const openerId = store.linkPins.waiting.get(tab.id);
    if (openerId === undefined) return false;
    const url = tab.url || tab.pendingUrl;
    // A page opened with window.open starts blank before it loads its address.
    if (!url || url === 'about:blank') return false;
    store.linkPins.waiting.delete(tab.id);
    // Gone, or moved by the user in the meantime; and a New Tab page is not a link.
    const space = store.spaces.find(s => s.temporaryTabs.includes(tab.id));
    if (!space || isNewTabPage(url)) return false;
    const tails = store.linkTails.entries();
    let bookmark = null;
    try {
        bookmark = await pinBeneathOpener(chromeApi, store, space, tab, openerId, url);
    } catch (error) {
        Logger.warn('Could not pin a link opened from a pinned tab:', error);
    }
    if (!bookmark) {
        // It stays in the list, where the next links from its opener go after it.
        store.linkTails = new LinkTails(tails);
        return false;
    }
    space.temporaryTabs = space.temporaryTabs.filter(id => id !== tab.id);
    space.spaceBookmarks.push(tab.id);
    store.linkPins.titles.set(tab.id, { bookmarkId: String(bookmark.id), title: bookmark.title, url });
    // The page may have finished loading before its pin did, and then no later update names it.
    const now = await chromeApi.tabs.get(tab.id).catch(() => null);
    if (now) await nameLinkPin(chromeApi, store, now);
    return true;
}

// Chrome shows the address as the title of a page that has none.
const isAddress = (title, url) => !title || title === url || title === String(url).replace(/^[a-z-]+:\/\//, '');

/**
 * A new pinned tab's bookmark is made before its page has loaded. Once it has, the bookmark takes
 * the address the page landed on (a link can redirect) and, once the page has one, its title.
 * Either is left alone if it was changed in the meantime.
 * @returns {Promise<boolean>} whether anything was remembered or changed
 */
export async function nameLinkPin(chromeApi, store, tab) {
    const entry = store.linkPins.titles.get(tab.id);
    if (!entry || tab.status !== 'complete') return false;
    const [bookmark] = await chromeApi.bookmarks.get(entry.bookmarkId).catch(() => []);
    if (!bookmark) {
        store.linkPins.titles.delete(tab.id);
        return true;
    }
    const changes = {};
    if (!entry.landed && tab.url && tab.url !== entry.url && bookmark.url === entry.url) changes.url = tab.url;
    entry.landed = true;
    const named = !isAddress(tab.title, tab.url);
    if (named && bookmark.title === entry.title && tab.title !== entry.title) changes.title = tab.title;
    if (named) store.linkPins.titles.delete(tab.id);
    if (Object.keys(changes).length) await chromeApi.bookmarks.update(bookmark.id, changes);
    if (changes.url) await Utils.setPinnedTabState(tab.id, { pinnedUrl: changes.url, bookmarkId: bookmark.id });
    return true;
}

/**
 * Pins links and names their bookmarks as Chrome reports them. Register after the store's own
 * listeners, so each runs once the store has filed the tab. Only tabs Chrome creates are noted:
 * the store also files tabs again at start-up and when it shows hidden tabs, and those are not
 * new links.
 */
export function followLinkPins(chromeApi, store) {
    const run = operation =>
        store
            .run(async () => {
                if (await operation()) await store.persist();
            })
            .catch(error => Logger.warn('Could not finish a pinned link:', error));
    chromeApi.tabs.onCreated.addListener(tab =>
        run(() => {
            store.linkPins.noteNewTab(store, tab);
            return pinWaitingLink(chromeApi, store, tab);
        })
    );
    chromeApi.tabs.onUpdated.addListener((id, change, tab) => {
        if (change.url) run(() => pinWaitingLink(chromeApi, store, tab));
        if ((change.status === 'complete' || change.title) && store.linkPins.titles.has(id))
            run(() => nameLinkPin(chromeApi, store, tab));
    });
}
