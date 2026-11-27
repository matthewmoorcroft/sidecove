import test from 'node:test';
import assert from 'node:assert/strict';
import {
    archiveTabs,
    clearableTabs,
    closableTabs,
    clearTabs,
    stepOffClearedTabs,
    undoClear,
    reopenClosedTabs
} from '../../../../../src/sidebar/features/clean-all/clean-all.js';

function fakes({ activeTabId = 99, openIds = [1, 2, 3, 98, 99], displayOrder = [98, 1, 2, 3] } = {}) {
    const calls = [];
    const archive = new Set(['https://already.example/']);
    let nextId = 100;
    return {
        calls,
        archive,
        api: {
            addArchivedTab: async entry => {
                calls.push(['archive', entry.url, entry.name, entry.spaceId]);
                if (unarchivable.has(entry.url)) return { stored: false, archived: false };
                if (archive.has(entry.url)) return { stored: false, archived: true };
                archive.add(entry.url);
                return { stored: true, archived: true };
            },
            activeTabId,
            displayOrder,
            openTabIds: async () => openIds,
            activateTab: async id => calls.push(['activate', id]),
            openNewTab: async () => calls.push(['new tab']),
            startPendingClean: async payload => {
                calls.push(['hide', payload]);
                if (startError) throw startError;
                return { batchId: 'batch-1', closeAt: 8500, spaces: [] };
            },
            undoPendingClean: async batchId => {
                calls.push(['undo', batchId]);
                return { restored: [...restored], spaces: [] };
            },
            createTab: async props => {
                calls.push(['create', props]);
                return { id: nextId++ };
            },
            assignTab: async (tabId, spaceId) => calls.push(['assign', tabId, spaceId]),
            removeArchivedTab: async (url, spaceId) => {
                calls.push(['unarchive', url, spaceId]);
                archive.delete(url);
            }
        }
    };
}
let restored = [];
let startError = null;
let unarchivable = new Set();

const tabs = [
    { id: 1, url: 'https://a.example/', title: 'A' },
    { id: 2, url: 'file:///Users/me/list.html', title: '' },
    { id: 3, url: 'https://c.example/', title: 'C' }
];

test('Clean All archives every tab, then hides them together without closing any', async () => {
    const { calls, api } = fakes();
    const result = await clearTabs(tabs, 'home', [98, 1, 2, 3], api);
    assert.deepEqual(calls, [
        ['archive', 'https://a.example/', 'A', 'home'],
        ['archive', 'file:///Users/me/list.html', 'file:///Users/me/list.html', 'home'],
        ['archive', 'https://c.example/', 'C', 'home'],
        ['hide', { spaceId: 'home', tabIds: [1, 2, 3], order: [98, 1, 2, 3] }]
    ]);
    assert.equal(result.batchId, 'batch-1');
    assert.equal(result.closeAt, 8500);
    assert.deepEqual(
        result.records.map(r => [r.tabId, r.addedToArchive]),
        [
            [1, true],
            [2, true],
            [3, true]
        ]
    );
});

test('when the tabs cannot be hidden, the archive entries Clean All added are taken back', async () => {
    const { calls, api } = fakes();
    startError = new Error('worker unavailable');
    try {
        await assert.rejects(clearTabs(tabs, 'home', [1, 2, 3], api), /worker unavailable/);
    } finally {
        startError = null;
    }
    assert.deepEqual(
        calls.filter(call => call[0] === 'unarchive').map(call => call[1]),
        tabs.map(tab => tab.url)
    );
});

test('Clean All with nothing to clear does nothing', async () => {
    const { calls, api } = fakes();
    assert.equal(await clearTabs([], 'home', [], api), null);
    assert.deepEqual(calls, []);
});

test('an entry archived before Clean All is not claimed by it', async () => {
    const { api } = fakes();
    const records = await archiveTabs([{ id: 5, url: 'https://already.example/', title: 'Old' }], 'home', api);
    assert.deepEqual(
        records.map(r => r.addedToArchive),
        [false]
    );
});

test('a tab Archived cannot keep is left open and listed, and the rest are cleared', async () => {
    const { calls, api } = fakes();
    unarchivable = new Set(['https://c.example/']);
    try {
        const result = await clearTabs(tabs, 'home', [98, 1, 2, 3], api);
        assert.deepEqual(calls.at(-1), ['hide', { spaceId: 'home', tabIds: [1, 2], order: [98, 1, 2, 3] }]);
        assert.deepEqual(
            result.records.map(r => r.tabId),
            [1, 2]
        );
        // Nothing Archived can keep: nothing is hidden at all.
        calls.length = 0;
        assert.equal(await clearTabs([tabs[2]], 'home', [98, 1, 2, 3], api), null);
        assert.deepEqual(
            calls.map(c => c[0]),
            ['archive']
        );
    } finally {
        unarchivable = new Set();
    }
});

test('the tab being shown moves to the next one down the list before its row is hidden', async () => {
    const { calls, api } = fakes({ activeTabId: 2 });
    await clearTabs([tabs[1]], 'home', [98, 1, 2, 3], api);
    assert.deepEqual(
        calls.map(c => c[0]),
        ['archive', 'activate', 'hide']
    );
    assert.deepEqual(calls[1], ['activate', 3]);
});

test('with every other tab cleared too it goes to the one above, or to a New Tab when none is left', async () => {
    const above = fakes({ activeTabId: 3, openIds: [1, 2, 3, 98], displayOrder: [98, 1, 2, 3] });
    await stepOffClearedTabs(new Set([1, 2, 3]), above.api);
    assert.deepEqual(above.calls, [['activate', 98]]);

    const none = fakes({ activeTabId: 3, openIds: [1, 2, 3], displayOrder: [1, 2, 3] });
    await stepOffClearedTabs(new Set([1, 2, 3]), none.api);
    assert.deepEqual(none.calls, [['new tab']]);
});

test('a tab that stays shown is left alone', async () => {
    const { calls, api } = fakes({ activeTabId: 99 });
    await stepOffClearedTabs(new Set([1, 2, 3]), api);
    assert.deepEqual(calls, []);
});

test('Undo shows the hidden tabs again, reopens nothing, and clears only the entries Clean All added', async () => {
    const { calls, api, archive } = fakes();
    const { records } = await clearTabs(
        [...tabs, { id: 4, url: 'https://already.example/', title: '' }],
        'home',
        [],
        api
    );
    calls.length = 0;
    restored = [1, 2, 3, 4];
    await undoClear(records, 'batch-1', 7, false, api);
    assert.deepEqual(calls, [
        ['undo', 'batch-1'],
        ['unarchive', 'https://a.example/', 'home'],
        ['unarchive', 'file:///Users/me/list.html', 'home'],
        ['unarchive', 'https://c.example/', 'home']
    ]);
    // An entry archived before Clean All stays in the archive.
    assert.deepEqual([...archive], ['https://already.example/']);
});

test('Undo reopens a tab that is gone, in order, and leaves its archive entry for the reopen to clear', async () => {
    const { calls, api } = fakes();
    const { records } = await clearTabs(tabs, 'home', [], api);
    calls.length = 0;
    restored = [1];
    await undoClear(records, 'batch-1', 7, false, api);
    assert.deepEqual(calls, [
        ['undo', 'batch-1'],
        ['unarchive', 'https://a.example/', 'home'],
        ['create', { url: 'file:///Users/me/list.html', active: false, windowId: 7 }],
        ['assign', 100, 'home'],
        ['unarchive', 'file:///Users/me/list.html', 'home'],
        ['create', { url: 'https://c.example/', active: false, windowId: 7 }],
        ['assign', 101, 'home'],
        ['unarchive', 'https://c.example/', 'home']
    ]);
});

test('an inverted list reopens missing tabs bottom-up', async () => {
    const { calls, api } = fakes();
    const { records } = await clearTabs(tabs, 'home', [], api);
    calls.length = 0;
    restored = [];
    await undoClear(records, 'batch-1', 7, true, api);
    assert.deepEqual(
        calls.filter(c => c[0] === 'create').map(c => c[1].url),
        ['https://c.example/', 'file:///Users/me/list.html', 'https://a.example/']
    );
});

test('closing selected tabs still reopens them in order in their space', async () => {
    const { calls, api } = fakes();
    const records = [
        { url: 'https://a.example/', spaceId: 'home', addedToArchive: false },
        { url: 'https://c.example/', spaceId: 'home', addedToArchive: false }
    ];
    const reopened = await reopenClosedTabs(records, 7, api);
    assert.deepEqual(reopened, [100, 101]);
    assert.deepEqual(calls, [
        ['create', { url: 'https://a.example/', active: false, windowId: 7 }],
        ['assign', 100, 'home'],
        ['create', { url: 'https://c.example/', active: false, windowId: 7 }],
        ['assign', 101, 'home']
    ]);
});

test('Clear leaves untouched New Tabs out, whatever they are still loading', () => {
    const tabs = [
        { id: 1, url: 'chrome://newtab/' },
        { id: 2, url: '', pendingUrl: 'chrome://new-tab-page/' },
        { id: 3, url: 'https://example.com/' },
        { id: 4, url: 'chrome://newtab/', pendingUrl: 'https://example.com/next' }
    ];
    assert.deepEqual(
        clearableTabs(tabs).map(tab => tab.id),
        [3, 4]
    );
});

test('Clear and Clean All leave Sidecove’s own settings and setup-guide tabs open', () => {
    globalThis.chrome = { runtime: { getURL: path => `chrome-extension://sidecove/${path}` } };
    try {
        const own = [
            { id: 1, url: 'chrome-extension://sidecove/options.html' },
            { id: 2, url: 'chrome-extension://sidecove/installation-onboarding.html' }
        ];
        const page = { id: 3, url: 'https://page.test/' };
        const context = { protectedIds: new Set(), bindings: {}, favoriteUrlKeys: new Set() };
        assert.deepEqual(closableTabs([...own, page], context), [page]);
    } finally {
        delete globalThis.chrome;
    }
});

test('Clear offers nothing when only favorites and untouched New Tabs are left', () => {
    const newTab = { id: 2, url: 'chrome://newtab/' };
    const favorite = { id: 1, url: 'https://fav.test/' };
    const page = { id: 3, url: 'https://page.test/' };
    const context = { protectedIds: new Set([1]), bindings: {}, favoriteUrlKeys: new Set() };
    assert.deepEqual(closableTabs([favorite, newTab], context), []);
    assert.deepEqual(closableTabs([favorite, newTab, page], context), [page]);
    const bound = { id: 4, url: 'https://bound.test/' };
    assert.deepEqual(closableTabs([bound], { ...context, bindings: { 4: { bookmarkId: 'b' } } }), []);
});
