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

let chromeApi, store, windows, tabs, local, session, created, discarded, removed, timers, nextId, clock;

const record = (tabId, url, over = {}) => ({ tabId, spaceId: 's1', section: 'temporaryTabs', order: 0, url, ...over });
const win = (id, over = {}) => ({ id, type: 'normal', incognito: false, alwaysOnTop: false, focused: false, ...over });
const page = (id, windowId, url, over = {}) => ({ id, windowId, url, status: 'complete', title: url, ...over });
const ids = list => list.map(tab => tab.id);

beforeEach(() => {
    windows = [win(1, { focused: true }), win(2)];
    // Window 1 has tab 10; window 2 has two pages, listed after it in space s1.
    tabs = [page(10, 1, 'https://mine.test/'), page(20, 2, 'https://a.test/one'), page(21, 2, 'https://a.test/two')];
    local = { closedLinks: [{ url: 'https://old.test/' }], spaces: [] };
    session = { closedLinkTabInfo: [[1, {}]] };
    created = [];
    discarded = [];
    removed = [];
    timers = [];
    nextId = 100;
    clock = 1000;
    const area = data => ({
        get: async keys =>
            Object.fromEntries(
                [keys]
                    .flat()
                    .filter(key => key in data)
                    .map(key => [key, structuredClone(data[key])])
            ),
        set: async values => Object.assign(data, structuredClone(values)),
        remove: async key => delete data[key]
    });
    chromeApi = {
        storage: { local: area(local), session: area(session) },
        windows: {
            getAll: async ({ windowTypes } = {}) => windows.filter(w => !windowTypes || windowTypes.includes(w.type)),
            get: async id => {
                const found = windows.find(w => w.id === id);
                if (!found) throw new Error('No window');
                return found;
            },
            onCreated: event(),
            onRemoved: event(),
            onFocusChanged: event()
        },
        tabs: {
            query: async ({ windowId } = {}) => tabs.filter(tab => windowId === undefined || tab.windowId === windowId),
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
            remove: async id => {
                removed.push(id);
                tabs = tabs.filter(t => t.id !== id);
            },
            discard: async id => {
                discarded.push(id);
                tabs.find(t => t.id === id).discarded = true;
            },
            onCreated: event(),
            onUpdated: event(),
            onActivated: event(),
            onAttached: event()
        }
    };
    store = {
        spaces: [{ id: 's1', spaceBookmarks: [], pinnedTabs: [], temporaryTabs: [10, 20, 21] }],
        restoreQueue: [],
        persisted: 0,
        run: operation => operation(),
        // As the space store does: each save reports the open tabs.
        persist: async () => {
            store.persisted++;
            await store.onPersisted?.(tabs);
        }
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
const startAndNote = async () => {
    start();
    await settle();
    await store.persist();
    store.persisted = 0;
};

// Chrome closes window 2: its tabs go, each is reported closed with its window, then the window.
async function closeWindow(windowId = 2, { isWindowClosing = true } = {}) {
    const closing = tabs.filter(tab => tab.windowId === windowId);
    tabs = tabs.filter(tab => tab.windowId !== windowId);
    windows = windows.filter(w => w.id !== windowId);
    for (const space of store.spaces)
        space.temporaryTabs = space.temporaryTabs.filter(id => !ids(closing).includes(id));
    if (isWindowClosing) store.restoreQueue.push(...closing.map(tab => record(tab.id, tab.url)));
    for (const tab of closing) await store.onTabRemoved(tab.id, { windowId, isWindowClosing });
    await chromeApi.windows.onRemoved.fire(windowId);
    await settle();
}

test('the old closed links are removed when the worker starts', async () => {
    start();
    await settle();
    assert.equal('closedLinks' in local, false);
    assert.equal('closedLinkTabInfo' in session, false);
});

test('the pages of a closed window open again in the window that stays, unloaded, in the same space and order', async () => {
    await startAndNote();
    await closeWindow();
    // At once, with no wait.
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

// The captain's report: the closed window showed Work, the window left showed Home. The spaces were
// saved after the tabs had gone and before their removal was reported, so the lists no longer had
// them; the pages came back in Home and Work looked empty.
test("pages go back to the closed window's space even when the lists lost them before the close was reported", async () => {
    store.spaces = [
        { id: 'home', spaceBookmarks: [], pinnedTabs: [], temporaryTabs: [10] },
        { id: 'work', spaceBookmarks: [], pinnedTabs: [], temporaryTabs: [30, 20, 21] }
    ];
    tabs.push(page(30, 1, 'https://work.test/stays'));
    await startAndNote();
    tabs = tabs.filter(tab => tab.windowId !== 2);
    store.spaces[1].temporaryTabs = [30];
    // A save in between, as any other tab event causes.
    await store.persist();
    await closeWindow();
    assert.deepEqual(store.spaces[0].temporaryTabs, [10]);
    assert.deepEqual(store.spaces[1].temporaryTabs, [30, 100, 101]);
});

test('a worker that Chrome stopped and woke for the close still reopens the pages in their place', async () => {
    await startAndNote();
    // The worker stops; everything it held in memory is gone. Chrome then closes window 2 and
    // wakes a new worker, which finds the window and its tabs already gone.
    for (const name of ['onCreated', 'onRemoved', 'onFocusChanged']) chromeApi.windows[name] = event();
    for (const name of ['onCreated', 'onUpdated', 'onActivated', 'onAttached']) chromeApi.tabs[name] = event();
    store.onPersisted = store.onTabRemoved = null;
    const closing = tabs.filter(tab => tab.windowId === 2);
    tabs = tabs.filter(tab => tab.windowId !== 2);
    windows = windows.filter(w => w.id !== 2);
    store.spaces[0].temporaryTabs = [10];
    start();
    await settle();
    // The new worker's first save sees no tab of window 2.
    await store.persist();
    for (const tab of closing) await store.onTabRemoved(tab.id, { windowId: 2, isWindowClosing: true });
    await chromeApi.windows.onRemoved.fire(2);
    await settle();
    assert.deepEqual(
        created.map(tab => tab.url),
        ['https://a.test/one', 'https://a.test/two']
    );
    assert.deepEqual(store.spaces[0].temporaryTabs, [10, 100, 101]);
});

// Closing a tab closes its page everywhere, also a window's only tab (its close button or Cmd+W),
// which Chrome reports as a tab closing (isWindowClosing false) and then the window going. Only
// closing the window itself keeps its pages.
test("closing a window's only tab closes the page; nothing comes back", async () => {
    tabs = tabs.filter(tab => tab.id !== 21);
    store.spaces[0].temporaryTabs = [10, 20];
    await startAndNote();
    await closeWindow(2, { isWindowClosing: false });
    assert.deepEqual(created, []);
});

test("closing a window with one tab, with the window's close button, moves the page", async () => {
    tabs = tabs.filter(tab => tab.id !== 21);
    store.spaces[0].temporaryTabs = [10, 20];
    await startAndNote();
    await closeWindow(2);
    assert.deepEqual(created, [{ windowId: 1, url: 'https://a.test/one', active: false }]);
    assert.deepEqual(store.spaces[0].temporaryTabs, [10, 100]);
});

test('a tab closed while its window stays open is not reopened when the window closes later', async () => {
    await startAndNote();
    tabs = tabs.filter(tab => tab.id !== 20);
    store.spaces[0].temporaryTabs = [10, 21];
    await store.onTabRemoved(20, { windowId: 2, isWindowClosing: false });
    await store.persist();
    await closeWindow(2);
    assert.deepEqual(
        created.map(tab => tab.url),
        ['https://a.test/two']
    );
});

test('moving the tabs of a window into another reopens nothing', async () => {
    await startAndNote();
    for (const tab of tabs) tab.windowId = 1;
    windows = windows.filter(w => w.id !== 2);
    await chromeApi.windows.onRemoved.fire(2);
    await settle();
    assert.deepEqual(created, []);
});

test('closing the last window, or quitting Chrome, reopens nothing', async () => {
    await startAndNote();
    windows = windows.filter(w => w.id !== 1);
    await closeWindow();
    assert.deepEqual(created, []);
    // The tabs stay queued for Chrome's own restore.
    assert.equal(store.restoreQueue.length, 2);
});

test('a private window, a popup or a picture-in-picture window leaves nothing behind', async () => {
    windows.push(win(3, { incognito: true }), win(4, { type: 'popup' }), win(5, { alwaysOnTop: true }));
    tabs.push(page(30, 3, 'https://p.test/'), page(40, 4, 'https://q.test/'), page(50, 5, 'https://meet.test/'));
    store.spaces[0].temporaryTabs.push(30, 40, 50);
    await startAndNote();
    for (const id of [3, 4, 5]) await closeWindow(id);
    assert.deepEqual(created, []);
});

test('tabs never reopen in a picture-in-picture window, even the one focused last', async () => {
    windows.push(win(3, { alwaysOnTop: true }));
    await startAndNote();
    await chromeApi.windows.onFocusChanged.fire(3);
    await closeWindow();
    assert.deepEqual(new Set(created.map(tab => tab.windowId)), new Set([1]));
});

test('a page still open in the same space in the window that stays is not opened twice', async () => {
    tabs.push(page(11, 1, 'https://a.test/one'), page(12, 1, 'https://a.test/two'));
    store.spaces[0].temporaryTabs.push(11);
    // 12 shows the other page, but as a favorite: the space would lose it.
    store.spaces[0].spaceBookmarks.push(12);
    await startAndNote();
    await closeWindow();
    assert.deepEqual(
        created.map(tab => tab.url),
        ['https://a.test/two']
    );
});

test('the tabs reopen in the window focused most recently', async () => {
    windows.push(win(3));
    await startAndNote();
    await chromeApi.windows.onFocusChanged.fire(3);
    await closeWindow();
    assert.deepEqual(new Set(created.map(tab => tab.windowId)), new Set([3]));
});

test('the tabs of a window are reopened once', async () => {
    await startAndNote();
    await closeWindow();
    await chromeApi.windows.onRemoved.fire(2);
    await settle();
    assert.equal(created.length, 2);
});

test('a window opened after the worker started is known when it closes', async () => {
    await startAndNote();
    windows.push(win(5));
    await chromeApi.windows.onCreated.fire(win(5));
    tabs.push(page(50, 5, 'https://c.test/'));
    store.spaces[0].temporaryTabs.push(50);
    await store.persist();
    await closeWindow(5);
    assert.deepEqual(
        created.map(tab => tab.url),
        ['https://c.test/']
    );
});

test('reopening the closed window afterwards keeps one tab of each page, in its place', async () => {
    await startAndNote();
    await closeWindow();
    assert.deepEqual(store.spaces[0].temporaryTabs, [10, 100, 101]);
    // Cmd+Shift+T: Chrome brings the window back, as window 7, with its own tabs.
    windows.push(win(7));
    for (const [id, url] of [
        [300, 'https://a.test/one'],
        [301, 'https://a.test/two']
    ]) {
        const tab = page(id, 7, url, { status: 'loading' });
        tabs.push(tab);
        // The space store has filed it under the window's space first.
        store.spaces[0].temporaryTabs.push(id);
        await chromeApi.tabs.onCreated.fire(tab);
    }
    await settle();
    // The restored tabs stay, in the copies' places; the copies close.
    assert.deepEqual(removed, [100, 101]);
    assert.deepEqual(store.spaces[0].temporaryTabs, [10, 300, 301]);
    assert.deepEqual(
        tabs.map(tab => tab.url).filter(url => url.startsWith('https://a.test/')),
        ['https://a.test/one', 'https://a.test/two']
    );
});

test('a copy you have gone to, or closed, is left alone when the window comes back', async () => {
    await startAndNote();
    await closeWindow();
    // You go to the first copy, perhaps start filling in a form there, and close the second.
    await chromeApi.tabs.onActivated.fire({ tabId: 100, windowId: 1 });
    tabs = tabs.filter(t => t.id !== 101);
    await store.onTabRemoved(101, { windowId: 1, isWindowClosing: false });
    windows.push(win(7));
    for (const [id, url] of [
        [300, 'https://a.test/one'],
        [301, 'https://a.test/two']
    ])
        await chromeApi.tabs.onCreated.fire(page(id, 7, url));
    await settle();
    assert.deepEqual(removed, []);
});

test('a copy whose page redirected as it loaded is still replaced by the original', async () => {
    await startAndNote();
    await closeWindow();
    const copy = tabs.find(t => t.id === 100);
    copy.url = 'https://a.test/login?next=one';
    await chromeApi.tabs.onUpdated.fire(100, { url: copy.url }, copy);
    windows.push(win(7));
    const restored = page(300, 7, 'https://a.test/one', { status: 'loading' });
    tabs.push(restored);
    store.spaces[0].temporaryTabs.push(300);
    await chromeApi.tabs.onCreated.fire(restored);
    await settle();
    assert.deepEqual(removed, [100]);
    assert.deepEqual(store.spaces[0].temporaryTabs, [10, 300, 101]);
});

test("a private tab with a copy's page does not replace the copy", async () => {
    await startAndNote();
    await closeWindow();
    windows.push(win(8, { incognito: true }));
    await chromeApi.tabs.onCreated.fire(page(400, 8, 'https://a.test/one', { incognito: true }));
    await settle();
    assert.deepEqual(removed, []);
});

test('a reopened tab you have gone to is not unloaded', async () => {
    await startAndNote();
    await closeWindow();
    tabs.find(t => t.id === 100).active = true;
    await chromeApi.tabs.onUpdated.fire(
        100,
        { status: 'complete' },
        tabs.find(t => t.id === 100)
    );
    await settle();
    assert.deepEqual(discarded, []);
});
