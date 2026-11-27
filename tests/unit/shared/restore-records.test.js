import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    forNewSession,
    forSnapshot,
    noteReopened,
    noteRestarted,
    restoreRecordFor,
    windowCloseRecord
} from '../../../src/shared/restore-records.js';

const record = (url, extra = {}) => ({ tabId: 1, spaceId: 'b', section: 'temporaryTabs', order: 0, url, ...extra });
const context = (url, extra = {}) => ({
    url,
    created: true,
    spaceIds: new Set(['a', 'b']),
    reopened: new Map(),
    ...extra
});
const closed = (url, windowId = 2) => windowCloseRecord(record(url), windowId, [1, windowId]);

test('a snapshot record goes to any tab on its address, as at a browser restart', () => {
    const queue = [record('https://x.test/')];
    assert.equal(restoreRecordFor(queue, { id: 9, windowId: 1, url: '' }, context('https://x.test/')), 0);
    assert.equal(restoreRecordFor(queue, { id: 9, windowId: 1 }, context('https://x.test/', { created: false })), 0);
    assert.equal(restoreRecordFor(queue, { id: 9, windowId: 1, pinned: true }, context('https://x.test/')), -1);
    assert.equal(restoreRecordFor(queue, { id: 9, windowId: 1 }, context('https://y.test/')), -1);
    assert.equal(restoreRecordFor(queue, { id: 9 }, context('https://x.test/', { spaceIds: new Set(['a']) })), -1);
});

test('a window-close record goes only to a tab Chrome brings back with its window', () => {
    const queue = [closed('https://x.test/')];
    const restored = { id: 9, windowId: 5, url: 'https://x.test/' };
    assert.equal(restoreRecordFor(queue, restored, context('https://x.test/')), 0);
    const cases = {
        'a link tab, with only the address it is going to': { ...restored, url: '', pendingUrl: 'https://x.test/' },
        'a tab with an opener': { ...restored, openerTabId: 4 },
        'a tab in a window that was open at the close': { ...restored, windowId: 1 }
    };
    for (const [name, tab] of Object.entries(cases))
        assert.equal(restoreRecordFor(queue, tab, context('https://x.test/')), -1, name);
    assert.equal(restoreRecordFor(queue, restored, context('https://x.test/', { created: false })), -1, 'filed again');
});

test("a reopened window takes only its own closed window's records", () => {
    const queue = [closed('https://x.test/', 2), closed('https://x.test/', 3)];
    const reopened = new Map();
    const first = { id: 9, windowId: 5, url: 'https://x.test/' };
    assert.equal(restoreRecordFor(queue, first, context(first.url, { reopened })), 0);
    noteReopened(reopened, first, queue[0]);
    assert.deepEqual([...reopened], [[5, 2]]);
    // Window 5 is window 2 come back: it takes no record of window 3, and window 6 none of window 2.
    const rest = [queue[1]];
    assert.equal(restoreRecordFor(rest, { ...first, id: 10 }, context(first.url, { reopened })), -1);
    assert.equal(restoreRecordFor([queue[0]], { ...first, id: 11, windowId: 6 }, context(first.url, { reopened })), -1);
    assert.equal(restoreRecordFor(rest, { ...first, id: 12, windowId: 6 }, context(first.url, { reopened })), 0);
});

test('a new browser session turns window-close records into ordinary ones', () => {
    const queue = forNewSession([closed('https://x.test/'), record('https://y.test/')]);
    assert.deepEqual(queue, [record('https://x.test/', { windowId: 2 }), record('https://y.test/')]);
    const link = { id: 9, windowId: 1, url: '', pendingUrl: 'https://x.test/', openerTabId: 4 };
    assert.equal(restoreRecordFor(queue, link, context('https://x.test/')), 0);
});

test('after a restart a tab takes the record of the window it was in, then of its own place', () => {
    const queue = [
        record('https://same.test/', { spaceId: 'a', windowId: 5, index: 1 }),
        record('https://same.test/', { spaceId: 'b', windowId: 6, index: 1 })
    ];
    const tab = { id: 21, windowId: 1, index: 1, url: 'https://same.test/' };
    // Nothing tells them apart yet: the first saved one.
    assert.equal(restoreRecordFor(queue, tab, context(tab.url)), 0);
    // Window 1 has taken a record of window 6, so it is window 6 now.
    const restarted = new Map([[1, 6]]);
    assert.equal(restoreRecordFor(queue, tab, context(tab.url, { restarted })), 1);
    // Window 2 is not window 6, which another window is now.
    assert.equal(restoreRecordFor(queue, { ...tab, windowId: 2 }, context(tab.url, { restarted })), 0);
    // With no window known, its place in the window decides.
    const places = [{ ...queue[0], index: 0 }, queue[1]];
    assert.equal(restoreRecordFor(places, tab, context(tab.url)), 1);
});

test("the first record a window's tab takes after a restart names the window it was", () => {
    const restarted = new Map();
    noteRestarted(restarted, { windowId: 1 }, record('https://x.test/'));
    assert.equal(restarted.size, 0, 'a record from an older version names no window');
    noteRestarted(restarted, { windowId: 1 }, closed('https://x.test/', 4));
    assert.equal(restarted.size, 0, 'a window-close record is matched another way');
    noteRestarted(restarted, { windowId: 1 }, record('https://x.test/', { windowId: 6 }));
    noteRestarted(restarted, { windowId: 1 }, record('https://x.test/', { windowId: 7 }));
    assert.deepEqual([...restarted], [[1, 6]]);
});

test("a record still waiting from an earlier session is saved without that session's window", () => {
    const old = record('https://x.test/', { windowId: 6, index: 2 });
    assert.deepEqual(forSnapshot([old, closed('https://y.test/')]), [
        record('https://x.test/'),
        closed('https://y.test/')
    ]);
});
