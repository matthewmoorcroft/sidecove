/**
 * A link or some text dragged from a page over the open tabs list shows the same line between
 * rows as a tab being reordered, and opens where that line was: at that place in the space's list
 * and next to the same tabs in Chrome's tab strip. The sidebar passes in what it owns.
 */
import { chromeIndexFor, placeDroppedTab, rowAbovePair } from './drop-position.js';

// Stands for the tab while its place is worked out, before Chrome has given it an id.
const PENDING = -1;

/**
 * listUnder(event)        the shown space's open tabs list when the pointer is over it, else null
 * rowBefore(list, event)  the row a drop at the pointer lands above, or null for the end
 * rowsOf(list)            the list's rows in screen order, to keep a split pair whole
 * showLine(list, row)     shows the drop line above `row`, or after the last row for null
 * hideLine()
 * open(url, beforeId)     opens the tab above the row with that tab id, or at the end for null
 */
export function createLinkDropPosition({ listUnder, rowBefore, rowsOf, showLine, hideLine, open }) {
    // Never between the two halves of a split pair: the link goes above the pair instead.
    const landingRow = (list, event) => rowAbovePair(rowsOf(list), rowBefore(list, event));
    return {
        over(event) {
            const list = listUnder(event);
            if (list) showLine(list, landingRow(list, event));
            else hideLine();
        },
        clear: () => hideLine(),
        placeAt(event) {
            const list = listUnder(event);
            if (!list) return null;
            const row = landingRow(list, event);
            return { beforeId: row?.dataset.tabId ? Number(row.dataset.tabId) : null };
        },
        open: (url, place) => open(url, place.beforeId)
    };
}

/**
 * Opens `url` in a new active tab of `windowId` above the row `beforeId`, and files it there.
 *
 * storedTabs()   the space's stored tab list, read fresh each time
 * adopt(tab)     files the new tab under the space, which refreshes the stored list
 * saveOrder(ids) stores the space's new tab list
 */
export async function openDroppedLink({ chromeApi, url, beforeId, windowId, inverted, storedTabs, adopt, saveOrder }) {
    const tabs = await chromeApi.tabs.query({ windowId });
    const planned = placeDroppedTab(storedTabs(), PENDING, beforeId, inverted);
    const index = chromeIndexFor(planned, PENDING, new Map(tabs.map(tab => [tab.id, tab])), windowId);
    const tab = await chromeApi.tabs.create({ url, active: true, windowId, ...(index === undefined ? {} : { index }) });
    await adopt(tab);
    await saveOrder(placeDroppedTab(storedTabs(), tab.id, beforeId, inverted));
    return tab;
}
