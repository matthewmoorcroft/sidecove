import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSavedFavorites } from '../../../src/background/saved-favorites.js';

const area = (data = {}) => ({
    data,
    async get(keys) {
        if (keys && typeof keys === 'object' && !Array.isArray(keys))
            return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, structuredClone(data[k] ?? d)]));
        const names = typeof keys === 'string' ? [keys] : keys;
        return Object.fromEntries(names.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
    },
    async set(values) {
        Object.assign(data, structuredClone(values));
    }
});
const event = () => {
    const listeners = [];
    return { listeners, addListener: listener => listeners.push(listener) };
};

function setup({
    allWindows,
    stored = {},
    tabs = [],
    spaces = [{ id: 'home', pinnedTabs: [], spaceBookmarks: [], temporaryTabs: [] }]
}) {
    const live = new Map(tabs.map(tab => [tab.id, { incognito: false, ...tab }]));
    let nextId = 100;
    const dispatched = [];
    const chrome = {
        runtime: { getURL: path => `chrome-extension://sidecove/${path}`, onMessage: event() },
        storage: {
            local: area({ spaces, ...stored }),
            session: area(),
            sync: area(allWindows === undefined ? {} : { showTabsFromAllWindows: allWindows }),
            onChanged: event()
        },
        tabs: {
            onCreated: event(),
            onUpdated: event(),
            onAttached: event(),
            onRemoved: event(),
            onReplaced: event(),
            async query({ pinned, windowId } = {}) {
                return [...live.values()].filter(
                    tab =>
                        (pinned === undefined || tab.pinned === pinned) &&
                        (windowId === undefined || tab.windowId === windowId)
                );
            },
            async get(id) {
                if (!live.has(id)) throw new Error(`No tab with id: ${id}.`);
                return live.get(id);
            },
            async create(props) {
                const tab = { id: nextId++, incognito: false, index: 0, ...props, url: '', pendingUrl: props.url };
                live.set(tab.id, tab);
                return tab;
            },
            async update(id, props) {
                Object.assign(live.get(id), props);
                return live.get(id);
            }
        }
    };
    let n = 0;
    registerSavedFavorites({
        chrome,
        spaceStore: { dispatch: async message => dispatched.push(message) },
        newId: () => `f${++n}`,
        schedule: fn => setTimeout(fn, 0)
    });
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));
    const send = message =>
        new Promise(resolve => {
            const handled = chrome.runtime.onMessage.listeners[0](message, {}, resolve);
            if (handled !== true) resolve(handled);
        });
    return { chrome, live, dispatched, settle, send, local: chrome.storage.local.data };
}

const pin = (id, windowId, url) => ({ id, windowId, index: id, pinned: true, url, title: url });

test('with the setting off nothing is saved, and unpinning leaves other windows’ pins alone', async () => {
    const { chrome, live, settle, local } = setup({
        allWindows: false,
        tabs: [pin(1, 1, 'https://a/'), pin(2, 2, 'https://a/')]
    });
    await settle();
    chrome.tabs.onCreated.listeners[0](pin(3, 1, 'https://b/'));
    await settle();
    assert.equal('savedFavorites' in local, false);
    live.get(1).pinned = false;
    chrome.tabs.onUpdated.listeners[0](1, { pinned: false }, live.get(1));
    await settle();
    assert.equal(live.get(2).pinned, true);
});

test('with it on (the default), today’s pins become the saved list once each', async () => {
    const { settle, local } = setup({
        tabs: [
            pin(1, 1, 'https://a/'),
            pin(2, 2, 'https://a/'),
            pin(3, 2, 'https://b/'),
            { id: 4, windowId: 1, url: 'https://c/' }
        ]
    });
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['https://a/', 'https://b/']
    );
    assert.deepEqual(
        local.favoriteTabs.map(r => [r.tabId, r.favoriteId]),
        [
            [1, 'f1'],
            [2, 'f1'],
            [3, 'f2']
        ]
    );
});

test('a pinned settings or setup-guide tab is saved as a favorite; other Sidecove pages are not', async () => {
    const { settle, local } = setup({
        tabs: [
            pin(1, 1, 'chrome-extension://sidecove/options.html'),
            pin(2, 1, 'chrome-extension://sidecove/installation-onboarding.html#welcome'),
            pin(3, 1, 'chrome-extension://sidecove/sidebar.html'),
            pin(4, 1, 'chrome-extension://sidecove/offscreen.html')
        ]
    });
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['chrome-extension://sidecove/options.html', 'chrome-extension://sidecove/installation-onboarding.html#welcome']
    );
});

test('unpinning a favorite removes it everywhere; closing its tab keeps it', async () => {
    const { chrome, live, settle, local } = setup({
        tabs: [pin(1, 1, 'https://a/'), pin(2, 2, 'https://a/'), pin(3, 1, 'https://b/')]
    });
    await settle();
    // Chrome reports a closing pin as unpinned first; that is not a removal.
    const closing = live.get(3);
    live.delete(3);
    chrome.tabs.onUpdated.listeners[0](3, { pinned: false }, { ...closing, pinned: false });
    chrome.tabs.onRemoved.listeners[0](3, { isWindowClosing: false });
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['https://a/', 'https://b/']
    );
    live.get(1).pinned = false;
    chrome.tabs.onUpdated.listeners[0](1, { pinned: false }, live.get(1));
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['https://b/']
    );
    assert.equal(live.get(2).pinned, false);
});

test('picking a dimmed favorite opens it pinned in that window and its space, once', async () => {
    const { live, settle, send, local, dispatched } = setup({
        tabs: [pin(1, 1, 'https://a/')],
        spaces: [{ id: 'home', pinnedTabs: [1], spaceBookmarks: [], temporaryTabs: [] }]
    });
    await settle();
    assert.deepEqual(await send({ type: 'savedFavorites', action: 'open', favoriteId: 'f1', windowId: 7 }), {
        success: true
    });
    const opened = [...live.values()].find(tab => tab.windowId === 7);
    assert.equal(opened.pinned, true);
    assert.equal(opened.active, true);
    assert.equal(opened.pendingUrl, 'https://a/');
    assert.deepEqual(dispatched, [{ action: 'assignPin', tabId: opened.id, spaceId: 'home' }]);
    assert.ok(local.favoriteTabs.some(r => r.tabId === opened.id && r.favoriteId === 'f1'));
    await send({ type: 'savedFavorites', action: 'open', favoriteId: 'f1', windowId: 7 });
    assert.equal([...live.values()].filter(tab => tab.windowId === 7).length, 1);
});

test('only its own messages get an answer', async () => {
    const { chrome, send } = setup({});
    assert.equal(
        chrome.runtime.onMessage.listeners[0]({ type: 'spaceStore' }, {}, () => {}),
        undefined
    );
    assert.deepEqual(await send({ type: 'savedFavorites', action: 'nope' }), {
        success: false,
        error: 'Unknown saved favorites action'
    });
});

test('with the setting off after a restart, unpinning a saved favorite still removes it', async () => {
    const { chrome, live, settle, local } = setup({
        allWindows: false,
        stored: {
            savedFavorites: [{ id: 'f1', url: 'https://a/', title: 'A', spaceId: 'home' }],
            favoriteTabs: [{ tabId: 9, favoriteId: 'f1', windowId: 1, url: 'https://a/' }]
        },
        tabs: [pin(1, 1, 'https://a/'), pin(2, 1, 'https://b/')]
    });
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['https://a/']
    );
    live.get(1).pinned = false;
    chrome.tabs.onUpdated.listeners[0](1, { pinned: false }, live.get(1));
    await settle();
    assert.deepEqual(local.savedFavorites, []);
});

// Chrome pins a duplicate of a pinned tab, directly right of it. A window shows a favorite once, so
// the copy is not a second favorite: it is unpinned before it is saved and is an ordinary tab.
const duplicate = (live, chrome, source, id) => {
    const copy = { ...live.get(source), id, index: live.get(source).index + 1, incognito: false };
    live.set(id, copy);
    chrome.tabs.onCreated.listeners[0]({ ...copy });
    return copy;
};

test('duplicating a favorite’s pinned tab gives an ordinary tab and no second favorite', async () => {
    const { chrome, live, settle, local } = setup({ tabs: [pin(1, 1, 'https://a/')] });
    await settle();
    duplicate(live, chrome, 1, 2);
    await settle();
    assert.equal(live.get(2).pinned, false);
    assert.equal(live.get(1).pinned, true);
    const unpinned = { ...live.get(2) };
    chrome.tabs.onUpdated.listeners[0](2, { pinned: false }, unpinned);
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['https://a/']
    );
    assert.deepEqual(
        local.favoriteTabs.map(r => r.tabId),
        [1]
    );
    // Closing the copy changes nothing in the saved list.
    live.delete(2);
    chrome.tabs.onRemoved.listeners[0](2, { isWindowClosing: false });
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.id),
        ['f1']
    );
    assert.deepEqual(local.favoriteRestore ?? [], []);
});

test('a copy pinned by hand afterwards is saved as a second favorite, on purpose', async () => {
    const { chrome, live, settle, local } = setup({ tabs: [pin(1, 1, 'https://a/')] });
    await settle();
    duplicate(live, chrome, 1, 2);
    await settle();
    live.get(2).pinned = true;
    chrome.tabs.onUpdated.listeners[0](2, { pinned: true }, live.get(2));
    await settle();
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['https://a/', 'https://a/']
    );
});

test('a pinned tab opened beside a favorite on another page, or in another window, stays pinned', async () => {
    const { chrome, live, settle, local } = setup({ tabs: [pin(1, 1, 'https://a/')] });
    await settle();
    live.set(2, { ...pin(2, 1, 'https://b/'), index: 2 });
    chrome.tabs.onCreated.listeners[0]({ ...live.get(2) });
    live.set(3, { ...pin(3, 2, 'https://a/'), index: 0 });
    chrome.tabs.onCreated.listeners[0]({ ...live.get(3) });
    await settle();
    assert.equal(live.get(2).pinned, true);
    assert.equal(live.get(3).pinned, true);
    assert.deepEqual(
        local.savedFavorites.map(f => f.url),
        ['https://a/', 'https://b/']
    );
});

test('a favorite Sidecove opens beside another favorite on the same page is not taken for a copy', async () => {
    // With separate favorites per space, one page can be a favorite in two spaces.
    const { chrome, live, settle, send, local } = setup({
        stored: {
            savedFavorites: [
                { id: 'f1', url: 'https://a/', title: 'A', spaceId: 'home' },
                { id: 'f2', url: 'https://a/', title: 'A', spaceId: 'work' }
            ],
            favoriteTabs: [{ tabId: 1, favoriteId: 'f1', windowId: 1, url: 'https://a/' }]
        },
        tabs: [pin(1, 1, 'https://a/')],
        spaces: [
            { id: 'home', pinnedTabs: [1], spaceBookmarks: [], temporaryTabs: [] },
            { id: 'work', pinnedTabs: [], spaceBookmarks: [], temporaryTabs: [] }
        ]
    });
    await settle();
    chrome.tabs.create = async props => {
        const tab = {
            id: 50,
            windowId: props.windowId,
            index: 1,
            pinned: true,
            incognito: false,
            pendingUrl: props.url
        };
        live.set(50, tab);
        chrome.tabs.onCreated.listeners[0]({ ...tab });
        return tab;
    };
    await send({ type: 'savedFavorites', action: 'open', favoriteId: 'f2', windowId: 1 });
    await settle();
    assert.equal(live.get(50).pinned, true);
    assert.ok(local.favoriteTabs.some(r => r.tabId === 50 && r.favoriteId === 'f2'));
});

test('with the setting off, a pinned copy stays pinned and nothing is saved', async () => {
    const { chrome, live, settle, local } = setup({ allWindows: false, tabs: [pin(1, 1, 'https://a/')] });
    await settle();
    duplicate(live, chrome, 1, 2);
    await settle();
    assert.equal(live.get(2).pinned, true);
    assert.equal('savedFavorites' in local, false);
});
