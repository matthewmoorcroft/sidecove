/**
 * Where a link dropped between two rows of the open tabs list goes: in the space's stored tab
 * list and in Chrome's tab strip. Pure: no chrome.* and no DOM.
 *
 * The stored list is in Chrome order (left to right) and is drawn reversed when "Show new tabs at
 * the top" is on, so the place is worked out on screen and converted back, as for link tabs.
 */

/**
 * @param {number[]} stored the space's stored tab list (not changed)
 * @param {number} newId the dropped link's tab
 * @param {number|null} beforeId the row the drop line showed it above, or null for the end
 * @param {boolean} inverted whether the list is drawn reversed
 * @returns {number[]} the new stored list
 */
export function placeDroppedTab(stored, newId, beforeId, inverted) {
    const screen = (inverted ? [...stored].reverse() : [...stored]).filter(id => id !== newId);
    const at = beforeId === null ? -1 : screen.indexOf(beforeId);
    screen.splice(at === -1 ? screen.length : at, 0, newId);
    return inverted ? screen.reverse() : screen;
}

/**
 * The index to open the tab at in Chrome's tab strip so it sits next to the same tabs as in the
 * list: just right of the nearest tab before it in this window, else just left of the nearest one
 * after it. A split pair is stepped over whole, since Chrome keeps its two tabs together. Undefined
 * when no neighbour is in this window, which leaves Chrome's own choice.
 *
 * @param {number[]} stored the new stored list, holding `newId`
 * @param {number} newId
 * @param {Map<number, {index: number, windowId: number, splitViewId?: number}>} tabsById
 * @param {number} windowId the window the tab opens in
 */
export function chromeIndexFor(stored, newId, tabsById, windowId) {
    const at = stored.indexOf(newId);
    const here = id => tabsById.get(id)?.windowId === windowId;
    const pairIndexes = tab => {
        const split = Number.isInteger(tab.splitViewId) && tab.splitViewId !== -1 ? tab.splitViewId : null;
        if (split === null) return [tab.index];
        return [...tabsById.values()]
            .filter(other => other.windowId === windowId && other.splitViewId === split)
            .map(other => other.index);
    };
    const before = stored.slice(0, at).reverse().find(here);
    if (before !== undefined) return Math.max(...pairIndexes(tabsById.get(before))) + 1;
    const after = stored.slice(at + 1).find(here);
    if (after !== undefined) return Math.min(...pairIndexes(tabsById.get(after)));
    return undefined;
}
