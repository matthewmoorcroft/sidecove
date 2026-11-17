import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerClosedLinks } from '../../../src/background/closed-links.js';

let local, session, tabs, archived, removedFromArchive, dispatched, ids, clock, createdTabs;
let chromeApi, spaceStore, closedLinks, listeners;

const area = data => ({
    async get(key) {
        return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(values) {
        Object.assign(data, structuredClone(values));
    }
});
const event = () => {
    const fns = [];
    return { addListener: fn => fns.push(fn), emit: (...args) => Promise.all(fns.map(fn => fn(...args))) };
};
const tab = (id, windowId, url, extra = {}) => ({ id, windowId, url, title: `T${id}`, ...extra });
const record = (tabId, spaceId, order, section = 'temporaryTabs') => ({ tabId, spaceId, section, order });

const start = async () => {
    spaceStore = { dispatch: async message => dispatched.push(message), onTabRemoved: null };
    closedLinks = registerClosedLinks({
        chromeApi,
        spaceStore,
        addArchivedTab: async entry => {
            archived.push(entry);
            return true;
        },
        removeArchivedTab: async (url, spaceId) => removedFromArchive.push({ url, spaceId }),
        now: () => clock,
        newId: () => `link${++ids}`,
        schedule: fn => fn()
    });
    // Let the worker load what is stored.
    await spaceStore.onTabRemoved({ tabId: -1, info: {}, record: null });
};

// A window closes: Chrome reports each of its tabs, in order, and the space store tells us.
const closeWindow = async (windowId, records) => {
    const closing = tabs.filter(t => t.windowId === windowId);
    tabs = tabs.filter(t => t.windowId !== windowId);
    for (const t of closing)
        await spaceStore.onTabRemoved({
            tabId: t.id,
            info: { windowId, isWindowClosing: true },
            record: records[t.id] ?? null
        });
};
const stored = () => local.closedLinks || [];
const message = (action, extra = {}) =>
    new Promise(resolve => {
        const handled = listeners.onMessage.fns.some(
            fn => fn({ type: 'closedLinks', action, ...extra }, {}, resolve) === true
        );
        if (!handled) resolve('unhandled');
    });

beforeEach(() => {
    local = {};
    session = {};
    tabs = [];
    archived = [];
    removedFromArchive = [];
    dispatched = [];
    createdTabs = [];
    ids = 0;
    clock = 1_000_000;
    const onMessage = { fns: [], addListener: fn => onMessage.fns.push(fn) };
    listeners = { onMessage, onCreated: event(), onUpdated: event(), onChanged: event() };
    chromeApi = {
        tabs: {
            query: async () => structuredClone(tabs),
            get: async id => tabs.find(t => t.id === id),
            create: async details => {
                const created = { id: 900 + createdTabs.length, ...details };
                createdTabs.push(details);
                return created;
            },
            onCreated: listeners.onCreated,
            onUpdated: listeners.onUpdated,
            onReplaced: event()
        },
        storage: { local: area(local), session: area(session), onChanged: listeners.onChanged },
        runtime: { onMessage }
    };
});

test('closing a window leaves a link for each ordinary tab, in the space it was in', async () => {
    tabs = [tab(1, 1, 'https://a.test/main'), tab(2, 2, 'https://a.test/one'), tab(3, 2, 'https://a.test/two')];
    await start();
    await closeWindow(2, { 2: record(2, 's1', 5), 3: record(3, 's2', 6) });
    assert.deepEqual(
        stored().map(l => [l.url, l.title, l.spaceId, l.order]),
        [
            ['https://a.test/one', 'T2', 's1', 5],
            ['https://a.test/two', 'T3', 's2', 6]
        ]
    );
    assert.equal(new Set(stored().map(l => l.batchAt)).size, 1);
});

test('a page still open in a window that stays leaves no link, and a page only the closed window had does', async () => {
    tabs = [tab(1, 1, 'https://a.test/shared'), tab(2, 2, 'https://a.test/shared'), tab(3, 2, 'https://a.test/only')];
    await start();
    await closeWindow(2, { 2: record(2, 's1', 1), 3: record(3, 's1', 2) });
    assert.deepEqual(
        stored().map(l => l.url),
        ['https://a.test/only']
    );
});

test('pins, favourites, private tabs, New Tab and chrome pages leave no link', async () => {
    tabs = [
        tab(2, 2, 'https://a.test/pin'),
        tab(3, 2, 'https://a.test/fav'),
        tab(4, 2, 'https://a.test/private', { incognito: true }),
        tab(5, 2, 'chrome://newtab/'),
        tab(6, 2, 'chrome://settings/')
    ];
    await start();
    await closeWindow(2, {
        2: record(2, 's1', 0, 'pinnedTabs'),
        3: record(3, 's1', 1, 'spaceBookmarks'),
        4: record(4, 's1', 2),
        5: record(5, 's1', 3),
        6: record(6, 's1', 4)
    });
    assert.deepEqual(stored(), []);
});

test('a single tab closed on its own leaves no link', async () => {
    tabs = [tab(2, 2, 'https://a.test/one')];
    await start();
    await spaceStore.onTabRemoved({ tabId: 2, info: { windowId: 2, isWindowClosing: false }, record: null });
    assert.deepEqual(stored(), []);
});

test('a tab that closes after the worker slept is still named, from the saved names', async () => {
    session.closedLinkTabInfo = [[2, { url: 'https://a.test/one', title: 'Named', incognito: false }]];
    tabs = [tab(2, 2, 'https://a.test/one')];
    await start();
    await closeWindow(2, { 2: record(2, 's1', 0) });
    assert.deepEqual(
        stored().map(l => l.title),
        ['T2']
    );
});

test('a page that opens in any window uses up its link, so closing it later brings no old link back', async () => {
    local.closedLinks = [
        {
            id: 'l',
            url: 'https://a.test/one',
            title: 'One',
            spaceId: 's1',
            closedAt: 1,
            batchAt: 1,
            windowId: 2,
            order: 0
        }
    ];
    await start();
    await listeners.onCreated.emit(tab(10, 1, 'https://a.test/one'));
    assert.deepEqual(stored(), []);
});

test('a page already open when the worker wakes has used up its link', async () => {
    local.closedLinks = [
        {
            id: 'l',
            url: 'https://a.test/one',
            title: 'One',
            spaceId: 's1',
            closedAt: 1,
            batchAt: 1,
            windowId: 2,
            order: 0
        }
    ];
    tabs = [tab(10, 1, 'https://a.test/one')];
    await start();
    assert.deepEqual(stored(), []);
});

test('a deleted space takes its links', async () => {
    local.closedLinks = [
        { id: 'a', url: 'https://a.test/a', title: 'A', spaceId: 's1', closedAt: 1, batchAt: 1, windowId: 2, order: 0 },
        {
            id: 'b',
            url: 'https://a.test/b',
            title: 'B',
            spaceId: 'gone',
            closedAt: 1,
            batchAt: 1,
            windowId: 2,
            order: 1
        }
    ];
    await start();
    await listeners.onChanged.emit({ spaces: { newValue: [{ id: 's1' }] } }, 'local');
    await spaceStore.onTabRemoved({ tabId: -1, info: {}, record: null });
    assert.deepEqual(
        stored().map(l => l.id),
        ['a']
    );
});

test('past 100 links the oldest go to Archived', async () => {
    tabs = Array.from({ length: 101 }, (_, i) => tab(100 + i, 2, `https://a.test/${i}`));
    await start();
    await closeWindow(2, Object.fromEntries(tabs.map((t, i) => [t.id, record(t.id, 's1', i)])));
    assert.equal(stored().length, 100);
    assert.deepEqual(
        archived.map(e => e.url),
        ['https://a.test/0']
    );
});

test('picking a link opens its page in the window, in its space, and uses the link up', async () => {
    local.closedLinks = [
        {
            id: 'l',
            url: 'https://a.test/one',
            title: 'One',
            spaceId: 's1',
            closedAt: 1,
            batchAt: 1,
            windowId: 2,
            order: 0
        }
    ];
    await start();
    const reply = await message('open', { linkId: 'l', windowId: 7 });
    assert.equal(reply.success, true);
    assert.deepEqual(createdTabs, [{ windowId: 7, url: 'https://a.test/one', active: true }]);
    assert.deepEqual(dispatched, [{ action: 'assign', tabId: 900, spaceId: 's1' }]);
    assert.deepEqual(stored(), []);
});

test('if the page cannot open, the link stays and the panel is told', async () => {
    local.closedLinks = [
        {
            id: 'l',
            url: 'https://a.test/one',
            title: 'One',
            spaceId: 's1',
            closedAt: 1,
            batchAt: 1,
            windowId: 2,
            order: 0
        }
    ];
    await start();
    chromeApi.tabs.create = async () => {
        throw new Error('no window');
    };
    const reply = await message('open', { linkId: 'l', windowId: 7 });
    assert.equal(reply.success, false);
    assert.deepEqual(
        stored().map(l => l.id),
        ['l']
    );
});

test('Clear puts the space links in Archived, Undo takes them back, and Undo does not touch what was archived before', async () => {
    local.closedLinks = [
        { id: 'a', url: 'https://a.test/a', title: 'A', spaceId: 's1', closedAt: 1, batchAt: 1, windowId: 2, order: 0 },
        { id: 'b', url: 'https://a.test/b', title: 'B', spaceId: 's2', closedAt: 1, batchAt: 1, windowId: 2, order: 1 }
    ];
    await start();
    const cleared = await message('clear', { spaceId: 's1' });
    assert.deepEqual(
        archived.map(e => e.url),
        ['https://a.test/a']
    );
    assert.deepEqual(
        stored().map(l => l.id),
        ['b']
    );
    await message('restore', { cleared: cleared.cleared });
    assert.deepEqual(
        stored()
            .map(l => l.id)
            .sort(),
        ['a', 'b']
    );
    assert.deepEqual(removedFromArchive, [{ url: 'https://a.test/a', spaceId: 's1' }]);
});

test('Clear leaves a link whose page is open, and Undo of a link that was not newly archived leaves Archived alone', async () => {
    local.closedLinks = [
        { id: 'a', url: 'https://a.test/a', title: 'A', spaceId: 's1', closedAt: 1, batchAt: 1, windowId: 2, order: 0 }
    ];
    tabs = [tab(1, 1, 'https://a.test/a')];
    await start();
    // The page is open, so start() already used its link up; nothing is left to clear.
    assert.deepEqual((await message('clear', { spaceId: 's1' })).cleared, []);
    await message('restore', {
        cleared: [
            {
                link: {
                    ...local.closedLinks?.[0],
                    id: 'q',
                    url: 'https://a.test/q',
                    spaceId: 's1',
                    closedAt: 1,
                    batchAt: 1,
                    order: 0
                },
                addedToArchive: false
            }
        ]
    });
    assert.deepEqual(removedFromArchive, []);
});

test('the close button removes one link', async () => {
    local.closedLinks = [
        { id: 'a', url: 'https://a.test/a', title: 'A', spaceId: 's1', closedAt: 1, batchAt: 1, windowId: 2, order: 0 },
        { id: 'b', url: 'https://a.test/b', title: 'B', spaceId: 's1', closedAt: 1, batchAt: 1, windowId: 2, order: 1 }
    ];
    await start();
    await message('remove', { linkId: 'a' });
    assert.deepEqual(
        stored().map(l => l.id),
        ['b']
    );
});

test('auto-archive moves links older than the idle time to Archived', async () => {
    local.closedLinks = [
        {
            id: 'old',
            url: 'https://a.test/old',
            title: 'Old',
            spaceId: 's1',
            closedAt: 1000,
            batchAt: 1000,
            windowId: 2,
            order: 0
        },
        {
            id: 'new',
            url: 'https://a.test/new',
            title: 'New',
            spaceId: 's1',
            closedAt: clock - 10,
            batchAt: clock - 10,
            windowId: 2,
            order: 1
        }
    ];
    await start();
    await closedLinks.archiveIdle(60_000);
    assert.deepEqual(
        archived.map(e => e.url),
        ['https://a.test/old']
    );
    assert.deepEqual(
        stored().map(l => l.id),
        ['new']
    );
});

test('messages for other parts are not handled, so their answers are not cut off', async () => {
    await start();
    const listener = listeners.onMessage.fns[0];
    assert.equal(
        listener({ type: 'spaceStore', action: 'get' }, {}, () => {}),
        undefined
    );
    assert.equal(
        listener({ type: 'closedLinks', action: 'nonsense' }, {}, () => {}),
        undefined
    );
});

test('a worker woken by a window closing still names its tabs, though they are already gone', async () => {
    session.closedLinkTabInfo = [[2, { url: 'https://a.test/one', title: 'Saved name', incognito: false }]];
    tabs = [];
    await start();
    await spaceStore.onTabRemoved({
        tabId: 2,
        info: { windowId: 2, isWindowClosing: true },
        record: record(2, 's1', 0)
    });
    assert.deepEqual(
        stored().map(l => [l.url, l.title]),
        [['https://a.test/one', 'Saved name']]
    );
});

test('a page that opens but cannot be filed in its space keeps its link used up', async () => {
    local.closedLinks = [
        {
            id: 'l',
            url: 'https://a.test/one',
            title: 'One',
            spaceId: 's1',
            closedAt: 1,
            batchAt: 1,
            windowId: 2,
            order: 0
        }
    ];
    await start();
    spaceStore.dispatch = async () => {
        throw new Error('space is gone');
    };
    assert.equal((await message('open', { linkId: 'l', windowId: 7 })).success, true);
    assert.deepEqual(stored(), []);
});

test('Undo past the cap sends the oldest links to Archived instead of dropping them', async () => {
    local.closedLinks = Array.from({ length: 100 }, (_, i) => ({
        id: `m${i}`,
        url: `https://a.test/${i}`,
        title: 'M',
        spaceId: 's1',
        closedAt: 5000 + i,
        batchAt: 5000 + i,
        windowId: 2,
        order: 0
    }));
    await start();
    const back = {
        id: 'back',
        url: 'https://a.test/back',
        title: 'B',
        spaceId: 's1',
        closedAt: 1,
        batchAt: 1,
        windowId: 2,
        order: 0
    };
    await message('restore', { cleared: [{ link: back, addedToArchive: false }] });
    assert.equal(stored().length, 100);
    assert.deepEqual(
        archived.map(e => e.url),
        ['https://a.test/back']
    );
});

test('an action name that is not one of ours is not handled', async () => {
    await start();
    assert.equal(
        listeners.onMessage.fns[0]({ type: 'closedLinks', action: 'toString' }, {}, () => {}),
        undefined
    );
});
