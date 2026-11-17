import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { removeTab } from '../../../src/shared/space-tab-removal.js';

let sync, tabs, calls, store;
const record = (tabId, order, url) => ({ tabId, spaceId: 's', section: 'temporaryTabs', order, url });

beforeEach(() => {
    sync = {};
    tabs = [];
    calls = [];
    globalThis.chrome = {
        storage: { sync: { get: async defaults => ({ ...defaults, ...sync }) } },
        tabs: { query: async () => tabs }
    };
    store = {
        spaces: [{ id: 's', spaceBookmarks: [], pinnedTabs: [], temporaryTabs: [1, 2, 3, 4] }],
        snapshotByTab: new Map(),
        restoreQueue: [],
        provisional: new Set(),
        hidden: new Set(),
        linkTails: { closed: () => {} },
        onTabRemoved: async arg => calls.push(arg)
    };
});

test('a tab that closes with its window is queued to come back and reported with its record', async () => {
    store.snapshotByTab.set(2, record(2, 1, 'https://a.test/'));
    await removeTab(store, 2, { windowId: 9, isWindowClosing: true });
    assert.deepEqual(store.spaces[0].temporaryTabs, [1, 3, 4]);
    assert.equal(store.restoreQueue.length, 1);
    assert.equal(calls[0].record.tabId, 2);
});

test('a tab closed on its own is forgotten and not reported as closed with a window', async () => {
    store.snapshotByTab.set(2, record(2, 1, 'https://a.test/'));
    await removeTab(store, 2, { windowId: 9, isWindowClosing: false });
    assert.equal(store.restoreQueue.length, 0);
    assert.equal(calls[0].record, null);
});

test('a page open in a surviving window takes the closed tab place in the list', async () => {
    tabs = [{ id: 4, windowId: 1, url: 'https://a.test/p' }];
    store.snapshotByTab.set(2, record(2, 1, 'https://a.test/p'));
    await removeTab(store, 2, { windowId: 9, isWindowClosing: true });
    assert.deepEqual(store.spaces[0].temporaryTabs, [1, 4, 3]);
});

test('with the all-windows setting off the lists do not move', async () => {
    sync.showTabsFromAllWindows = false;
    tabs = [{ id: 4, windowId: 1, url: 'https://a.test/p' }];
    store.snapshotByTab.set(2, record(2, 1, 'https://a.test/p'));
    await removeTab(store, 2, { windowId: 9, isWindowClosing: true });
    assert.deepEqual(store.spaces[0].temporaryTabs, [1, 3, 4]);
});

test('a tab Clean All was hiding does not come back with its window', async () => {
    store.hidden.add(2);
    store.snapshotByTab.set(2, record(2, 1, 'https://a.test/'));
    await removeTab(store, 2, { windowId: 9, isWindowClosing: true });
    assert.equal(store.restoreQueue.length, 0);
    assert.equal(calls[0].record, null);
});

test('a failing closed-links hook does not stop the store forgetting the tab', async () => {
    store.onTabRemoved = async () => {
        throw new Error('boom');
    };
    store.snapshotByTab.set(2, record(2, 1, 'https://a.test/'));
    await removeTab(store, 2, { windowId: 9, isWindowClosing: true });
    assert.deepEqual(store.spaces[0].temporaryTabs, [1, 3, 4]);
});
