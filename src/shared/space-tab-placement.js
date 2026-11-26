// Where a tab Chrome has just created goes in its space's section.

import { placeLinkTab } from './link-tab-placement.js';

/**
 * @param {object} store the space store
 * @param {object} space the space the tab joins
 * @param {string} key the section it joins
 * @param {chrome.tabs.Tab & {copyOf?: number}} tab the new tab (see duplicate-tab.js for copyOf)
 * @param {{restored?: object, url?: string, isNewTabPage: boolean}} how the store read it
 */
export function placeNewTab(store, space, key, tab, { restored, url, isNewTabPage }) {
    if (restored) {
        store.restoredMetadata.push({ ...restored, tabId: tab.id });
        // Preserve extension order when Chrome restores tabs in a different order.
        store.restoredRanks ||= new Map();
        store.restoredRanks.set(tab.id, restored.order);
        space[key].push(tab.id);
        space[key].sort((a, b) => (store.restoredRanks.get(a) ?? Infinity) - (store.restoredRanks.get(b) ?? Infinity));
    } else if (key === 'temporaryTabs' && tab.copyOf !== undefined) {
        // A copy goes directly beneath the tab it copies, ahead of that tab's links, and is not one
        // of its links.
        space[key] = placeLinkTab(space[key], tab.copyOf, tab.id, undefined, store.invertTabOrder);
    } else if (key === 'temporaryTabs' && tab.openerTabId !== undefined && !(url && isNewTabPage)) {
        // A link opened from a tab goes below it, whichever way the list is drawn. Chrome reports
        // no address yet for some link tabs, so only a named new-tab page is left out.
        space[key] = store.linkTails.place(space[key], tab.openerTabId, tab.id, store.invertTabOrder);
    } else space[key].push(tab.id);
}
