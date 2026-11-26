// Duplicating a tab. Chrome puts the copy directly right of the tab it copies, but names the
// active tab, not the copied one, as its opener, so the copy would be filed as a link of whatever
// tab you were on. A new tab on the same address as the tab to its left is that tab's copy, and
// goes directly beneath it in the list, as in Arc.

import { isNewTabPage } from './new-tab-page.js';
import { placeLinkTab } from './link-tab-placement.js';
import { ownerOf } from './space-membership.js';

const addressOf = tab => tab?.url || tab?.pendingUrl;
// Two blank tabs side by side share an address without one copying the other.
const mayBeCopy = tab => {
    const url = addressOf(tab);
    return Boolean(url) && url !== 'about:blank' && !isNewTabPage(url);
};

/**
 * @param {chrome.tabs.Tab} tab a tab Chrome has just created
 * @param {chrome.tabs.Tab[]} windowTabs the tabs of its window, as they are now
 * @returns {chrome.tabs.Tab|null} the tab it is a copy of
 */
export function copiedTab(tab, windowTabs) {
    if (!mayBeCopy(tab)) return null;
    // A tab left of it may have closed or moved since Chrome reported it, so its place is read now.
    const index = windowTabs.find(other => other.id === tab.id)?.index ?? tab.index;
    if (index === undefined) return null;
    const left = windowTabs.find(
        other => other.id !== tab.id && other.windowId === tab.windowId && other.index === index - 1
    );
    return left && Boolean(left.pinned) === Boolean(tab.pinned) && addressOf(left) === addressOf(tab) ? left : null;
}

/**
 * The tab as the store files it. A copy names the tab it copies as its opener, so it joins that
 * tab's space, and as `copyOf`, so it goes directly beneath it. The store remembers it as a copy,
 * so it is never pinned as a link from a pinned tab (see pinned-tab-links.js).
 */
export function fileCopy(store, tab, windowTabs) {
    const source = copiedTab(tab, windowTabs);
    if (!source) return tab;
    store.copies.add(tab.id);
    // A copy of a pinned tab arrives pinned; the saved favorites may unpin it (see
    // background/saved-favorites.js), and it then goes where a link from the pinned tab would.
    if (tab.pinned) store.pinnedCopies.set(tab.id, source.id);
    return { ...tab, openerTabId: source.id, copyOf: source.id };
}

export async function asFiled(chromeApi, store, tab) {
    if (!mayBeCopy(tab)) return tab;
    const windowTabs = await chromeApi.tabs.query({ windowId: tab.windowId }).catch(() => []);
    return fileCopy(store, tab, windowTabs);
}

/**
 * The open tabs as a starting worker files them. A tab in no space was created while the worker
 * was stopped, and the event that woke it comes too late to file it, so a copy is filed here.
 */
export function filedAtStart(store, live) {
    return live.map(tab =>
        ownerOf(store.spaces, tab.id) || store.hidden.has(tab.id) ? tab : fileCopy(store, tab, live)
    );
}

/**
 * A copy of a pinned tab that has just been unpinned goes to the top of the list, as a link from
 * the pinned tab does, rather than to the bottom as an unpinned favorite would.
 * @returns {boolean} whether the copy was placed
 */
export function unpinnedCopyPlaced(store, space, tab) {
    const sourceId = store.pinnedCopies.get(tab.id);
    if (tab.pinned || sourceId === undefined || !space.pinnedTabs.includes(tab.id)) return false;
    store.pinnedCopies.delete(tab.id);
    space.pinnedTabs = space.pinnedTabs.filter(id => id !== tab.id);
    space.temporaryTabs = placeLinkTab(space.temporaryTabs, sourceId, tab.id, undefined, store.invertTabOrder);
    return true;
}
