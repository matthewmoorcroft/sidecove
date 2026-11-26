import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asFiled, copiedTab, fileCopy, filedAtStart, unpinnedCopyPlaced } from '../../../src/shared/duplicate-tab.js';

const tab = (id, index, url, extra = {}) => ({ id, windowId: 1, index, pinned: false, url, ...extra });
const strip = [tab(1, 0, 'https://a.test/'), tab(2, 1, 'https://b.test/'), tab(3, 2, 'https://c.test/')];

test('a new tab right of a tab on the same address is its copy', () => {
    assert.equal(copiedTab(tab(9, 2, 'https://b.test/'), strip)?.id, 2);
    assert.equal(copiedTab(tab(9, 2, undefined, { pendingUrl: 'https://b.test/' }), strip)?.id, 2);
    const pins = [tab(1, 0, 'https://p.test/', { pinned: true })];
    assert.equal(copiedTab(tab(9, 1, 'https://p.test/', { pinned: true }), pins)?.id, 1);
});

test('a link, or a new tab on another address, is not a copy', () => {
    assert.equal(copiedTab(tab(9, 2, 'https://link.test/', { openerTabId: 2 }), strip), null);
    assert.equal(copiedTab(tab(9, 3, 'https://b.test/'), strip), null, 'not directly right of it');
    const pins = [tab(1, 0, 'https://p.test/', { pinned: true })];
    assert.equal(copiedTab(tab(9, 1, 'https://p.test/'), pins), null, 'a pinned tab next to an ordinary one');
});

test('a tab in another window, or with no address or place yet, is not a copy', () => {
    assert.equal(copiedTab(tab(9, 2, 'https://b.test/', { windowId: 2 }), strip), null);
    assert.equal(copiedTab(tab(9, 2, undefined), strip), null);
    assert.equal(copiedTab(tab(9, undefined, 'https://b.test/'), strip), null);
});

test('a blank or New Tab page next to another is not a copy', () => {
    for (const url of ['about:blank', 'chrome://newtab/', 'chrome://new-tab-page/']) {
        assert.equal(copiedTab(tab(9, 1, url), [tab(1, 0, url)]), null, url);
    }
});

test('a copy is filed as beneath the tab it copies, and remembered as a copy', async () => {
    const chromeApi = { tabs: { query: async ({ windowId }) => strip.filter(t => t.windowId === windowId) } };
    const store = { copies: new Set() };
    const copy = tab(9, 2, 'https://b.test/', { openerTabId: 3 });
    assert.deepEqual(await asFiled(chromeApi, store, copy), { ...copy, openerTabId: 2, copyOf: 2 });
    assert.deepEqual([...store.copies], [9]);
    const link = tab(10, 2, 'https://link.test/', { openerTabId: 2 });
    assert.equal(await asFiled(chromeApi, store, link), link);
    assert.deepEqual([...store.copies], [9]);
});

test('the copy’s place is read from its window now, and a tab is never a copy of itself', () => {
    // Chrome reported the copy at index 3; a tab left of it has closed since.
    const now = [tab(3, 0, 'https://c.test/'), tab(7, 1, 'https://b.test/'), tab(9, 2, 'https://b.test/')];
    assert.equal(copiedTab(tab(9, 3, 'https://b.test/'), now)?.id, 7);
    assert.equal(copiedTab(tab(9, 1, 'https://b.test/'), [tab(9, 0, 'https://b.test/')]), null);
});

test('a starting worker files a tab in no space as the copy it is, and leaves listed tabs alone', () => {
    const live = [
        tab(2, 0, 'https://b.test/'),
        tab(8, 1, 'https://b.test/', { openerTabId: 3 }),
        tab(3, 2, 'https://c.test/')
    ];
    const store = {
        spaces: [{ spaceBookmarks: [], temporaryTabs: [2, 3], pinnedTabs: [] }],
        hidden: new Set(),
        copies: new Set()
    };
    assert.deepEqual(
        filedAtStart(store, live).map(t => [t.id, t.copyOf]),
        [
            [2, undefined],
            [8, 2],
            [3, undefined]
        ]
    );
    assert.deepEqual([...store.copies], [8]);
    store.hidden.add(8);
    store.copies.clear();
    assert.equal(filedAtStart(store, live)[1].copyOf, undefined, 'a tab Clean All is hiding');
    assert.equal(fileCopy(store, live[0], live), live[0]);
});

test('a tab that cannot be a copy is filed without looking at its window', async () => {
    let queried = 0;
    const chromeApi = { tabs: { query: async () => (queried++, strip) } };
    const store = { copies: new Set() };
    for (const url of [undefined, 'about:blank', 'chrome://newtab/']) await asFiled(chromeApi, store, tab(9, 1, url));
    assert.equal(queried, 0);
});

test('a pinned copy, once unpinned, goes to the top of its space as a link from its source would', () => {
    const pins = [tab(1, 0, 'https://p.test/', { pinned: true })];
    const store = { copies: new Set(), pinnedCopies: new Map(), invertTabOrder: false };
    fileCopy(store, tab(9, 1, 'https://p.test/', { pinned: true }), pins);
    assert.deepEqual([...store.pinnedCopies], [[9, 1]]);
    const space = { pinnedTabs: [1, 9], spaceBookmarks: [], temporaryTabs: [5, 6] };
    assert.equal(unpinnedCopyPlaced(store, space, tab(9, 1, 'https://p.test/', { pinned: true })), false);
    assert.equal(unpinnedCopyPlaced(store, space, tab(9, 1, 'https://p.test/')), true);
    assert.deepEqual(space, { pinnedTabs: [1], spaceBookmarks: [], temporaryTabs: [9, 5, 6] });
    // Drawn reversed, the top of the list is the end of the stored one.
    const reversed = { ...store, invertTabOrder: true, pinnedCopies: new Map([[9, 1]]) };
    const other = { pinnedTabs: [1, 9], spaceBookmarks: [], temporaryTabs: [5, 6] };
    unpinnedCopyPlaced(reversed, other, tab(9, 1, 'https://p.test/'));
    assert.deepEqual(other.temporaryTabs, [5, 6, 9]);
});

test('an unpinned tab that was not a pinned copy is left to the usual unpinning', () => {
    const store = { copies: new Set(), pinnedCopies: new Map() };
    const space = { pinnedTabs: [3], spaceBookmarks: [], temporaryTabs: [] };
    assert.equal(unpinnedCopyPlaced(store, space, tab(3, 0, 'https://p.test/')), false);
    assert.deepEqual(space.pinnedTabs, [3]);
});
