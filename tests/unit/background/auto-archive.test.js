import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceStore } from '../../../src/shared/space-store.js';
import { registerAutoArchive } from '../../../src/background/auto-archive.js';

const threshold = 360 * 60 * 1000;

let local, session, tabs, removed;
const area = data => ({
    async get(keys) {
        const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || data);
        return Object.fromEntries(names.map(k => [k, structuredClone(data[k] ?? keys?.[k])]));
    },
    async set(values) {
        Object.assign(data, structuredClone(values));
    }
});
const space = (id, ids = []) => ({
    id,
    spaceUuid: id,
    name: id,
    color: 'blue',
    bookmarkFolderId: id,
    spaceBookmarks: [],
    temporaryTabs: ids
});
beforeEach(() => {
    local = { spaceModelVersion: 2, spaces: [space('a', [1])] };
    session = { spaceSession: true };
    removed = [];
    tabs = [{ id: 1, windowId: 1, url: 'https://one.test/', groupId: -1, active: false }];
});
function startBackground() {
    const event = () => ({
        listeners: [],
        addListener(fn) {
            this.listeners.push(fn);
        }
    });
    const chrome = (globalThis.chrome = {
        runtime: {
            getURL: path => `chrome-extension://sidecove/${path}`,
            onInstalled: event(),
            onStartup: event(),
            onMessage: event()
        },
        sidePanel: { setPanelBehavior: async () => {} },
        commands: { onCommand: event() },
        alarms: { onAlarm: event() },
        storage: {
            local: area(local),
            session: area(session),
            sync: area({ autoArchiveEnabled: true }),
            onChanged: event()
        },
        tabs: {
            onCreated: event(),
            onUpdated: event(),
            onRemoved: event(),
            onReplaced: event(),
            onActivated: event(),
            onMoved: event(),
            query: async () => structuredClone(tabs),
            get: async id => structuredClone(tabs.find(t => t.id === id)),
            remove: async id => {
                removed.push(id);
                tabs = tabs.filter(t => t.id !== id);
            }
        },
        tabGroups: { onRemoved: event(), onUpdated: event(), query: async () => [] },
        windows: { onFocusChanged: event(), get: async id => ({ id, focused: true }) },
        bookmarks: {
            search: async () => [{ id: 'root' }],
            getChildren: async () => [],
            getSubTree: async () => [{ id: 'root', children: [] }]
        }
    });
    // As the service worker does: one space store, then auto-archive on top of it.
    const spaceStore = new SpaceStore();
    spaceStore.install();
    registerAutoArchive(spaceStore);
    const fireAlarm = () =>
        Promise.all(chrome.alarms.onAlarm.listeners.map(fn => fn({ name: 'autoArchiveTabsAlarm' })));
    fireAlarm.store = spaceStore;
    return fireAlarm;
}

test('a background tab with no activity record is tracked instead of archived', async () => {
    local.tabLastActivity = {};
    await startBackground()();
    assert.deepEqual(removed, []);
    assert.equal(local.archivedTabs, undefined);
    assert.equal(typeof local.tabLastActivity[1], 'number');
});
test('a tab idle past the threshold in the same session is archived', async () => {
    local.tabLastActivity = { 1: Date.now() - threshold - 1000 };
    await startBackground()();
    assert.deepEqual(removed, [1]);
    assert.equal(local.archivedTabs[0].url, 'https://one.test/');
});
for (const page of ['options.html', 'installation-onboarding.html']) {
    test(`an idle Sidecove ${page} tab is left open, not archived`, async () => {
        tabs[0].url = `chrome-extension://sidecove/${page}`;
        local.tabLastActivity = { 1: Date.now() - threshold - 1000 };
        await startBackground()();
        assert.deepEqual(removed, []);
        assert.equal(local.archivedTabs, undefined);
    });
}
test('a previous-session record for a reused tab id does not archive it at the first check after restart', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [{ spaceId: 'a', section: 'temporaryTabs', order: 0, url: 'https://restored.test/' }];
    local.tabLastActivity = { 42: Date.now() - threshold - 1000 };
    tabs = [{ id: 42, windowId: 1, url: 'https://restored.test/', groupId: -1, active: false }];
    await startBackground()();
    assert.deepEqual(removed, []);
    assert.deepEqual(local.spaces[0].temporaryTabs, [42]);
    assert.ok(Date.now() - local.tabLastActivity[42] < threshold);
});
test('an activation write in flight during the new-session clear does not restore previous-session records', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [{ spaceId: 'a', section: 'temporaryTabs', order: 1, url: 'https://restored.test/' }];
    local.tabLastActivity = { 42: Date.now() - threshold - 1000 };
    tabs = [
        { id: 7, windowId: 1, url: 'https://active.test/', groupId: -1, active: true },
        { id: 42, windowId: 1, url: 'https://restored.test/', groupId: -1, active: false }
    ];
    const fireAlarm = startBackground();
    const storage = chrome.storage.local,
        get = storage.get,
        set = storage.set;
    let markCleared;
    const cleared = new Promise(resolve => {
        markCleared = resolve;
    });
    storage.set = async values => {
        await set(values);
        if ('tabLastActivity' in values) markCleared();
    };
    storage.get = async keys => {
        if (keys !== 'tabLastActivity') return get(keys);
        const snapshot = await get(keys);
        await cleared;
        return snapshot;
    };
    await Promise.all(chrome.tabs.onActivated.listeners.map(fn => fn({ tabId: 7, windowId: 1 })));
    await fireAlarm();
    assert.deepEqual(removed, []);
    assert.ok(Date.now() - local.tabLastActivity[42] < threshold);
});

// The check reads every tab first and closes later; these change the tab in between.
const midCheckChanges = {
    'made the active tab': async () => {
        tabs[0].active = true;
    },
    'started playing sound': async () => {
        tabs[0].audible = true;
    },
    'pinned in Chrome': async () => {
        tabs[0].pinned = true;
    },
    'pinned as a space pinned tab': async store => {
        await store.dispatch({ action: 'assign', spaceId: 'a', tabId: 1, pinned: true });
    },
    'bound to a favourite': async () => {
        local.pinnedTabStatesById = { 1: { bookmarkId: 'bm', pinnedUrl: 'https://one.test/' } };
    },
    visited: async () => {
        local.tabLastActivity = { 1: Date.now() };
    }
};
for (const [change, apply] of Object.entries(midCheckChanges)) {
    test(`an idle tab ${change} while the archive check runs is not closed`, async () => {
        local.tabLastActivity = { 1: Date.now() - threshold - 1000 };
        const fireAlarm = startBackground();
        const query = chrome.tabs.query;
        chrome.tabs.query = async filter => {
            const snapshot = await query(filter);
            if (filter?.pinned === false) await apply(fireAlarm.store);
            return snapshot;
        };
        await fireAlarm();
        assert.deepEqual(removed, []);
        assert.equal(local.archivedTabs, undefined);
    });
}
test('idle protected tabs stay open through the archive check while an ordinary idle tab is archived', async () => {
    const idle = Date.now() - threshold - 1000;
    local.spaces = [{ ...space('a', [3, 4, 5, 6]), spaceBookmarks: [2] }];
    local.pinnedTabStatesById = { 3: { bookmarkId: 'bm-moved', pinnedUrl: 'https://bound.test/' } };
    local.tabLastActivity = { 2: idle, 3: idle, 4: idle, 5: idle, 6: idle };
    const tab = (id, url) => ({ id, windowId: 1, url, groupId: -1, active: false });
    tabs = [
        tab(2, 'https://space-pin.test/'),
        tab(3, 'https://navigated-away.test/'),
        tab(4, 'https://bookmarked.test/page'),
        tab(5, 'chrome-extension://sidecove/options.html'),
        tab(6, 'https://ordinary.test/')
    ];
    const fireAlarm = startBackground();
    chrome.bookmarks.getSubTree = async () => [
        { id: 'root', children: [{ id: 'bm-4', url: 'https://bookmarked.test/page' }] }
    ];
    await fireAlarm();
    assert.deepEqual(removed, [6]);
    assert.deepEqual(
        local.archivedTabs.map(t => t.url),
        ['https://ordinary.test/']
    );
});
