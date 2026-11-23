import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceStore, ownerOf } from '../../../src/shared/space-store.js';
import { followStoreSettings, readStoreSettings } from '../../../src/shared/space-store-settings.js';

let local, session, sync, tabs, bookmarks;
const area = data => ({
    async get(keys) {
        const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || data);
        return Object.fromEntries(names.map(k => [k, structuredClone(data[k])]));
    },
    async set(values) {
        Object.assign(data, structuredClone(values));
    }
});
const event = () => ({
    listeners: [],
    addListener(fn) {
        this.listeners.push(fn);
    },
    emit(...args) {
        this.listeners.forEach(fn => fn(...args));
    }
});

beforeEach(() => {
    // Space a: tab 1 is a pinned tab (bookmark p), tab 2 a top-bar favourite, tab 3 in the tab list.
    local = {
        spaceModelVersion: 2,
        spaces: [
            {
                id: 'a',
                spaceUuid: 'a',
                name: 'a',
                color: 'blue',
                bookmarkFolderId: 'folder',
                spaceBookmarks: [1],
                temporaryTabs: [3],
                pinnedTabs: [2]
            }
        ],
        pinnedTabStatesById: { 1: { pinnedUrl: 'https://p.test/', bookmarkId: 'p' } }
    };
    session = { spaceSession: true };
    sync = {};
    tabs = [
        { id: 1, windowId: 1, url: 'https://p.test/' },
        { id: 2, windowId: 1, url: 'https://fav.test/', pinned: true },
        { id: 3, windowId: 1, url: 'https://three.test/' }
    ];
    bookmarks = [
        { id: 'root', title: 'Sidecove' },
        { id: 'folder', parentId: 'root', index: 0, title: 'a' },
        { id: 'p', parentId: 'folder', index: 0, url: 'https://p.test/', title: 'P' },
        { id: 'q', parentId: 'folder', index: 1, url: 'https://q.test/', title: 'Q' }
    ];
    globalThis.chrome = {
        runtime: { getURL: path => `chrome-extension://sidecove/${path}` },
        storage: { local: area(local), session: area(session), sync: area(sync), onChanged: event() },
        tabs: {
            onCreated: event(),
            onUpdated: event(),
            onRemoved: event(),
            onReplaced: event(),
            onActivated: event(),
            onMoved: event(),
            query: async () => tabs,
            get: async id => tabs.find(t => t.id === id)
        },
        tabGroups: { onRemoved: event(), onUpdated: event(), query: async () => [] },
        bookmarks: {
            search: async () => [bookmarks[0]],
            get: async id => bookmarks.filter(b => b.id === id),
            getChildren: async id => bookmarks.filter(b => b.parentId === id).sort((x, y) => x.index - y.index),
            create: async ({ parentId, index, title, url }) => {
                for (const b of bookmarks) if (b.parentId === parentId && b.index >= index) b.index++;
                const node = { id: `new${bookmarks.length}`, parentId, index, title, url };
                bookmarks.push(node);
                return node;
            }
        },
        windows: { onFocusChanged: event(), get: async id => ({ id, focused: true }) }
    };
});

test('links from a pinned tab open in the tab list unless the setting says pin, including after an update', async () => {
    const store = {};
    await readStoreSettings(store);
    assert.equal(store.pinsLinks, false);
    sync.pinnedTabLinks = 'list';
    await readStoreSettings(store);
    assert.equal(store.pinsLinks, false);
    sync.pinnedTabLinks = 'pin';
    await readStoreSettings(store);
    assert.equal(store.pinsLinks, true);
});

test('a new value of the setting applies without a restart, and other settings keep their rules', () => {
    const store = {};
    const handle = operation => operation();
    followStoreSettings(store, { pinnedTabLinks: { newValue: 'pin' } }, handle);
    assert.equal(store.pinsLinks, true);
    followStoreSettings(
        store,
        { pinnedTabLinks: { newValue: undefined }, invertTabOrder: { newValue: false } },
        handle
    );
    assert.deepEqual(store, { pinsLinks: false, invertTabOrder: false });
});

async function startStore() {
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    return store;
}

// Chrome opens a link tab, as a Cmd+click in the opener does, with no side panel open.
async function clickLink(store, id, openerTabId) {
    const tab = { id, windowId: 1, openerTabId, url: `https://link${id}.test/`, title: '' };
    tabs.push(tab);
    chrome.tabs.onCreated.emit(tab);
    await store.run(() => {});
}

const folderOrder = () =>
    bookmarks
        .filter(b => b.parentId === 'folder')
        .sort((x, y) => x.index - y.index)
        .map(b => b.url);

test('by default a link from a pinned tab opens at the top of the tab list, unpinned', async () => {
    const store = await startStore();
    await clickLink(store, 4, 1);
    await clickLink(store, 5, 1);
    const space = ownerOf(local.spaces, 4);
    assert.deepEqual(space.spaceBookmarks, [1]);
    // Drawn reversed by default: the top of the list is the end of the stored list.
    assert.deepEqual([...space.temporaryTabs].reverse(), [4, 5, 3]);
    assert.deepEqual(folderOrder(), ['https://p.test/', 'https://q.test/']);
});

test('with the setting on, links from a pinned tab become pinned tabs beneath it, with the side panel closed', async () => {
    sync.pinnedTabLinks = 'pin';
    const store = await startStore();
    await clickLink(store, 4, 1);
    await clickLink(store, 5, 1);
    const space = ownerOf(local.spaces, 4);
    assert.deepEqual(space.spaceBookmarks, [1, 4, 5]);
    assert.deepEqual(space.temporaryTabs, [3]);
    assert.deepEqual(folderOrder(), [
        'https://p.test/',
        'https://link4.test/',
        'https://link5.test/',
        'https://q.test/'
    ]);
    const link4 = bookmarks.find(b => b.url === 'https://link4.test/');
    assert.equal(local.pinnedTabStatesById[4].bookmarkId, link4.id);
});

test('a link from a favourite opens unpinned in the tab list whatever the setting says', async () => {
    for (const value of [undefined, 'list', 'pin']) {
        sync.pinnedTabLinks = value;
        local.spaces[0].temporaryTabs = [3];
        tabs.length = 3;
        const store = await startStore();
        await clickLink(store, 4, 2);
        const space = ownerOf(local.spaces, 4);
        assert.deepEqual(space.spaceBookmarks, [1], String(value));
        assert.deepEqual(space.pinnedTabs, [2], String(value));
        assert.deepEqual([...space.temporaryTabs].reverse(), [4, 3], String(value));
        assert.equal(local.pinnedTabStatesById[4], undefined, String(value));
        assert.deepEqual(folderOrder(), ['https://p.test/', 'https://q.test/'], String(value));
    }
});

test('tabs the worker files again at start-up are not taken for new links from a pinned tab', async () => {
    sync.pinnedTabLinks = 'pin';
    // Tab 4 was opened from the pinned tab while the worker was not running.
    tabs.push({ id: 4, windowId: 1, openerTabId: 1, url: 'https://old.test/' });
    const store = await startStore();
    assert.deepEqual(store.linkPins.entries().waiting, []);
    chrome.tabs.onUpdated.emit(4, { url: 'https://old.test/next' }, { ...tabs[3], url: 'https://old.test/next' });
    await store.run(() => {});
    assert.deepEqual(ownerOf(local.spaces, 4).spaceBookmarks, [1]);
    assert.deepEqual(folderOrder(), ['https://p.test/', 'https://q.test/']);
});
