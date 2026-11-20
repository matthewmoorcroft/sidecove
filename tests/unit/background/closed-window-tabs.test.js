import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    emptyBatch,
    hasItsName,
    isReopenablePage,
    noteClosedTab,
    pickTargetWindow,
    placeReopened,
    tabsToReopen
} from '../../../src/background/closed-window-tabs.js';

const record = (tabId, url, over = {}) => ({ tabId, spaceId: 's1', section: 'temporaryTabs', order: 0, url, ...over });
const close = (batch, tabId, url, layout, over) =>
    noteClosedTab(batch, { tabId, record: record(tabId, url, over), layout });

test('only http and https pages are reopened', () => {
    assert.equal(isReopenablePage('https://a.test/'), true);
    assert.equal(isReopenablePage('HTTP://a.test/'), true);
    for (const url of ['chrome://newtab/', 'about:blank', 'chrome-extension://x/sidebar.html', 'file:///a', '', null])
        assert.equal(isReopenablePage(url), false, url);
});

test('a closing window gathers its ordinary tabs and the list each space had before it closed', () => {
    let batch = emptyBatch();
    batch = close(batch, 20, 'https://a.test/1', [10, 20, 30, 40]);
    // The second tab is reported after the first has left the list; the first list is the one kept.
    batch = close(batch, 30, 'https://a.test/2', [10, 30, 40]);
    batch = close(batch, 50, 'https://b.test/', [50, 60], { spaceId: 's2' });
    assert.deepEqual(batch.tabs, [
        { tabId: 20, url: 'https://a.test/1', spaceId: 's1' },
        { tabId: 30, url: 'https://a.test/2', spaceId: 's1' },
        { tabId: 50, url: 'https://b.test/', spaceId: 's2' }
    ]);
    assert.deepEqual(batch.layouts, { s1: [10, 20, 30, 40], s2: [50, 60] });
});

test('pinned tabs, favorites, New Tab and other pages that cannot be reopened are left out', () => {
    let batch = emptyBatch();
    batch = close(batch, 1, 'https://a.test/', [1], { section: 'pinnedTabs' });
    batch = close(batch, 2, 'https://a.test/', [2], { section: 'spaceBookmarks' });
    batch = close(batch, 3, 'chrome://newtab/', [3]);
    batch = noteClosedTab(batch, { tabId: 4, record: null, layout: [4] });
    assert.deepEqual(batch, emptyBatch());
});

test('tabs reopen in the order they were listed, space by space', () => {
    const batch = {
        tabs: [
            { tabId: 30, url: 'https://a.test/3', spaceId: 's1' },
            { tabId: 50, url: 'https://b.test/', spaceId: 's2' },
            { tabId: 20, url: 'https://a.test/2', spaceId: 's1' }
        ],
        layouts: { s1: [10, 20, 30], s2: [50] }
    };
    const plan = tabsToReopen(batch, { openPages: new Set(), spaceIds: new Set(['s1', 's2']) });
    assert.deepEqual(
        plan.map(tab => tab.tabId),
        [20, 30, 50]
    );
});

test('a page still open in a window that stays, or a tab whose space is gone, is not reopened', () => {
    const batch = {
        tabs: [
            { tabId: 20, url: 'https://a.test/open', spaceId: 's1' },
            { tabId: 30, url: 'https://a.test/closed', spaceId: 's1' },
            { tabId: 40, url: 'https://a.test/gone', spaceId: 'deleted' }
        ],
        layouts: { s1: [20, 30], deleted: [40] }
    };
    const plan = tabsToReopen(batch, { openPages: new Set(['https://a.test/open']), spaceIds: new Set(['s1']) });
    assert.deepEqual(
        plan.map(tab => tab.tabId),
        [30]
    );
});

test('reopened tabs go back where the closed ones were', () => {
    // [10, 20, 30, 40, 50]: window 2 had 20 and 40; they come back as 120 and 140.
    const next = placeReopened(
        [10, 30, 50],
        [10, 20, 30, 40, 50],
        new Map([
            [20, 120],
            [40, 140]
        ])
    );
    assert.deepEqual(next, [10, 120, 30, 140, 50]);
});

test('reopened tabs at the top, next to each other, or after tabs that are gone keep their order', () => {
    const reopened = new Map([
        [1, 101],
        [2, 102],
        [4, 104]
    ]);
    // 3 closed since and is not reopened, so 4 goes after 2.
    assert.deepEqual(placeReopened([5], [1, 2, 3, 4, 5], reopened), [101, 102, 104, 5]);
    assert.deepEqual(placeReopened([], [1, 2, 3, 4], reopened), [101, 102, 104]);
});

test('a tab opened since keeps its place, and a new tab already listed is not listed twice', () => {
    const next = placeReopened([10, 99, 120, 30], [10, 20, 30], new Map([[20, 120]]));
    assert.deepEqual(next, [10, 120, 99, 30]);
});

test('the window focused most recently is the one tabs reopen in', () => {
    const windows = [{ id: 1 }, { id: 2, focused: true }, { id: 3 }];
    assert.equal(pickTargetWindow(windows, { 1: 500, 2: 100, 3: 900 }).id, 3);
    assert.equal(pickTargetWindow(windows, {}).id, 2);
    assert.equal(pickTargetWindow([{ id: 4 }]).id, 4);
    assert.equal(pickTargetWindow([], {}), null);
});

test('a tab has its own name once its page has a title or has loaded', () => {
    const tab = { url: 'https://a.test/page', title: 'a.test/page' };
    assert.equal(hasItsName({}, tab), false);
    assert.equal(hasItsName({ title: 'a.test/page' }, tab), false);
    assert.equal(hasItsName({ title: 'A page' }, { ...tab, title: 'A page' }), true);
    assert.equal(hasItsName({ status: 'complete' }, tab), true);
    assert.equal(hasItsName({ status: 'loading' }, { url: '', title: '' }), false);
});
