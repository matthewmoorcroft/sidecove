import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isOtherWindow,
    selectFavoriteTabs,
    selectListedTabs,
    visibleWindowTabs
} from '../../../../../src/sidebar/features/all-windows/all-windows.js';
import { selectWindowSpaceTabs } from '../../../../../src/sidebar/sidebar-tabs.js';

const here = { id: 1, incognito: false };
const tab = (id, windowId, extra = {}) => ({ id, windowId, index: id, pinned: false, incognito: false, ...extra });

test('with the setting off, the list is exactly this window’s tabs, as before', () => {
    const space = { spaceBookmarks: [3, 2], temporaryTabs: [4, 1, 5, 6] };
    const tabs = [tab(1, 1), tab(2, 2), tab(3, 1), tab(4, 2), tab(5, 1, { pinned: true }), tab(6, 1)];
    assert.deepEqual(
        selectListedTabs(space, tabs, here, false).map(t => t.id),
        selectWindowSpaceTabs(space, tabs, 1).map(t => t.id)
    );
    assert.deepEqual(
        selectListedTabs(space, tabs, here, false).map(t => t.id),
        [3, 1, 6]
    );
});

test('with the setting on, other windows’ open tabs join the list in the space’s order, once each', () => {
    const space = { spaceBookmarks: [3], temporaryTabs: [4, 1, 6, 4] };
    const tabs = [tab(1, 1), tab(3, 1), tab(4, 2), tab(6, 3), tab(7, 2)];
    assert.deepEqual(
        selectListedTabs(space, tabs, here, true).map(t => t.id),
        [3, 4, 1, 6]
    );
});

test('a pinned tab open in another window stays with that window’s panel', () => {
    const space = { spaceBookmarks: [3, 8], temporaryTabs: [4] };
    const tabs = [tab(3, 1), tab(8, 2), tab(4, 2)];
    assert.deepEqual(
        selectListedTabs(space, tabs, here, true).map(t => t.id),
        [3, 4]
    );
});

test('incognito and normal windows never list each other’s tabs', () => {
    const tabs = [tab(1, 1), tab(2, 2), tab(3, 9, { incognito: true })];
    assert.deepEqual(
        visibleWindowTabs(tabs, here, true).map(t => t.id),
        [1, 2]
    );
    assert.deepEqual(
        visibleWindowTabs(tabs, { id: 9, incognito: true }, true).map(t => t.id),
        [3]
    );
    assert.deepEqual(
        visibleWindowTabs(tabs, here, false).map(t => t.id),
        [1]
    );
});

test('favorites: this window’s pins first in tab strip order, then each other window’s', () => {
    const tabs = [
        tab(10, 2, { pinned: true, index: 0 }),
        tab(11, 1, { pinned: true, index: 1 }),
        tab(12, 1, { pinned: true, index: 0 }),
        tab(13, 3, { pinned: true, index: 0 }),
        tab(14, 2, { pinned: true, index: 1 }),
        tab(15, 1, { index: 2 })
    ];
    assert.deepEqual(
        selectFavoriteTabs(tabs, here).map(t => t.id),
        [12, 11]
    );
    assert.deepEqual(
        selectFavoriteTabs(tabs, here, { allWindows: true }).map(t => t.id),
        [12, 11, 10, 14, 13]
    );
});

test('separate favorites per space filter pins from every window by the shown space', () => {
    const tabs = [tab(10, 2, { pinned: true }), tab(11, 1, { pinned: true }), tab(12, 2, { pinned: true })];
    const options = { perSpace: true, spaceTabIds: new Set([10, 11]) };
    assert.deepEqual(
        selectFavoriteTabs(tabs, here, options).map(t => t.id),
        [11]
    );
    assert.deepEqual(
        selectFavoriteTabs(tabs, here, { ...options, allWindows: true }).map(t => t.id),
        [11, 10]
    );
});

test('a tab is from another window only when its window is known and differs', () => {
    assert.equal(isOtherWindow(tab(1, 2), 1), true);
    assert.equal(isOtherWindow(tab(1, 1), 1), false);
    assert.equal(isOtherWindow({ id: null }, 1), false);
});
