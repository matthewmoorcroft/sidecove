import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerCloseEmptyNewTab, EMPTY_TAB_STORAGE_KEY } from '../../../src/background/close-empty-new-tab.js';

const NTP = 'chrome://newtab/';
let tabs, session, removed, settings, spaces, hidden, pinnedStates, listeners;

const event = name => ({ addListener: fn => (listeners[name] = fn) });
const chromeApi = () => ({
    tabs: {
        query: async ({ windowId, active } = {}) =>
            tabs.filter(t => (windowId === undefined || t.windowId === windowId) && (!active || t.active)),
        get: async id => {
            const tab = tabs.find(t => t.id === id);
            if (!tab) throw new Error(`No tab with id: ${id}.`);
            return { ...tab };
        },
        remove: async id => {
            removed.push(id);
            tabs = tabs.filter(t => t.id !== id);
        },
        onCreated: event('created'),
        onUpdated: event('updated'),
        onActivated: event('activated'),
        onRemoved: event('removed'),
        onReplaced: event('replaced')
    },
    windows: { onRemoved: event('windowRemoved') },
    storage: {
        session: {
            get: async key => ({ [key]: session[key] }),
            set: async values => Object.assign(session, structuredClone(values))
        },
        local: { get: async () => ({ pinnedTabStatesById: pinnedStates }) }
    }
});
const start = async () => {
    globalThis.chrome = chromeApi();
    const { ready } = registerCloseEmptyNewTab({
        chromeApi: globalThis.chrome,
        spaceStore: {
            run: async operation => operation.call(null),
            get spaces() {
                return spaces;
            },
            get hidden() {
                return hidden;
            }
        },
        getSettings: async () => settings
    });
    await ready;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
// What Chrome does for Cmd+T: creates the tab and makes it active.
async function openNewTab(id, windowId = 1) {
    tabs.forEach(t => t.windowId === windowId && (t.active = false));
    tabs.push({ id, windowId, url: '', pendingUrl: NTP, active: true, pinned: false });
    await listeners.created({ id, windowId, pendingUrl: NTP, url: '' });
    await listeners.activated({ tabId: id, windowId });
    tabs.find(t => t.id === id).url = NTP;
    tabs.find(t => t.id === id).pendingUrl = undefined;
    await listeners.updated(
        id,
        { url: NTP },
        tabs.find(t => t.id === id)
    );
}
async function switchTo(id) {
    const tab = tabs.find(t => t.id === id);
    tabs.forEach(t => t.windowId === tab.windowId && (t.active = t.id === id));
    await listeners.activated({ tabId: id, windowId: tab.windowId });
    await settle();
}

beforeEach(() => {
    tabs = [{ id: 1, windowId: 1, url: 'https://one.test/', active: true, pinned: false }];
    session = {};
    removed = [];
    settings = { closeEmptyNewTabs: true };
    spaces = [{ id: 'a', spaceBookmarks: [] }];
    hidden = new Set();
    pinnedStates = {};
    listeners = {};
});

test('closes an empty new tab when another tab is chosen, and activates nothing itself', async () => {
    await start();
    await openNewTab(2);
    await switchTo(1);
    assert.deepEqual(removed, [2]);
    assert.equal(tabs.find(t => t.active).id, 1);
});

test('keeps it while it is still the tab shown', async () => {
    await start();
    await openNewTab(2);
    await settle();
    assert.deepEqual(removed, []);
});

test('keeps a tab that went to a site, even when it is back on the new tab page', async () => {
    await start();
    await openNewTab(2);
    const tab = tabs.find(t => t.id === 2);
    tab.url = 'https://two.test/';
    await listeners.updated(2, { url: tab.url }, tab);
    tab.url = NTP;
    await listeners.updated(2, { url: NTP }, tab);
    await switchTo(1);
    assert.deepEqual(removed, []);
});

test('keeps a tab that is loading an address when it is left', async () => {
    await start();
    await openNewTab(2);
    const tab = tabs.find(t => t.id === 2);
    tab.pendingUrl = 'https://two.test/';
    await switchTo(1);
    assert.deepEqual(removed, []);
});

test('ignores tabs that did not open as an empty new tab', async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/', active: false, pinned: false });
    await start();
    await switchTo(3);
    await switchTo(1);
    assert.deepEqual(removed, [], 'a site already open before tracking began');
    tabs.push({ id: 4, windowId: 1, url: 'https://four.test/', active: false, pinned: false });
    await listeners.created({ id: 4, windowId: 1, url: '', pendingUrl: 'https://four.test/' });
    await switchTo(4);
    await switchTo(1);
    assert.deepEqual(removed, []);
});

test('closes a new tab already open when tracking begins, once it is left', async () => {
    tabs.push({ id: 3, windowId: 1, url: NTP, active: false, pinned: false });
    await start();
    await switchTo(3);
    assert.deepEqual(removed, [], 'still shown');
    await switchTo(1);
    assert.deepEqual(removed, [3]);
});

test('the "+ New Tab" press from a new tab open before tracking began leaves one, not two', async () => {
    tabs = [{ id: 3, windowId: 1, url: NTP, active: true, pinned: false }];
    tabs.push({ id: 4, windowId: 1, url: 'https://four.test/', active: false, pinned: false });
    await start();
    await openNewTab(5);
    await settle();
    assert.deepEqual(removed, [3]);
    assert.deepEqual(
        tabs.map(t => t.id),
        [4, 5]
    );
});

test('keeps what protects a new tab already open when tracking begins', async () => {
    tabs.push(
        { id: 3, windowId: 1, url: NTP, active: false, pinned: true },
        { id: 4, windowId: 1, url: NTP, active: false, pinned: false },
        { id: 5, windowId: 1, url: NTP, active: false, pinned: false }
    );
    spaces = [{ id: 'a', spaceBookmarks: [4] }];
    await start();
    for (const id of [3, 4, 5]) await switchTo(id);
    await switchTo(1);
    assert.deepEqual(removed, [5], 'only the one that is not pinned or a favourite closes');
});

test('after a worker restart, only the saved list decides', async () => {
    await start();
    await openNewTab(2);
    const tab = tabs.find(t => t.id === 2);
    tab.url = 'https://two.test/';
    await listeners.updated(2, { url: tab.url }, tab);
    tab.url = NTP; // back on the new tab page after visiting a site
    await listeners.updated(2, { url: NTP }, tab);
    await settle();
    listeners = {};
    await start();
    await switchTo(1);
    assert.deepEqual(removed, [], 'a tab seen going to a site is not taken for an empty one');
});

test('a restart before any new tab opened still counts as having started', async () => {
    await start();
    await settle();
    assert.deepEqual(session[EMPTY_TAB_STORAGE_KEY].untouched, []);
    tabs.push({ id: 3, windowId: 1, url: NTP, active: false, pinned: false }); // went to a site and back, unseen
    listeners = {};
    await start();
    await switchTo(3);
    await switchTo(1);
    assert.deepEqual(removed, []);
});

test('keeps the setting’s promise: nothing closes when it is off', async () => {
    settings.closeEmptyNewTabs = false;
    await start();
    await openNewTab(2);
    await switchTo(1);
    assert.deepEqual(removed, []);
});

test('never closes the last tab of a window', async () => {
    await start();
    await openNewTab(2);
    tabs = tabs.filter(t => t.id === 2); // the tab switched to goes away as it is chosen
    await listeners.activated({ tabId: 1, windowId: 1 });
    await settle();
    assert.deepEqual(removed, []);
});

test('never closes a pinned tab or a favourite', async () => {
    await start();
    await openNewTab(2);
    tabs.find(t => t.id === 2).pinned = true;
    await switchTo(1);
    await openNewTab(3);
    spaces = [{ id: 'a', spaceBookmarks: [3] }];
    await switchTo(1);
    await openNewTab(4);
    pinnedStates = { 4: { bookmarkId: 'b' } };
    await switchTo(1);
    assert.deepEqual(removed, []);
});

test('watches each window on its own', async () => {
    tabs.push({ id: 9, windowId: 2, url: 'https://nine.test/', active: true, pinned: false });
    await start();
    await openNewTab(2, 1);
    await switchTo(9); // a tab in the other window: the empty tab is still shown in its own window
    assert.deepEqual(removed, []);
    await switchTo(1);
    assert.deepEqual(removed, [2]);
});

test('carries on after the worker restarts', async () => {
    await start();
    await openNewTab(2);
    await settle();
    assert.deepEqual(session[EMPTY_TAB_STORAGE_KEY].untouched, [2]);
    listeners = {};
    await start(); // a new worker reads what the old one saved
    await switchTo(1);
    assert.deepEqual(removed, [2]);
});

test('forgets a tab that closes', async () => {
    await start();
    await openNewTab(2);
    await listeners.removed(2);
    await settle();
    assert.deepEqual(session[EMPTY_TAB_STORAGE_KEY].untouched, []);
});

test('keeps a tab the user went straight back to', async () => {
    await start();
    await openNewTab(2);
    const away = listeners.activated({ tabId: 1, windowId: 1 }); // still deciding when...
    await listeners.activated({ tabId: 2, windowId: 1 }); // ...the user comes back
    await away;
    await settle();
    assert.deepEqual(removed, []);
});

test('keeps a tab that was moved to another window', async () => {
    tabs.push({ id: 9, windowId: 2, url: 'https://nine.test/', active: true, pinned: false });
    await start();
    await openNewTab(2, 1);
    tabs.find(t => t.id === 2).windowId = 2; // dragged into the other window
    await listeners.activated({ tabId: 1, windowId: 1 });
    await settle();
    assert.deepEqual(removed, []);
});

test('closes a tab left before its page finished loading', async () => {
    await start();
    tabs.push({ id: 2, windowId: 1, url: '', pendingUrl: NTP, active: false, pinned: false });
    await listeners.created({ id: 2, windowId: 1, url: '', pendingUrl: NTP });
    await listeners.activated({ tabId: 2, windowId: 1 });
    await switchTo(1);
    assert.deepEqual(removed, [2]);
});

test('forgets a window that closes', async () => {
    await start();
    await listeners.windowRemoved(1);
    await settle();
    assert.deepEqual(session[EMPTY_TAB_STORAGE_KEY].shown, []);
});

test('keeps the new tab when every other tab in the window is hidden by Clear', async () => {
    await start();
    await openNewTab(2);
    hidden = new Set([1]);
    await switchTo(1);
    assert.deepEqual(removed, [], 'the hidden tab closes soon, so this would be the last tab');
});

test('still closes it when a tab that is not hidden remains', async () => {
    tabs.push({ id: 3, windowId: 1, url: 'https://three.test/', active: false, pinned: false });
    await start();
    await openNewTab(2);
    hidden = new Set([1]);
    await switchTo(3);
    assert.deepEqual(removed, [2]);
});
