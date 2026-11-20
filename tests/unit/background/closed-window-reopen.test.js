import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerClosedWindowReopen } from '../../../src/background/closed-window-reopen.js';

const event = () => ({
    listeners: [],
    addListener(fn) {
        this.listeners.push(fn);
    },
    removeListener(fn) {
        this.listeners = this.listeners.filter(other => other !== fn);
    },
    fire(...args) {
        return Promise.all(this.listeners.map(fn => fn(...args)));
    }
});

let chromeApi, store, windows, tabs, local, session, created, discarded, timers, nextId, clock;

const record = (tabId, url, over = {}) => ({ tabId, spaceId: 's1', section: 'temporaryTabs', order: 0, url, ...over });

beforeEach(() => {
    windows = [
        { id: 1, type: 'normal', incognito: false, focused: true },
        { id: 2, type: 'normal', incognito: false, focused: false }
    ];
    tabs = [{ id: 10, windowId: 1, url: 'https://mine.test/', status: 'complete', title: 'Mine' }];
    local = { closedLinks: [{ url: 'https://old.test/' }], spaces: [] };
    session = { closedLinkTabInfo: [[1, {}]] };
    created = [];
    discarded = [];
    timers = [];
    nextId = 100;
    clock = 1000;
    const area = data => ({
        get: async key => (key in data ? { [key]: data[key] } : {}),
        set: async values => Object.assign(data, values),
        remove: async key => delete data[key]
    });
    chromeApi = {
        storage: { local: area(local), session: area(session) },
        windows: {
            getAll: async ({ windowTypes } = {}) =>
                windows.filter(win => !windowTypes || windowTypes.includes(win.type)),
            onCreated: event(),
            onRemoved: event(),
            onFocusChanged: event()
        },
        tabs: {
            query: async () => tabs,
            get: async id => {
                const tab = tabs.find(t => t.id === id);
                if (!tab) throw new Error('No tab');
                return tab;
            },
            create: async ({ windowId, url, active }) => {
                const tab = { id: nextId++, windowId, url, active, status: 'loading', title: url.slice(8) };
                tabs.push(tab);
                created.push({ windowId, url, active });
                return tab;
            },
            discard: async id => {
                discarded.push(id);
                tabs.find(t => t.id === id).discarded = true;
            },
            onUpdated: event()
        }
    };
    store = {
        spaces: [{ id: 's1', spaceBookmarks: [], pinnedTabs: [], temporaryTabs: [10] }],
        restoreQueue: [],
        persisted: 0,
        run: operation => operation(),
        persist: async () => store.persisted++
    };
});

const start = () =>
    registerClosedWindowReopen({
        chromeApi,
        spaceStore: store,
        now: () => clock++,
        schedule: (fn, ms) => {
            const timer = { fn, ms };
            timers.push(timer);
            return timer;
        },
        cancel: timer => {
            if (timer) timer.cancelled = true;
        }
    });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const runTimers = async ms => {
    for (const timer of timers.splice(0).filter(t => !t.cancelled && t.ms === ms)) await timer.fn();
    await settle();
};

// Window 2 has two pages in space s1, listed after the main window's tab 10; then it closes.
async function closeWindowTwo({ windowId = 2 } = {}) {
    const layout = [10, 20, 21];
    store.spaces[0].temporaryTabs = [10];
    store.restoreQueue = [record(20, 'https://a.test/one'), record(21, 'https://a.test/two')];
    windows = windows.filter(win => win.id !== windowId);
    await store.onTabClosedWithWindow({ tabId: 20, windowId, record: record(20, 'https://a.test/one'), layout });
    await store.onTabClosedWithWindow({
        tabId: 21,
        windowId,
        record: record(21, 'https://a.test/two'),
        layout: [10, 21]
    });
}

test('the old closed links are removed when the worker starts', async () => {
    start();
    await settle();
    assert.equal('closedLinks' in local, false);
    assert.equal('closedLinkTabInfo' in session, false);
});

test('the pages of a closed window open again in the window that stays, unloaded, in the same space and order', async () => {
    start();
    await settle();
    await closeWindowTwo();
    // Nothing happens until the window has finished closing.
    assert.deepEqual(created, []);
    await runTimers(1000);
    assert.deepEqual(created, [
        { windowId: 1, url: 'https://a.test/one', active: false },
        { windowId: 1, url: 'https://a.test/two', active: false }
    ]);
    assert.deepEqual(store.spaces[0].temporaryTabs, [10, 100, 101]);
    assert.deepEqual(store.restoreQueue, []);
    assert.equal(store.persisted, 1);

    // Each is unloaded once it has its title.
    const [one, two] = [100, 101].map(id => tabs.find(t => t.id === id));
    one.title = 'One';
    await chromeApi.tabs.onUpdated.fire(100, { title: 'One' }, one);
    await settle();
    assert.deepEqual(discarded, [100]);
    // A tab that never gets one is unloaded after a while anyway.
    await runTimers(15000);
    assert.deepEqual(discarded, [100, 101]);
    assert.equal(two.discarded, true);
});

test('a reopened tab you have gone to is not unloaded', async () => {
    start();
    await settle();
    await closeWindowTwo();
    await runTimers(1000);
    tabs.find(t => t.id === 100).active = true;
    await chromeApi.tabs.onUpdated.fire(
        100,
        { status: 'complete' },
        tabs.find(t => t.id === 100)
    );
    await settle();
    assert.deepEqual(discarded, []);
});

test('closing the last window, or quitting Chrome, reopens nothing', async () => {
    start();
    await settle();
    windows = windows.filter(win => win.id !== 1);
    await closeWindowTwo();
    await runTimers(1000);
    assert.deepEqual(created, []);
    // The tabs stay queued for Chrome's own restore.
    assert.equal(store.restoreQueue.length, 2);
});

test('a private window or a popup leaves nothing behind', async () => {
    windows.push({ id: 3, type: 'normal', incognito: true }, { id: 4, type: 'popup', incognito: false });
    start();
    await settle();
    await closeWindowTwo({ windowId: 3 });
    await closeWindowTwo({ windowId: 4 });
    await runTimers(1000);
    assert.deepEqual(created, []);
});

test('a page still open in the window that stays is not opened twice', async () => {
    tabs.push({ id: 11, windowId: 1, url: 'https://a.test/one', status: 'complete', title: 'One' });
    start();
    await settle();
    await closeWindowTwo();
    await runTimers(1000);
    assert.deepEqual(
        created.map(tab => tab.url),
        ['https://a.test/two']
    );
});

test('the tabs reopen in the window focused most recently', async () => {
    windows.push({ id: 3, type: 'normal', incognito: false, focused: false });
    start();
    await settle();
    await chromeApi.windows.onFocusChanged.fire(3);
    await closeWindowTwo();
    await runTimers(1000);
    assert.deepEqual(new Set(created.map(tab => tab.windowId)), new Set([3]));
});

test('the tabs of a window are reopened once', async () => {
    start();
    await settle();
    await closeWindowTwo();
    await runTimers(1000);
    await runTimers(1000);
    assert.equal(created.length, 2);
});

test('a window opened after the worker started is known when it closes', async () => {
    start();
    await settle();
    const win = { id: 5, type: 'normal', incognito: false, focused: false };
    windows.push(win);
    await chromeApi.windows.onCreated.fire(win);
    await closeWindowTwo({ windowId: 5 });
    await runTimers(1000);
    assert.equal(created.length, 2);
});

test('a worker woken by a window closing still knows that window from the session', async () => {
    start();
    await settle();
    // The worker stops and starts again; window 2 is already gone when it does.
    windows = windows.filter(win => win.id !== 2);
    chromeApi.windows.onCreated = event();
    chromeApi.windows.onRemoved = event();
    chromeApi.windows.onFocusChanged = event();
    start();
    await settle();
    await closeWindowTwo();
    await runTimers(1000);
    assert.equal(created.length, 2);
});
