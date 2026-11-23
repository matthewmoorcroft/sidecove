import { Utils } from './utils.js';

/**
 * Makes a tab a pinned tab of a space: its bookmark is the durable record, and the binding ties
 * this tab to that bookmark. The side panel's Pin Tab and the service worker both pin through
 * here; each then files the tab under the space's pinned tabs in its own copy of the spaces.
 *
 * @param {typeof chrome} chromeApi
 * @param {chrome.tabs.Tab} tab
 * @param {{parentId: string, index?: number, title?: string, url?: string}} where the folder
 *   (the space's folder or one inside it) and, if given, the position in it
 * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} the new bookmark
 */
export async function createSpacePin(chromeApi, tab, { parentId, index, title = tab.title, url = tab.url }) {
    const bookmark = await chromeApi.bookmarks.create({
        parentId,
        ...(index === undefined ? {} : { index }),
        title,
        url
    });
    await Utils.setPinnedTabState(tab.id, { pinnedUrl: url, bookmarkId: bookmark.id });
    return bookmark;
}
