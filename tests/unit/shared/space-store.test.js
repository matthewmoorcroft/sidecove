import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceStore, applySpacePatch, ownerOf } from '../../../src/shared/space-store.js';
import { syncSpaceGroups } from '../../../src/shared/tab-group-sync.js';
import { Utils } from '../../../src/shared/utils.js';

let local, session, sync, tabs, mutations, groups, focusedWindow, windows;
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
    local = { spaceModelVersion: 2, spaces: [space('a', [1]), space('b', [2])] };
    session = { spaceSession: true };
    sync = {};
    mutations = [];
    groups = [];
    focusedWindow = 1;
    windows = [
        { id: 1, type: 'normal', alwaysOnTop: false },
        { id: 2, type: 'normal', alwaysOnTop: false }
    ];
    tabs = [
        { id: 1, windowId: 1, url: 'https://one.test/', groupId: -1 },
        { id: 2, windowId: 1, url: 'https://two.test/', groupId: -1 }
    ];
    const event = () => ({
        listeners: [],
        addListener(fn) {
            this.listeners.push(fn);
        },
        emit(...args) {
            this.listeners.forEach(fn => fn(...args));
        }
    });
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
            query: async query => tabs.filter(t => query.groupId === undefined || query.groupId === t.groupId),
            group: async args => {
                mutations.push(['group', args]);
                const id = args.groupId ?? 100 + groups.length;
                if (!groups.some(g => g.id === id)) groups.push({ id, windowId: 1 });
                tabs.filter(t => args.tabIds.includes(t.id)).forEach(t => (t.groupId = id));
                return id;
            },
            move: async (...args) => mutations.push(['move', ...args])
        },
        tabGroups: {
            onRemoved: event(),
            onUpdated: event(),
            query: async () => groups,
            update: async (id, attrs) => {
                mutations.push(['update', id, attrs]);
                Object.assign(
                    groups.find(g => g.id === id),
                    attrs
                );
            }
        },
        bookmarks: {
            search: async () => [{ id: 'root' }],
            getChildren: async () => [],
            create: async ({ title }) => ({ id: title, title })
        },
        windows: {
            onFocusChanged: event(),
            get: async id => ({ id, focused: id === focusedWindow }),
            getAll: async ({ windowTypes }) => windows.filter(w => windowTypes.includes(w.type))
        }
    };
});
test('independent default ignores group identity and order and retains empty spaces', async () => {
    tabs[0].groupId = 99;
    tabs.reverse();
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.equal(ownerOf(store.spaces, 1).id, 'a');
    tabs = tabs.filter(t => t.id !== 1);
    await store.dispatch({ action: 'activate', spaceId: 'a', windowId: 1 });
    assert.deepEqual(local.spaces[0].temporaryTabs, []);
    assert.equal(local.spaces[0].id, 'a');
    assert.deepEqual(mutations, []);
});
test('stale panel patch preserves concurrent tabs, moves and metadata', () => {
    const before = [space('a', [1]), space('b', [2])];
    const current = structuredClone(before);
    current[0].temporaryTabs.push(3);
    current[1].color = 'red';
    const after = structuredClone(before);
    after[0].temporaryTabs = [];
    after[1].temporaryTabs.push(1);
    const result = applySpacePatch(current, before, after);
    assert.deepEqual(result[0].temporaryTabs, [3]);
    assert.deepEqual(result[1].temporaryTabs, [2, 1]);
    assert.equal(result[1].color, 'red');
});
test('restart remaps URLs to new IDs and retains stored order', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [
        { spaceId: 'a', section: 'temporaryTabs', order: 0, url: 'https://two.test/' },
        { spaceId: 'a', section: 'temporaryTabs', order: 1, url: 'https://one.test/' }
    ];
    tabs = [
        { id: 9, windowId: 1, url: 'https://one.test/' },
        { id: 8, windowId: 1, url: 'https://two.test/' },
        { id: 2, windowId: 1, url: 'https://unrelated.test/' }
    ];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.deepEqual(store.spaces[0].temporaryTabs, [8, 9, 2]);
    assert.deepEqual(store.spaces[1].temporaryTabs, []);
});
test('worker restart preserves session membership and opener determines new tab space', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    const child = { id: 3, windowId: 1, openerTabId: 2, url: 'https://child.test/' };
    tabs.push(child);
    await store.run(async () => {
        store.track(child);
        await store.persist();
    });
    const next = new SpaceStore();
    await next.dispatch({ action: 'get' });
    // Stored in Chrome order; the list is drawn reversed by default, so 3 is drawn below 2.
    assert.deepEqual(next.spaces[1].temporaryTabs, [3, 2]);
});
test('links opened from one tab stack below it in opening order, whichever way the list is drawn', async () => {
    for (const invertTabOrder of [true, false]) {
        sync.invertTabOrder = invertTabOrder;
        local.spaces[1].temporaryTabs = [2];
        const store = new SpaceStore();
        await store.dispatch({ action: 'get' });
        for (const id of [4, 5, 6]) {
            const child = { id, windowId: 1, openerTabId: 2, url: `https://child${id}.test/` };
            tabs.push(child);
            await store.run(async () => {
                store.track(child);
                await store.persist();
            });
        }
        const stored = local.spaces[1].temporaryTabs;
        assert.deepEqual(invertTabOrder ? [...stored].reverse() : stored, [2, 4, 5, 6]);
        tabs.length = 2;
    }
});
test('links keep their order after the service worker restarts', async () => {
    const open = async (store, id) => {
        const child = { id, windowId: 1, openerTabId: 2, url: `https://child${id}.test/` };
        tabs.push(child);
        await store.run(async () => {
            store.track(child);
            await store.persist();
        });
    };
    sync.invertTabOrder = false;
    local.spaces[1].temporaryTabs = [2];
    await open(new SpaceStore(), 4);
    // A new worker reads back where the last link from tab 2 went.
    const restarted = new SpaceStore();
    await restarted.dispatch({ action: 'get' });
    await open(restarted, 5);
    assert.deepEqual(local.spaces[1].temporaryTabs, [2, 4, 5]);
});
test('a link opened from a link stays inside the group of the first tab', async () => {
    sync.invertTabOrder = false;
    local.spaces[1].temporaryTabs = [2];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    const open = async (id, openerTabId) => {
        const child = { id, windowId: 1, openerTabId, url: `https://child${id}.test/` };
        tabs.push(child);
        await store.run(async () => {
            store.track(child);
            await store.persist();
        });
    };
    await open(4, 2);
    await open(5, 4);
    await open(6, 2);
    assert.deepEqual(local.spaces[1].temporaryTabs, [2, 4, 5, 6]);
});
test('closing the last link makes the link above it the place the next one follows', async () => {
    sync.invertTabOrder = false;
    local.spaces[1].temporaryTabs = [2];
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    const open = async id => {
        const child = { id, windowId: 1, openerTabId: 2, url: `https://child${id}.test/` };
        tabs.push(child);
        await store.run(async () => {
            store.track(child);
            await store.persist();
        });
    };
    await open(4);
    await open(5);
    tabs.splice(
        tabs.findIndex(t => t.id === 5),
        1
    );
    chrome.tabs.onRemoved.emit(5, {});
    await store.run(() => {});
    await open(6);
    assert.deepEqual(local.spaces[1].temporaryTabs, [2, 4, 6]);
});
test('switching to the opener again makes its next link go directly beneath it', async () => {
    sync.invertTabOrder = false;
    local.spaces[1].temporaryTabs = [2];
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    const open = async id => {
        const child = { id, windowId: 1, openerTabId: 2, url: `https://child${id}.test/` };
        tabs.push(child);
        await store.run(async () => {
            store.track(child);
            await store.persist();
        });
    };
    await open(4);
    await open(5);
    // The user goes to another tab and comes back to tab 2.
    chrome.tabs.onActivated.emit({ tabId: 2, windowId: 1 });
    await store.run(() => {});
    await open(6);
    assert.deepEqual(local.spaces[1].temporaryTabs, [2, 6, 4, 5]);
});
test('the Show new tabs at the top setting is picked up without a restart', async () => {
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    assert.equal(store.invertTabOrder, true);
    chrome.storage.onChanged.emit({ invertTabOrder: { newValue: false } }, 'sync');
    await store.run(() => {});
    assert.equal(store.invertTabOrder, false);
});
test('a new-tab page with an incidental opener goes where new tabs go, not next to the opener', async () => {
    local.spaces[1].temporaryTabs = [7, 2, 8];
    tabs.push({ id: 7, windowId: 1, url: 'https://seven.test/' }, { id: 8, windowId: 1, url: 'https://eight.test/' });
    const store = new SpaceStore();
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 1 });
    const tab = { id: 3, windowId: 1, openerTabId: 2, url: 'chrome://newtab/' };
    tabs.push(tab);
    await store.run(async () => {
        store.track(tab);
        await store.persist();
    });
    assert.deepEqual(local.spaces[1].temporaryTabs, [7, 2, 8, 3]);
});
test('a link tab that Chrome reports without an address yet still goes below its opener', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 1 });
    const child = { id: 3, windowId: 1, openerTabId: 2, url: '' };
    tabs.push(child);
    await store.run(async () => {
        store.track(child);
        await store.persist();
    });
    assert.deepEqual(local.spaces[1].temporaryTabs, [3, 2]);
});
test('a link opened from a favourite goes to the top of the tab list', async () => {
    tabs[0].pinned = true;
    local.spaces[0].pinnedTabs = [1];
    local.spaces[0].temporaryTabs = [9];
    tabs.push({ id: 9, windowId: 1, url: 'https://nine.test/' });
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    for (const id of [4, 5]) {
        const child = { id, windowId: 1, openerTabId: 1, url: `https://child${id}.test/` };
        tabs.push(child);
        await store.run(async () => {
            store.track(child);
            await store.persist();
        });
    }
    // Drawn reversed by default: top of the list is the end of the stored list.
    assert.deepEqual([...ownerOf(local.spaces, 4).temporaryTabs].reverse(), [4, 5, 9]);
});
test('a duplicate of a tab you are not on goes directly beneath that tab, not the active one', async () => {
    sync.invertTabOrder = false;
    tabs = [
        { id: 2, windowId: 1, index: 0, url: 'https://two.test/', groupId: -1 },
        { id: 3, windowId: 1, index: 1, url: 'https://three.test/', groupId: -1 },
        { id: 7, windowId: 1, index: 2, url: 'https://seven.test/', groupId: -1, active: true }
    ];
    local.spaces = [space('a', []), space('b', [2, 3, 7])];
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    // Chrome puts the copy right of tab 2 but names the active tab 7 as its opener.
    const copy = { id: 8, windowId: 1, index: 1, openerTabId: 7, url: 'https://two.test/', groupId: -1 };
    tabs.splice(1, 0, copy);
    tabs.slice(2).forEach(t => t.index++);
    chrome.tabs.onCreated.emit(copy);
    await store.run(() => {});
    assert.deepEqual(local.spaces[1].temporaryTabs, [2, 8, 3, 7]);
    assert.equal(store.copies.size, 0, 'forgotten once the pinned-link check has seen it');
});
test('the same link opened twice from a tab is a second link, not a copy of the first', async () => {
    sync.invertTabOrder = false;
    tabs = [
        { id: 2, windowId: 1, index: 0, url: 'https://two.test/', groupId: -1, active: true },
        { id: 3, windowId: 1, index: 1, url: 'https://three.test/', groupId: -1 }
    ];
    local.spaces = [space('a', []), space('b', [2, 3])];
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    // Chrome reports a new link tab with only the address it is going to, and puts each link from
    // tab 2 after its earlier ones.
    const open = async (id, index, url) => {
        tabs.slice(index).forEach(t => t.index++);
        const link = { id, windowId: 1, index, openerTabId: 2, url: '', pendingUrl: url, groupId: -1 };
        tabs.splice(index, 0, link);
        chrome.tabs.onCreated.emit({ ...link });
        await store.run(() => {});
        // By the next link, this one has loaded.
        Object.assign(link, { url, pendingUrl: undefined });
    };
    await open(10, 1, 'https://same.test/');
    await open(11, 2, 'https://same.test/');
    await open(12, 3, 'https://other.test/');
    assert.deepEqual(
        tabs.map(t => t.id),
        [2, 10, 11, 12, 3]
    );
    assert.deepEqual(local.spaces[1].temporaryTabs, [2, 10, 11, 12, 3]);
    assert.equal(store.copies.size, 0);
});
test('a duplicate that wakes a stopped worker still goes directly beneath the tab it copies', async () => {
    sync.invertTabOrder = false;
    tabs = [
        { id: 2, windowId: 1, index: 0, url: 'https://two.test/', groupId: -1 },
        { id: 3, windowId: 1, index: 1, url: 'https://three.test/', groupId: -1 },
        { id: 7, windowId: 1, index: 2, url: 'https://seven.test/', groupId: -1, active: true }
    ];
    local.spaces = [space('a', []), space('b', [2, 3, 7])];
    // The copy is already open when the worker starts, so starting up finds it before the event.
    const copy = { id: 8, windowId: 1, index: 1, openerTabId: 7, url: 'https://two.test/', groupId: -1 };
    tabs.splice(1, 0, copy);
    tabs.slice(2).forEach(t => t.index++);
    const store = new SpaceStore();
    store.install();
    chrome.tabs.onCreated.emit({ ...copy });
    await store.run(() => {});
    assert.deepEqual(local.spaces[1].temporaryTabs, [2, 8, 3, 7]);
    assert.equal(store.copies.size, 0);
});
test('a duplicate whose left neighbour closes before it is filed is still filed as a copy of its tab', async () => {
    sync.invertTabOrder = false;
    tabs = [
        { id: 2, windowId: 1, index: 0, url: 'https://two.test/', groupId: -1 },
        { id: 3, windowId: 1, index: 1, url: 'https://three.test/', groupId: -1 },
        { id: 7, windowId: 1, index: 2, url: 'https://seven.test/', groupId: -1, active: true }
    ];
    local.spaces = [space('a', []), space('b', [2, 3, 7])];
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    let release;
    const gate = new Promise(resolve => (release = resolve));
    const busy = store.run(() => gate);
    const copy = { id: 8, windowId: 1, index: 3, openerTabId: 7, url: 'https://seven.test/', groupId: -1 };
    tabs.push(copy);
    chrome.tabs.onCreated.emit({ ...copy });
    // Tab 2 closes while the queue is busy, so the copy is now at index 2 and tab 7 at index 1.
    tabs = tabs.filter(t => t.id !== 2);
    tabs.forEach((t, index) => (t.index = index));
    chrome.tabs.onRemoved.emit(2, { windowId: 1, isWindowClosing: false });
    release();
    await busy;
    await store.run(() => {});
    assert.deepEqual(local.spaces[0].temporaryTabs, []);
    assert.deepEqual(local.spaces[1].temporaryTabs, [3, 7, 8]);
});
test('explicit assignment beats creation fallback', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'assign', tabId: 1, spaceId: 'b', pinned: true });
    assert.deepEqual(local.spaces[0].temporaryTabs, []);
    assert.deepEqual(local.spaces[1].spaceBookmarks, [1]);
});
test('sync is opt-in and disabling it performs no mutations', async () => {
    await syncSpaceGroups(local.spaces);
    assert.deepEqual(mutations, []);
    sync.syncTabGroups = true;
    await syncSpaceGroups(local.spaces);
    assert.equal(mutations.filter(m => m[0] === 'group').length, 2);
    assert.deepEqual(
        local.spaces.map(s => s.id),
        ['a', 'b']
    );
    mutations.length = 0;
    sync.syncTabGroups = false;
    await syncSpaceGroups(local.spaces);
    assert.deepEqual(mutations, []);
});
test('sync creates each group in its tabs original window', async () => {
    tabs[1].windowId = 2;
    sync.syncTabGroups = true;
    await syncSpaceGroups(local.spaces);
    assert.deepEqual(
        mutations.filter(m => m[0] === 'group').map(m => m[1]),
        [
            { tabIds: [1], createProperties: { windowId: 1 } },
            { tabIds: [2], createProperties: { windowId: 2 } }
        ]
    );
});
test('sync never groups tabs in a popup or picture-in-picture window', async () => {
    windows.push({ id: 3, type: 'popup', alwaysOnTop: false }, { id: 4, type: 'normal', alwaysOnTop: true });
    tabs.push(
        { id: 3, windowId: 3, url: 'https://accounts.test/', groupId: -1 },
        { id: 4, windowId: 4, url: 'about:blank', groupId: -1 }
    );
    local.spaces[0].temporaryTabs.push(3, 4);
    sync.syncTabGroups = true;
    await syncSpaceGroups(local.spaces);
    assert.deepEqual(
        mutations.filter(m => m[0] === 'group').map(m => m[1]),
        [
            { tabIds: [1], createProperties: { windowId: 1 } },
            { tabIds: [2], createProperties: { windowId: 1 } }
        ]
    );
});
test('legacy membership and archived IDs migrate once without group writes', async () => {
    delete local.spaceModelVersion;
    local.spaces = [space(42, [1])];
    local.spaces[0].name = 'Work';
    local.archivedTabs = [{ url: 'https://archive.test', spaceId: 42 }];
    tabs[0].groupId = 42;
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.equal(typeof local.spaces[0].id, 'string');
    assert.equal(local.archivedTabs[0].spaceId, local.spaces[0].id);
    assert.equal(ownerOf(local.spaces, 1).id, local.spaces[0].id);
    assert.deepEqual(mutations, []);
});
test('optional import copies groups without changing them', async () => {
    groups = [{ id: 42, title: 'Imported', color: 'green', windowId: 1 }];
    tabs[1].groupId = 42;
    const store = new SpaceStore();
    await store.dispatch({ action: 'import', windowId: 1 });
    assert.equal(ownerOf(local.spaces, 2).name, 'Imported');
    assert.equal(local.tabGroupImportDismissed, true);
    assert.deepEqual(mutations, []);
});
test('late restored URL is assigned after an initially blank tab resolves', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [{ spaceId: 'b', section: 'temporaryTabs', order: 0, url: 'https://late.test/' }];
    tabs = [{ id: 10, windowId: 1 }];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    tabs[0].url = 'https://late.test/';
    await store.run(async () => {
        store.track(tabs[0]);
        await store.persist();
    });
    assert.equal(ownerOf(local.spaces, 10).id, 'b');
});
test('native pinning keeps space ownership in the favicon section even with the sidebar closed', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    tabs[0].pinned = true;
    await store.run(async () => {
        store.track(tabs[0]);
        await store.persist();
    });
    assert.equal(ownerOf(local.spaces, 1).id, 'a');
    assert.deepEqual(local.spaces[0].pinnedTabs, [1]);
    assert.deepEqual(local.spaces[0].temporaryTabs, []);
    tabs[0].pinned = false;
    await store.run(async () => {
        store.track(tabs[0]);
        await store.persist();
    });
    assert.equal(ownerOf(local.spaces, 1).id, 'a');
});
test('background event handlers track tab replacement and preserve window-close restore records', async () => {
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    tabs[0].id = 11;
    chrome.tabs.onReplaced.emit(11, 1);
    await store.run(() => {});
    assert.equal(ownerOf(local.spaces, 11).id, 'a');
    tabs = tabs.filter(t => t.id !== 11);
    chrome.tabs.onRemoved.emit(11, { isWindowClosing: true });
    await store.run(() => {});
    assert.equal(local.spaces[0].temporaryTabs.length, 0);
    assert.equal(local.spaceTabSnapshot.find(t => t.url === 'https://one.test/').spaceId, 'a');
});
// A window closes: Chrome reports each of its tabs closed with it, then the window.
async function closeWindowOf(store, windowId) {
    const closing = tabs.filter(t => t.windowId === windowId);
    tabs = tabs.filter(t => t.windowId !== windowId);
    for (const tab of closing) chrome.tabs.onRemoved.emit(tab.id, { windowId, isWindowClosing: true });
    await store.run(() => {});
}
// As Chrome reports them: a new link tab has only the address it is going to, while a tab Chrome
// restores with a closed window is on its address already and has no opener.
const linkTab = (id, windowId, openerTabId, url) => ({
    id,
    windowId,
    openerTabId,
    url: '',
    pendingUrl: url,
    groupId: -1
});
const restoredTab = (id, windowId, url, extra = {}) => ({ id, windowId, url, groupId: -1, ...extra });
async function openTab(store, tab) {
    tabs.push(tab);
    chrome.tabs.onCreated.emit({ ...tab });
    await store.run(() => {});
}
function twoWindowsOfB() {
    sync.invertTabOrder = false;
    // Space a has tab 1 in window 1; space b has the same page open in windows 1 and 2.
    tabs = [
        { id: 1, windowId: 1, url: 'https://one.test/', groupId: -1 },
        { id: 3, windowId: 1, url: 'https://two.test/', groupId: -1 },
        { id: 2, windowId: 2, url: 'https://two.test/', groupId: -1 }
    ];
    local.spaces = [space('a', [1]), space('b', [3, 2])];
}
test('a link to a page that closed with another window is filed under the tab it was opened from', async () => {
    twoWindowsOfB();
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    await closeWindowOf(store, 2);
    await openTab(store, linkTab(9, 1, 1, 'https://two.test/'));
    assert.deepEqual(local.spaces[0].temporaryTabs, [1, 9]);
    assert.deepEqual(local.spaces[1].temporaryTabs, [3]);
});
test('a link to the address of a space pinned tab that closed with its window stays an ordinary tab', async () => {
    sync.invertTabOrder = false;
    tabs = [
        { id: 1, windowId: 1, url: 'https://one.test/', groupId: -1 },
        { id: 2, windowId: 2, url: 'https://pin.test/', groupId: -1 }
    ];
    local.spaces = [space('a', [1]), { ...space('b', []), spaceBookmarks: [2] }];
    local.pinnedTabStatesById = { 2: { bookmarkId: 'bm-pin', pinnedUrl: 'https://pin.test/' } };
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    await closeWindowOf(store, 2);
    await openTab(store, linkTab(9, 1, 1, 'https://pin.test/'));
    assert.deepEqual(local.spaces[0].temporaryTabs, [1, 9]);
    assert.deepEqual(local.spaces[1].spaceBookmarks, []);
    assert.equal(local.pinnedTabStatesById[9], undefined);
});
test('a link opened into a new window does not take the place of a tab that closed with its window', async () => {
    twoWindowsOfB();
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    await closeWindowOf(store, 2);
    // Shift+click: a new window, no opener, and only the address it is going to.
    await store.dispatch({ action: 'activate', spaceId: 'a', windowId: 3 });
    await openTab(store, linkTab(9, 3, undefined, 'https://two.test/'));
    assert.deepEqual(local.spaces[0].temporaryTabs, [1, 9]);
});
test('reopening a closed window puts its tabs back, a space pinned tab with its bookmark', async () => {
    sync.invertTabOrder = false;
    tabs = [
        { id: 1, windowId: 1, url: 'https://one.test/', groupId: -1 },
        { id: 2, windowId: 2, url: 'https://pin.test/', groupId: -1 },
        { id: 3, windowId: 2, url: 'https://three.test/', groupId: -1 }
    ];
    local.spaces = [space('a', [1]), { ...space('b', [3]), spaceBookmarks: [2] }];
    local.pinnedTabStatesById = { 2: { bookmarkId: 'bm-pin', pinnedUrl: 'https://pin.test/' } };
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    await closeWindowOf(store, 2);
    // Cmd+Shift+T: Chrome brings the window back as window 5.
    await openTab(store, restoredTab(12, 5, 'https://pin.test/'));
    await openTab(store, restoredTab(13, 5, 'https://three.test/'));
    assert.deepEqual(local.spaces[1].spaceBookmarks, [12]);
    assert.deepEqual(local.spaces[1].temporaryTabs, [13]);
    assert.equal(local.pinnedTabStatesById[12]?.bookmarkId, 'bm-pin');
});
test("once a window has taken a closed window's tabs back, another new window cannot take the rest", async () => {
    sync.invertTabOrder = false;
    tabs = [
        { id: 1, windowId: 1, url: 'https://one.test/', groupId: -1 },
        { id: 2, windowId: 2, url: 'https://x.test/', groupId: -1 },
        { id: 3, windowId: 2, url: 'https://y.test/', groupId: -1 }
    ];
    local.spaces = [space('a', [1]), space('b', [2, 3])];
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    await closeWindowOf(store, 2);
    await openTab(store, restoredTab(12, 5, 'https://x.test/'));
    // Another window brings back a page that window 2 also held, as History can.
    await store.dispatch({ action: 'activate', spaceId: 'a', windowId: 6 });
    await openTab(store, restoredTab(13, 6, 'https://y.test/'));
    assert.deepEqual(local.spaces[1].temporaryTabs, [12]);
    assert.deepEqual(local.spaces[0].temporaryTabs, [1, 13]);
});
test('a tab that closed with the last window still comes back in its space after a restart', async () => {
    tabs = [{ id: 2, windowId: 2, url: 'https://two.test/', groupId: -1 }];
    local.spaces = [space('a', []), space('b', [2])];
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    await closeWindowOf(store, 2);
    assert.ok(local.spaceTabSnapshot.some(t => t.url === 'https://two.test/' && t.spaceId === 'b'));
    // Chrome quits and starts again, restoring the window with a new tab id.
    session.spaceSession = false;
    tabs = [{ id: 40, windowId: 1, url: 'https://two.test/', groupId: -1 }];
    const after = new SpaceStore();
    await after.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[1].temporaryTabs, [40]);
});
// Saved before a restart: the same page in space a in window 5 and in space b in window 6, each
// after another page of its own space.
const twoSpacesBeforeRestart = () => [
    { spaceId: 'a', section: 'temporaryTabs', order: 0, url: 'https://home.test/', windowId: 5, index: 0 },
    { spaceId: 'a', section: 'temporaryTabs', order: 1, url: 'https://same.test/', windowId: 5, index: 1 },
    { spaceId: 'b', section: 'temporaryTabs', order: 0, url: 'https://work.test/', windowId: 6, index: 0 },
    { spaceId: 'b', section: 'temporaryTabs', order: 1, url: 'https://same.test/', windowId: 6, index: 1 }
];
const restoredWindows = () => [
    // Chrome restores window 6 first, as window 1, and window 5 as window 2, with new ids.
    { id: 20, windowId: 1, index: 0, url: 'https://work.test/', groupId: -1 },
    { id: 21, windowId: 1, index: 1, url: 'https://same.test/', groupId: -1 },
    { id: 30, windowId: 2, index: 0, url: 'https://home.test/', groupId: -1 },
    { id: 31, windowId: 2, index: 1, url: 'https://same.test/', groupId: -1 }
];
test('after a restart, the same page open in two spaces goes back to its own space', async () => {
    sync.invertTabOrder = false;
    session.spaceSession = false;
    local.spaceTabSnapshot = twoSpacesBeforeRestart();
    tabs = restoredWindows();
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[0].temporaryTabs, [30, 31]);
    assert.deepEqual(local.spaces[1].temporaryTabs, [20, 21]);
});
test('after a restart, the same page goes back to its own space when Chrome reports the tabs one by one', async () => {
    sync.invertTabOrder = false;
    session.spaceSession = false;
    local.spaceTabSnapshot = twoSpacesBeforeRestart();
    tabs = [];
    const store = new SpaceStore();
    store.install();
    await store.run(() => {});
    for (const tab of restoredWindows()) await openTab(store, tab);
    assert.deepEqual(local.spaces[0].temporaryTabs, [30, 31]);
    assert.deepEqual(local.spaces[1].temporaryTabs, [20, 21]);
});
test('a snapshot saved by an older version, without windows or places, still restores every tab', async () => {
    sync.invertTabOrder = false;
    session.spaceSession = false;
    local.spaceTabSnapshot = twoSpacesBeforeRestart().map(record => {
        const old = { ...record };
        delete old.windowId;
        delete old.index;
        return old;
    });
    tabs = restoredWindows();
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    // As before: each tab is back in a space in its saved place, the first one on an address taking
    // the first record of it, as there is nothing to tell the two apart.
    assert.deepEqual(local.spaces[0].temporaryTabs, [30, 21]);
    assert.deepEqual(local.spaces[1].temporaryTabs, [20, 31]);
});
test("each tab's window and place are saved, for the next restart", async () => {
    tabs = [{ id: 1, windowId: 4, index: 2, url: 'https://one.test/', groupId: -1 }];
    local.spaces = [space('a', [1])];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    const saved = local.spaceTabSnapshot.find(record => record.tabId === 1);
    assert.equal(saved.windowId, 4);
    assert.equal(saved.index, 2);
});
// Sidecove's own pages (settings, the setup guide shown after an update) are tabs the user
// opened or is reading, so they belong in a space like any other tab (#103).
for (const page of ['options.html', 'installation-onboarding.html']) {
    test(`Sidecove's own ${page} tab is listed in a space`, async () => {
        const store = new SpaceStore();
        await store.dispatch({ action: 'get' });
        tabs.push({ id: 3, windowId: 1, url: `chrome-extension://sidecove/${page}`, groupId: -1 });
        await store.run(async () => {
            store.track(tabs[2]);
            await store.persist();
        });
        assert.ok(ownerOf(local.spaces, 3), `${page} should belong to a space`);
    });
    test(`a tab that navigates to Sidecove's own ${page} keeps its space`, async () => {
        const store = new SpaceStore();
        await store.dispatch({ action: 'get' });
        // A blank helper tab is provisional until it has an address: the state the old filter acted on.
        store.provisional.add(1);
        tabs[0].url = `chrome-extension://sidecove/${page}`;
        await store.run(async () => {
            store.track(tabs[0]);
            await store.persist();
        });
        assert.equal(ownerOf(local.spaces, 1)?.id, 'a');
        assert.equal(store.provisional.has(1), false, 'the tab was handled as a navigated provisional tab');
    });
}
test('the side panel page opened in a tab stays out of every space', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    tabs[0].url = 'chrome-extension://sidecove/sidebar.html';
    await store.run(async () => {
        store.track(tabs[0]);
        await store.persist();
    });
    assert.equal(ownerOf(local.spaces, 1), undefined);
});
test('migration recovers legacy groups whose IDs changed before the upgrade', async () => {
    delete local.spaceModelVersion;
    local.spaces = [space(42, [1])];
    local.spaces[0].name = 'Work';
    local.spaces.push({ ...space(88, []), name: 'Home' });
    groups = [
        { id: 77, title: 'Work', color: 'blue', windowId: 1 },
        { id: 42, title: 'Unrelated', color: 'red', windowId: 1 }
    ];
    tabs[0].groupId = 77;
    tabs[1].groupId = 42;
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.equal(ownerOf(local.spaces, 1).name, 'Work');
    assert.equal(ownerOf(local.spaces, 2).name, 'Home');
    assert.deepEqual(mutations, []);
});
test('restart restores bookmark bindings even after navigation away from the pinned URL', async () => {
    session.spaceSession = false;
    local.pinnedTabStatesById = { 1: { bookmarkId: 'old-wrong' } };
    local.spaceTabSnapshot = [
        {
            spaceId: 'b',
            section: 'spaceBookmarks',
            order: 0,
            url: 'https://navigated.test/',
            pinnedState: { bookmarkId: 'favorite', pinnedUrl: 'https://original.test/' }
        }
    ];
    tabs = [{ id: 12, windowId: 1, url: 'https://navigated.test/' }];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[1].spaceBookmarks, [12]);
    assert.equal(local.pinnedTabStatesById[12].bookmarkId, 'favorite');
    assert.equal(local.pinnedTabStatesById[1], undefined);
});
test('ordinary new-tab pages use the selected space even with an incidental opener', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 1 });
    const tab = { id: 3, windowId: 1, openerTabId: 1, url: 'chrome://newtab/' };
    tabs.push(tab);
    await store.run(async () => {
        store.track(tab);
        await store.persist();
    });
    assert.equal(ownerOf(local.spaces, 3).id, 'b');
});
test('explicit tab focus raises the window returned by Chrome', async () => {
    const actions = [];
    chrome.tabs.update = async (id, update) => {
        actions.push(['tab', id, update]);
        return { id, windowId: 22 };
    };
    chrome.windows = { update: async (id, update) => actions.push(['window', id, update]) };
    await Utils.focusTab(2);
    assert.deepEqual(actions, [
        ['tab', 2, { active: true }],
        ['window', 22, { focused: true }]
    ]);
});
test('version-2 startup discovers Sidecove bookmark spaces with group sync off', async () => {
    local.spaces = [];
    local.spaceRegistry = { project: { spaceUuid: 'saved-project', color: 'purple', bookmarkFolderId: 'project' } };
    const tree = {
        root: [
            { id: 'project', title: 'Project' },
            { id: 'loose', title: 'Not a space', url: 'https://loose.test/' }
        ],
        project: [
            { id: 'saved-link', title: 'Saved', url: 'https://saved.test/' },
            { id: 'nested', title: 'Reading' }
        ],
        nested: []
    };
    chrome.bookmarks.getChildren = async id => structuredClone(tree[id] || []);
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.equal(store.spaces.length, 1);
    assert.equal(store.spaces[0].id, 'saved-project');
    assert.equal(store.spaces[0].bookmarkFolderId, 'project');
    assert.equal(store.spaces[0].color, 'purple');
    await store.dispatch({ action: 'get' });
    assert.equal(store.spaces.length, 1);
    assert.deepEqual(mutations, []);
    assert.equal(tree.project[0].id, 'saved-link');
});
test('sidebar reads discover later bookmark folders and follow folder renames by ID', async () => {
    let folders = [
        { id: 'a', title: 'Renamed' },
        { id: 'b', title: 'b' }
    ];
    chrome.bookmarks.getChildren = async id => (id === 'root' ? structuredClone(folders) : []);
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.equal(store.spaces.find(s => s.id === 'a').name, 'Renamed');
    folders.push({ id: 'later', title: 'Synced later' });
    await store.dispatch({ action: 'get' });
    assert.equal(store.spaces.length, 3);
    assert.equal(store.spaces[2].bookmarkFolderId, 'later');
    assert.deepEqual(mutations, []);
});
test('space order follows the order of space folders under the Sidecove folder', async () => {
    let folders = [
        { id: 'b', title: 'b' },
        { id: 'loose', title: 'Loose', url: 'https://loose.test/' },
        { id: 'a', title: 'a' }
    ];
    chrome.bookmarks.getChildren = async id => (id === 'root' ? structuredClone(folders) : []);
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.deepEqual(
        store.spaces.map(s => s.id),
        ['b', 'a']
    );
    assert.deepEqual(
        local.spaces.map(s => s.id),
        ['b', 'a']
    );
    folders = [folders[2], folders[0], folders[1]];
    const after = await store.dispatch({ action: 'get' });
    assert.deepEqual(
        after.map(s => s.id),
        ['a', 'b']
    );
    assert.deepEqual(
        local.spaces.map(s => s.id),
        ['a', 'b']
    );
});

// A link from another app can open a window Sidecove has no space for yet.
const newTabIn = async (store, windowId, id) => {
    const tab = { id, windowId, url: `https://new-${id}.test/` };
    tabs.push(tab);
    await store.run(async () => {
        store.track(tab);
        await store.persist();
    });
    return ownerOf(local.spaces, id).id;
};
test('a tab in a window with no space of its own goes to the space last chosen, not the default', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 1 });
    assert.equal(await newTabIn(store, 2, 30), 'b');
    // The choice survives the background worker restarting.
    assert.equal(await newTabIn(new SpaceStore(), 3, 31), 'b');
});
test('a panel starting up in a window does not change the space last chosen', async () => {
    const store = new SpaceStore();
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 1 });
    await store.dispatch({ action: 'activate', spaceId: 'a', windowId: 2, initial: true });
    assert.equal(await newTabIn(store, 3, 32), 'b');
});
test('a tab changing in an unfocused window does not count as the space in use; focusing a window does', async () => {
    tabs.push({ id: 5, windowId: 2, url: 'https://five.test/' });
    local.spaces[0].temporaryTabs.push(5);
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 1 });
    await store.dispatch({ action: 'activate', spaceId: 'b', windowId: 2, initial: true });
    chrome.tabs.onActivated.emit({ tabId: 5, windowId: 2 });
    await store.run(() => {});
    assert.equal(await newTabIn(store, 3, 33), 'b');
    chrome.windows.onFocusChanged.emit(2);
    await store.run(() => {});
    assert.equal(await newTabIn(store, 4, 34), 'a');
});

test('existing native pins migrate to the active space and survive worker restart', async () => {
    tabs.push({ id: 3, windowId: 1, pinned: true, url: 'https://pin.test/' });
    session.activeSpaces = { 1: 'b' };
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[1].pinnedTabs, [3]);
    await store.dispatch({ action: 'activate', windowId: 1, spaceId: 'a' });
    const next = new SpaceStore();
    await next.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[1].pinnedTabs, [3]);
});

test('browser restart restores native pins by URL without consuming ordinary tab records', async () => {
    session.spaceSession = false;
    local.spaceTabSnapshot = [
        { spaceId: 'a', section: 'temporaryTabs', order: 0, url: 'https://same.test/' },
        { spaceId: 'b', section: 'pinnedTabs', order: 0, url: 'https://same.test/' }
    ];
    tabs = [
        { id: 10, windowId: 1, pinned: true, url: 'https://same.test/' },
        { id: 11, windowId: 1, pinned: false, url: 'https://same.test/' }
    ];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[1].pinnedTabs, [10]);
    assert.deepEqual(local.spaces[0].temporaryTabs, [11]);
});

test('stale panel edits preserve concurrently pinned tabs', () => {
    const before = [space('a', [1]), space('b', [2])];
    const current = structuredClone(before);
    current[0].temporaryTabs = [];
    current[0].pinnedTabs = [1];
    const after = structuredClone(before);
    after[0].name = 'Renamed';
    const result = applySpacePatch(current, before, after);
    assert.deepEqual(result[0].pinnedTabs, [1]);
    assert.deepEqual(result[0].temporaryTabs, []);
});

test('moving a top-bar pin to another space keeps it pinned and excludes it from normal lists', async () => {
    tabs[0].pinned = true;
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'assignPin', tabId: 1, spaceId: 'b' });
    assert.deepEqual(local.spaces[0].pinnedTabs, []);
    assert.deepEqual(local.spaces[1].pinnedTabs, [1]);
    assert.deepEqual(local.spaces[1].temporaryTabs, [2]);
    assert.equal(tabs[0].pinned, true);
});

test('links opened from shared native pins use the selected space, while per-space pins keep their owner', async () => {
    tabs[0].pinned = true;
    session.activeSpaces = { 1: 'b' };
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    // The pin retains a remembered owner in a, independent of its visible scope.
    await store.dispatch({ action: 'assignPin', tabId: 1, spaceId: 'a' });
    const child = { id: 3, windowId: 1, openerTabId: 1, url: 'https://child.test/' };
    tabs.push(child);
    await store.run(async () => {
        store.track(child);
        await store.persist();
    });
    assert.equal(ownerOf(local.spaces, 3).id, 'b');
    store.perSpacePinnedFavorites = true;
    const scopedChild = { ...child, id: 4 };
    tabs.push(scopedChild);
    await store.run(async () => {
        store.track(scopedChild);
        await store.persist();
    });
    assert.equal(ownerOf(local.spaces, 4).id, 'a');
});

test('a hidden tab belongs to no space, stays out when it navigates or the worker restarts, and returns in order', async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/' }, { id: 4, windowId: 1, url: 'https://four.test/' });
    local.spaces[0].temporaryTabs = [1, 3, 4];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'hide', tabIds: [3, 4] });
    assert.deepEqual(local.spaces[0].temporaryTabs, [1]);
    assert.deepEqual(session.hiddenTabs, [3, 4]);

    // Navigating, or a worker that starts again and meets the open tabs, does not adopt them.
    await store.run(() => store.track({ ...tabs[2], url: 'https://moved.test/' }));
    assert.deepEqual(store.spaces[0].temporaryTabs, [1]);
    const restarted = new SpaceStore();
    await restarted.dispatch({ action: 'get' });
    assert.deepEqual(local.spaces[0].temporaryTabs, [1]);
    assert.deepEqual(local.spaces[1].temporaryTabs, [2]);

    // A tab opened meanwhile stays where it joined; the hidden ones go back to their places.
    tabs.push({ id: 5, windowId: 1, url: 'https://five.test/' });
    await restarted.run(() => restarted.track(tabs[4]));
    assert.deepEqual(restarted.spaces[0].temporaryTabs, [1, 5]);
    await restarted.dispatch({ action: 'unhide', tabIds: [3, 4], spaceId: 'a', order: [1, 3, 4] });
    assert.deepEqual(local.spaces[0].temporaryTabs, [1, 3, 4, 5]);
    assert.deepEqual(session.hiddenTabs, []);
});

test('a hidden tab that Chrome closes is forgotten, and unhiding into a deleted space adopts the tab', async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/' }, { id: 4, windowId: 1, url: 'https://four.test/' });
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'hide', tabIds: [3, 4] });
    tabs = tabs.filter(t => t.id !== 3);
    store.install();
    chrome.tabs.onRemoved.emit(3, {});
    await store.run(() => {});
    assert.deepEqual(session.hiddenTabs, [4]);
    await store.dispatch({ action: 'unhide', tabIds: [4], spaceId: 'gone', order: [] });
    assert.ok(ownerOf(store.spaces, 4), 'the tab is back in some space');
});

test('a hidden tab Chrome swaps for a new one stays hidden under the new id', async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/' });
    local.spaces[0].temporaryTabs = [1, 3];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'hide', tabIds: [3] });
    store.install();
    tabs = tabs.map(t => (t.id === 3 ? { ...t, id: 13 } : t));
    chrome.tabs.onReplaced.emit(13, 3);
    await store.run(() => {});
    assert.deepEqual(session.hiddenTabs, [13]);
    // The new tab loading does not file it into a space while it is hidden.
    chrome.tabs.onUpdated.emit(13, { url: 'https://three.test/' }, tabs[2]);
    await store.run(() => {});
    assert.equal(ownerOf(store.spaces, 13), undefined);
    await store.dispatch({ action: 'unhide', tabIds: [13], spaceId: 'a', order: [1, 13] });
    assert.deepEqual(local.spaces[0].temporaryTabs, [1, 13]);
    assert.deepEqual(session.hiddenTabs, []);
});

test("hiding a tab forgets it as the space's last tab, and unhiding nothing leaves the order alone", async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/' }, { id: 5, windowId: 1, url: 'https://five.test/' });
    local.spaces[0].temporaryTabs = [3, 1, 5];
    local.spaces[0].lastTab = 3;
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'hide', tabIds: [3] });
    assert.equal(store.spaces[0].lastTab, undefined);

    // The user moved on while the tab was hidden; nothing came back, so nothing is reordered.
    store.spaces[0].temporaryTabs = [5, 1];
    await store.dispatch({ action: 'unhide', tabIds: [], spaceId: 'a', order: [1, 5, 3] });
    assert.deepEqual(store.spaces[0].temporaryTabs, [5, 1]);
});

test('a hidden tab is not queued to come back when its window closes', async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/' });
    local.spaces[0].temporaryTabs = [1, 3];
    const store = new SpaceStore();
    store.install();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'hide', tabIds: [3] });
    tabs = tabs.filter(t => t.id !== 3);
    chrome.tabs.onRemoved.emit(3, { isWindowClosing: true });
    await store.run(() => {});
    assert.equal(
        store.restoreQueue.some(t => t.url === 'https://three.test/'),
        false
    );
});

test('a hidden tab pinned in the meantime comes back with the pinned tabs', async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/' }, { id: 4, windowId: 1, url: 'https://four.test/' });
    local.spaces[0].temporaryTabs = [1, 3, 4];
    const store = new SpaceStore();
    await store.dispatch({ action: 'get' });
    await store.dispatch({ action: 'hide', tabIds: [3, 4] });
    tabs[2].pinned = true;
    await store.dispatch({ action: 'unhide', tabIds: [3, 4], spaceId: 'a', order: [1, 3, 4] });
    assert.deepEqual(local.spaces[0].temporaryTabs, [1, 4]);
    assert.deepEqual(local.spaces[0].pinnedTabs, [3]);
});
