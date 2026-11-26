import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    inListedOrder,
    isOtherWindow,
    onePerPage,
    pageTabIds,
    pickAction,
    selectFavoriteTabs,
    selectListedTabs,
    visibleWindowTabs
} from '../../../src/shared/all-windows.js';
import { selectWindowSpaceTabs } from '../../../src/sidebar/sidebar-tabs.js';

const here = { id: 1, incognito: false };
const tab = (id, windowId, extra = {}) => ({
    id,
    windowId,
    index: id,
    pinned: false,
    incognito: false,
    url: `https://page-${id}.test/`,
    ...extra
});

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

test('a page open in two windows is one entry, this window’s tab when it has one', () => {
    const same = { url: 'https://same.test/' };
    const space = { spaceBookmarks: [], temporaryTabs: [4, 1, 6, 7] };
    const tabs = [
        tab(1, 1, same),
        tab(4, 2, same),
        tab(6, 3, { url: 'https://other.test/' }),
        tab(7, 2, { url: 'https://other.test/' })
    ];
    assert.deepEqual(
        selectListedTabs(space, tabs, here, true).map(t => t.id),
        [1, 6]
    );
    // Two tabs of one page in this window stay two rows, as before.
    const twice = [tab(1, 1, same), tab(4, 1, same)];
    assert.deepEqual(
        selectListedTabs(space, twice, here, true).map(t => t.id),
        [4, 1]
    );
    // With the setting off, nothing is folded together.
    assert.deepEqual(
        selectListedTabs(space, twice, here, false).map(t => t.id),
        [4, 1]
    );
});

// A window with no copy of its own shows the first other window's.
test('a favorite pinned in two windows shows once, as this window’s pin', () => {
    const mail = { pinned: true, url: 'https://mail.test/' };
    const tabs = [
        tab(10, 2, { ...mail, index: 0 }),
        tab(11, 1, { ...mail, index: 0 }),
        tab(12, 3, { ...mail, index: 0 })
    ];
    assert.deepEqual(
        selectFavoriteTabs(tabs, here, { allWindows: true }).map(t => t.id),
        [11]
    );
    assert.deepEqual(
        selectFavoriteTabs(tabs, { id: 9, incognito: false }, { allWindows: true }).map(t => t.id),
        [11]
    );
});

test('picking switches to this window’s tab, or opens the page here, pinned for a favorite', () => {
    assert.deepEqual(pickAction(tab(1, 1), 1), { activate: 1 });
    assert.deepEqual(pickAction(tab(4, 2), 1), {
        open: { windowId: 1, url: 'https://page-4.test/', pinned: false, active: true }
    });
    assert.deepEqual(pickAction(tab(5, 2, { pinned: true }), 1).open.pinned, true);
    assert.equal(
        pickAction(tab(6, 2, { url: undefined, pendingUrl: 'https://loading.test/' }), 1).open.url,
        'https://loading.test/'
    );
});

test('closing an entry closes every open tab of its page in the space, in every window', () => {
    const same = { url: 'https://same.test/' };
    const space = { spaceBookmarks: [8], temporaryTabs: [1, 4, 6, 9] };
    const tabs = [
        tab(1, 1, same),
        tab(4, 2, same),
        tab(6, 3),
        tab(8, 2, same), // a space pinned tab elsewhere keeps its favorite
        tab(9, 7, { ...same, incognito: true }),
        tab(5, 2, same) // another space's tab
    ];
    assert.deepEqual(pageTabIds(space, tabs, here, tabs[0]), [1, 4]);
    assert.deepEqual(pageTabIds(space, tabs, here, tabs[2]), [6]);
});

test('closing one of two tabs of a page in this window closes only that tab', () => {
    const same = { url: 'https://same.test/' };
    const space = { spaceBookmarks: [], temporaryTabs: [1, 2, 4] };
    const tabs = [tab(1, 1, same), tab(2, 1, same), tab(4, 2, same)];
    assert.deepEqual(pageTabIds(space, tabs, here, tabs[1]), [2]);
    assert.deepEqual(pageTabIds(space, [tabs[0], tabs[2]], here, tabs[0]), [1, 4]);
});

test('a page opened here from another window’s tab keeps that tab’s slot in the list', () => {
    const same = (id, windowId) => tab(id, windowId, { url: 'https://same.test/' });
    const space = { spaceBookmarks: [], temporaryTabs: [1, 2, 3, 4, 9] };
    const before = [tab(1, 1), tab(2, 1), same(3, 2), tab(4, 1)];
    const after = [...before, same(9, 1)];
    assert.deepEqual(
        selectListedTabs(space, before, here, true).map(t => t.id),
        [1, 2, 3, 4]
    );
    assert.deepEqual(
        selectListedTabs(space, after, here, true).map(t => t.id),
        [1, 2, 9, 4]
    );
});

test('a copy listed before the other window’s tab already holds the page’s earliest slot', () => {
    const same = (id, windowId) => tab(id, windowId, { url: 'https://same.test/' });
    const tabs = [same(9, 1), tab(1, 1), same(3, 2), tab(4, 1)];
    assert.deepEqual(
        onePerPage(tabs, 1).map(t => t.id),
        [9, 1, 4]
    );
});

test('the panel’s id list swaps a relocated copy into the other window’s slot, nothing else', () => {
    const same = (id, windowId) => tab(id, windowId, { url: 'https://same.test/' });
    const space = { spaceBookmarks: [], temporaryTabs: [1, 3, 4, 9] };
    const tabs = [tab(1, 1), same(3, 2), tab(4, 1), same(9, 1)];
    assert.deepEqual(inListedOrder([1, 3, 4, 9, 77], space, tabs, here, true), [1, 9, 4, 3, 77]);
    assert.deepEqual(inListedOrder([1, 3, 4, 9, 77], space, tabs, here, false), [1, 3, 4, 9, 77]);
});

test('every window lists the pages in the same order, whichever window opened a copy', () => {
    const mk = (id, windowId, page) => tab(id, windowId, { url: `https://x.test/${page}` });
    const space = { spaceBookmarks: [], temporaryTabs: [5, 11, 12, 13] };
    let tabs = [mk(5, 1, 'G'), mk(11, 2, 'P'), mk(12, 2, 'Q'), mk(13, 2, 'R')];
    const open = (id, windowId, page) => {
        tabs = [...tabs, mk(id, windowId, page)];
        space.temporaryTabs.push(id);
    };
    const pagesIn = windowId =>
        selectListedTabs(space, tabs, { id: windowId, incognito: false }, true).map(t => t.url.slice(-1));
    const panelIn = windowId =>
        inListedOrder(space.temporaryTabs, space, tabs, { id: windowId, incognito: false }, true)
            .map(id => tabs.find(t => t.id === id))
            .filter(t => selectListedTabs(space, tabs, { id: windowId, incognito: false }, true).includes(t))
            .map(t => t.url.slice(-1));
    for (const [id, windowId, page] of [
        [21, 1, 'P'],
        [22, 1, 'Q'],
        [23, 2, 'G']
    ]) {
        open(id, windowId, page);
        assert.deepEqual(pagesIn(1), ['G', 'P', 'Q', 'R']);
        assert.deepEqual(pagesIn(2), ['G', 'P', 'Q', 'R']);
        assert.deepEqual(panelIn(1), ['G', 'P', 'Q', 'R']);
        assert.deepEqual(panelIn(2), ['G', 'P', 'Q', 'R']);
    }
    // Each window shows its own tab for the page.
    assert.deepEqual(
        selectListedTabs(space, tabs, here, true).map(t => t.id),
        [5, 21, 22, 13]
    );
    assert.deepEqual(
        selectListedTabs(space, tabs, { id: 2, incognito: false }, true).map(t => t.id),
        [23, 11, 12, 13]
    );
});
