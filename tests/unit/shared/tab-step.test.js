import test from 'node:test';
import assert from 'node:assert/strict';
import { tabsInDisplayOrder, tabCycleOrder, adjacentTabId } from '../../../src/shared/tab-step.js';

const space = { spaceBookmarks: [1, 2], temporaryTabs: [3, 4, 5] };
const open = ids => new Set(ids);

test('with new tabs at the top, the other tabs are walked newest first, after the favorites', () => {
    const order = tabsInDisplayOrder(space, { invertTabOrder: true, openTabIds: open([1, 2, 3, 4, 5]) });
    assert.deepEqual(order, [1, 2, 5, 4, 3]);
});

test('with new tabs at the bottom, the other tabs keep their stored order', () => {
    const order = tabsInDisplayOrder(space, { invertTabOrder: false, openTabIds: open([1, 2, 3, 4, 5]) });
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test('tabs outside the window and tabs listed twice are left out', () => {
    const crowded = { spaceBookmarks: [1], temporaryTabs: [1, 3, 9] };
    assert.deepEqual(tabsInDisplayOrder(crowded, { invertTabOrder: false, openTabIds: open([1, 3]) }), [1, 3]);
});

test('a missing space has no tabs', () => {
    assert.deepEqual(tabsInDisplayOrder(undefined, { openTabIds: open([1]) }), []);
});

test('next and previous wrap at both ends', () => {
    const ordered = [1, 2, 5];
    assert.equal(adjacentTabId(ordered, 1, 'next'), 2);
    assert.equal(adjacentTabId(ordered, 5, 'next'), 1);
    assert.equal(adjacentTabId(ordered, 1, 'prev'), 5);
    assert.equal(adjacentTabId(ordered, 2, 'prev'), 1);
});

test('there is nowhere to go from a tab outside the list or when it is the only tab', () => {
    assert.equal(adjacentTabId([1, 2], 9, 'next'), null);
    assert.equal(adjacentTabId([1], 1, 'next'), null);
    assert.equal(adjacentTabId([], 1, 'prev'), null);
});

test('pinned tabs come first in the cycle, in tab strip order, whatever the space', () => {
    const order =
        tabsInDisplayOrder === undefined
            ? []
            : tabCycleOrder(space, { pinnedIds: [8, 9], openTabIds: open([1, 2, 3, 4, 5, 8, 9]) });
    assert.deepEqual(order, [8, 9, 1, 2, 3, 4, 5]);
});

test('with separate favorites per space, only the space’s own pinned tabs are walked', () => {
    const mine = { ...space, pinnedTabs: [9] };
    const options = { pinnedIds: [8, 9], perSpaceFavorites: true, openTabIds: open([1, 2, 3, 4, 5, 8, 9]) };
    assert.deepEqual(tabCycleOrder(mine, options), [9, 1, 2, 3, 4, 5]);
});

test('pinned tabs that are not open, or already listed in the space, appear once', () => {
    const listed = { spaceBookmarks: [1], temporaryTabs: [3, 8] };
    const order = tabCycleOrder(listed, { pinnedIds: [8, 9], openTabIds: open([1, 3, 8]) });
    assert.deepEqual(order, [8, 1, 3]);
});

test('with only pinned tabs, or no space, the cycle is still the pinned tabs', () => {
    assert.deepEqual(tabCycleOrder(undefined, { pinnedIds: [8, 9], openTabIds: open([8, 9]) }), [8, 9]);
});

test('next from a pinned tab goes to the next pinned tab, and from the last one to the space', () => {
    const ordered = tabCycleOrder(space, { pinnedIds: [8, 9], openTabIds: open([1, 2, 3, 4, 5, 8, 9]) });
    assert.equal(adjacentTabId(ordered, 8, 'next'), 9);
    assert.equal(adjacentTabId(ordered, 9, 'next'), 1);
    assert.equal(adjacentTabId(ordered, 1, 'prev'), 9);
    assert.equal(adjacentTabId(ordered, 8, 'prev'), 5);
});
