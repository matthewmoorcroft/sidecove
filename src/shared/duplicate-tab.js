// Duplicating a tab. Chrome puts the copy directly right of the tab it copies, but names the
// active tab, not the copied one, as its opener, so the copy would be filed as a link of whatever
// tab you were on. A new tab on the same address as the tab to its left is that tab's copy, and
// goes directly beneath it in the list, as in Arc.

import { isNewTabPage } from './new-tab-page.js';

const addressOf = tab => tab?.url || tab?.pendingUrl;

/**
 * @param {chrome.tabs.Tab} tab a tab Chrome has just created
 * @param {chrome.tabs.Tab[]} windowTabs the tabs of its window
 * @returns {chrome.tabs.Tab|null} the tab it is a copy of
 */
export function copiedTab(tab, windowTabs) {
    const url = addressOf(tab);
    // Two blank tabs side by side share an address without one copying the other.
    if (!url || url === 'about:blank' || isNewTabPage(url) || tab.index === undefined) return null;
    const left = windowTabs.find(other => other.windowId === tab.windowId && other.index === tab.index - 1);
    return left && Boolean(left.pinned) === Boolean(tab.pinned) && addressOf(left) === url ? left : null;
}

/**
 * The tab as the store files it. A copy names the tab it copies as its opener, so it joins that
 * tab's space, and as `copyOf`, so it goes directly beneath it. The store remembers it as a copy,
 * so it is never pinned as a link from a pinned tab (see pinned-tab-links.js).
 */
export async function asFiled(chromeApi, store, tab) {
    const windowTabs = await chromeApi.tabs.query({ windowId: tab.windowId }).catch(() => []);
    const source = copiedTab(tab, windowTabs);
    if (!source) return tab;
    store.copies.add(tab.id);
    return { ...tab, openerTabId: source.id, copyOf: source.id };
}
