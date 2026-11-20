import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createLinkDropPosition,
    openDroppedLink
} from '../../../../../src/sidebar/features/external-drop/link-drop-position.js';

function position({ overList = true, row = { dataset: { tabId: '4' } } } = {}) {
    const calls = [];
    const list = { id: 'list' };
    const adapter = createLinkDropPosition({
        listUnder: () => (overList ? list : null),
        rowBefore: () => row,
        showLine: (l, r) => calls.push(['show', l, r]),
        hideLine: () => calls.push(['hide']),
        open: (url, beforeId) => calls.push(['open', url, beforeId])
    });
    return { adapter, calls, list, row };
}

test('over the list the drop line shows where the link would open', () => {
    const { adapter, calls, list, row } = position();
    adapter.over({});
    assert.deepEqual(calls, [['show', list, row]]);
    assert.deepEqual(adapter.placeAt({}), { beforeId: 4 });
});

test('below the last row the link goes at the end', () => {
    const { adapter } = position({ row: null });
    assert.deepEqual(adapter.placeAt({}), { beforeId: null });
});

test('away from the list there is no line and no place, so the drop opens as before', () => {
    const { adapter, calls } = position({ overList: false });
    adapter.over({});
    assert.deepEqual(calls, [['hide']]);
    assert.equal(adapter.placeAt({}), null);
});

test('opening at a place passes the row the line was above', () => {
    const { adapter, calls } = position();
    adapter.open('https://example.com/', { beforeId: 4 });
    assert.deepEqual(calls, [['open', 'https://example.com/', 4]]);
});

function fakeChrome(windowTabs) {
    const created = [];
    return {
        created,
        tabs: {
            query: async ({ windowId }) => windowTabs.filter(tab => tab.windowId === windowId),
            create: async props => {
                created.push(props);
                return { id: 99, windowId: props.windowId, index: props.index };
            }
        }
    };
}

test('a dropped link opens next to the same tabs in Chrome and is filed at the drop point', async () => {
    const chromeApi = fakeChrome([
        { id: 1, index: 0, windowId: 3 },
        { id: 2, index: 1, windowId: 3 },
        { id: 4, index: 2, windowId: 3 }
    ]);
    let stored = [1, 2, 4];
    const saved = [];
    await openDroppedLink({
        chromeApi,
        url: 'https://example.com/',
        beforeId: 4,
        windowId: 3,
        inverted: false,
        storedTabs: () => stored,
        // The worker files a new tab last; the drop then moves it.
        adopt: async tab => (stored = [...stored, tab.id]),
        saveOrder: async ids => saved.push(ids)
    });
    assert.deepEqual(chromeApi.created, [{ url: 'https://example.com/', active: true, windowId: 3, index: 2 }]);
    assert.deepEqual(saved, [[1, 2, 99, 4]]);
});

test('in a list drawn newest first, the link sits between the same rows on screen and in Chrome', async () => {
    const chromeApi = fakeChrome([
        { id: 1, index: 0, windowId: 3 },
        { id: 2, index: 1, windowId: 3 }
    ]);
    let stored = [1, 2];
    const saved = [];
    // Shown as 2, 1; dropped above 1.
    await openDroppedLink({
        chromeApi,
        url: 'https://example.com/',
        beforeId: 1,
        windowId: 3,
        inverted: true,
        storedTabs: () => stored,
        adopt: async tab => (stored = [tab.id, ...stored]),
        saveOrder: async ids => saved.push(ids)
    });
    assert.equal(chromeApi.created[0].index, 1);
    assert.deepEqual(saved, [[1, 99, 2]]);
});

test('with no neighbour in this window, Chrome chooses the index', async () => {
    const chromeApi = fakeChrome([]);
    await openDroppedLink({
        chromeApi,
        url: 'https://example.com/',
        beforeId: null,
        windowId: 3,
        inverted: false,
        storedTabs: () => [],
        adopt: async () => {},
        saveOrder: async () => {}
    });
    assert.equal('index' in chromeApi.created[0], false);
});
