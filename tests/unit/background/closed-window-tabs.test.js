import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    canTakeTabs,
    closedBatch,
    copyReplacedBy,
    hasItsName,
    isReopenablePage,
    pageInSpace,
    pickTargetWindow,
    placeReopened,
    tabsToReopen,
    windowContents
} from '../../../src/background/closed-window-tabs.js';

const space = (id, temporaryTabs, over = {}) => ({ id, spaceBookmarks: [], pinnedTabs: [], temporaryTabs, ...over });

test('only http and https pages are reopened', () => {
    assert.equal(isReopenablePage('https://a.test/'), true);
    assert.equal(isReopenablePage('HTTP://a.test/'), true);
    for (const url of ['chrome://newtab/', 'about:blank', 'chrome-extension://x/sidebar.html', 'file:///a', '', null])
        assert.equal(isReopenablePage(url), false, url);
});

test('only a normal window with a tab strip takes reopened tabs', () => {
    assert.equal(canTakeTabs({ type: 'normal', alwaysOnTop: false, incognito: false }), true);
    // Google Meet's picture-in-picture window is "normal" but always on top.
    assert.equal(canTakeTabs({ type: 'normal', alwaysOnTop: true, incognito: false }), false);
    assert.equal(canTakeTabs({ type: 'normal', incognito: true }), false);
    for (const type of ['popup', 'app', 'devtools', 'panel']) assert.equal(canTakeTabs({ type }), false, type);
    assert.equal(canTakeTabs(undefined), false);
});

test('each window notes its ordinary tabs, with their spaces and the lists to put them back in', () => {
    const spaces = [space('s1', [10, 20, 30, 40], { spaceBookmarks: [11] }), space('s2', [50, 60]), space('s3', [])];
    const tabs = [
        { id: 10, windowId: 1, url: 'https://a.test/1' },
        { id: 11, windowId: 2, url: 'https://a.test/favorite' },
        { id: 20, windowId: 2, url: 'https://a.test/2' },
        { id: 30, windowId: 2, url: 'chrome://newtab/' },
        { id: 40, windowId: 2, url: '', pendingUrl: 'https://a.test/4' },
        { id: 50, windowId: 2, url: 'https://b.test/', pinned: true },
        { id: 60, windowId: 2, url: 'https://b.test/2' },
        { id: 70, windowId: 3, url: 'chrome://newtab/' }
    ];
    assert.deepEqual(windowContents(spaces, tabs), {
        1: { tabs: [{ tabId: 10, url: 'https://a.test/1', spaceId: 's1' }], layouts: { s1: [10, 20, 30, 40] } },
        2: {
            tabs: [
                { tabId: 20, url: 'https://a.test/2', spaceId: 's1' },
                { tabId: 40, url: 'https://a.test/4', spaceId: 's1' },
                { tabId: 60, url: 'https://b.test/2', spaceId: 's2' }
            ],
            layouts: { s1: [10, 20, 30, 40], s2: [50, 60] }
        },
        // A window with nothing to reopen is still known, so it is not mistaken for a closed one.
        3: { tabs: [], layouts: {} }
    });
});

test('a closed window gives back only the tabs that closed with it', () => {
    const contents = {
        tabs: [
            { tabId: 20, url: 'https://a.test/2', spaceId: 's1' },
            { tabId: 60, url: 'https://b.test/2', spaceId: 's2' }
        ],
        layouts: { s1: [10, 20], s2: [50, 60] }
    };
    // 60 is still open: it was moved into another window.
    assert.deepEqual(closedBatch(contents, new Set([10, 60])), {
        tabs: [{ tabId: 20, url: 'https://a.test/2', spaceId: 's1' }],
        layouts: { s1: [10, 20] }
    });
    assert.deepEqual(closedBatch(undefined, new Set()), { tabs: [], layouts: {} });
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

test('a page still open in the same space in a window that stays, or a tab whose space is gone, is not reopened', () => {
    const batch = {
        tabs: [
            { tabId: 20, url: 'https://a.test/open', spaceId: 's1' },
            { tabId: 30, url: 'https://a.test/closed', spaceId: 's1' },
            { tabId: 40, url: 'https://a.test/gone', spaceId: 'deleted' },
            { tabId: 50, url: 'https://a.test/elsewhere', spaceId: 's1' }
        ],
        layouts: { s1: [20, 30, 50], deleted: [40] }
    };
    // The page of 50 is open, but in another space: this space still loses it if it is not reopened.
    const openPages = new Set([
        pageInSpace('s1', 'https://a.test/open'),
        pageInSpace('s2', 'https://a.test/elsewhere')
    ]);
    const plan = tabsToReopen(batch, { openPages, spaceIds: new Set(['s1']) });
    assert.deepEqual(
        plan.map(tab => tab.tabId),
        [30, 50]
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

test("a tab that opens with a copy's page in a window that was not open then replaces that copy", () => {
    const copies = [
        { copyId: 100, url: 'https://a.test/1', windowIds: [1] },
        { copyId: 101, url: 'https://a.test/2', windowIds: [1] }
    ];
    const normal = { id: 7, type: 'normal', alwaysOnTop: false, incognito: false };
    // Chrome brings the closed window back as window 7.
    assert.equal(copyReplacedBy(copies, { id: 200, windowId: 7, url: 'https://a.test/2' }, normal), copies[1]);
    assert.equal(
        copyReplacedBy(copies, { id: 201, windowId: 7, url: '', pendingUrl: 'https://a.test/1' }, normal),
        copies[0]
    );
    // A tab opened in a window that was already open, or another page, is just a tab.
    assert.equal(copyReplacedBy(copies, { id: 202, windowId: 1, url: 'https://a.test/1' }, { ...normal, id: 1 }), null);
    assert.equal(copyReplacedBy(copies, { id: 203, windowId: 7, url: 'https://a.test/3' }, normal), null);
    assert.equal(copyReplacedBy(copies, { id: 204, windowId: 7, url: 'chrome://newtab/' }, normal), null);
    // The copy itself is not its own original.
    assert.equal(copyReplacedBy(copies, { id: 100, windowId: 9, url: 'https://a.test/1' }, { ...normal, id: 9 }), null);
});

test('a private tab, or one in a window that cannot take tabs, is never the original', () => {
    const copies = [{ copyId: 100, url: 'https://a.test/1', windowIds: [1] }];
    const tab = { id: 200, windowId: 7, url: 'https://a.test/1' };
    assert.equal(copyReplacedBy(copies, { ...tab, incognito: true }, { id: 7, type: 'normal', incognito: true }), null);
    assert.equal(copyReplacedBy(copies, tab, { id: 7, type: 'popup' }), null);
    assert.equal(copyReplacedBy(copies, tab, { id: 7, type: 'normal', alwaysOnTop: true }), null);
    assert.equal(copyReplacedBy(copies, tab, null), null);
});
