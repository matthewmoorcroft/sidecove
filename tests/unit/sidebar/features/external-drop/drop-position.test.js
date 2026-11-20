import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chromeIndexFor,
    placeDroppedTab,
    rowAbovePair
} from '../../../../../src/sidebar/features/external-drop/drop-position.js';

test('a link dropped above a row goes just above it in the list', () => {
    assert.deepEqual(placeDroppedTab([1, 2, 3], 9, 2, false), [1, 9, 2, 3]);
    assert.deepEqual(placeDroppedTab([1, 2, 3], 9, 1, false), [9, 1, 2, 3]);
});

test('a link dropped after the last row goes last', () => {
    assert.deepEqual(placeDroppedTab([1, 2, 3], 9, null, false), [1, 2, 3, 9]);
});

test('in a list drawn newest first, the place on screen is kept', () => {
    // Stored [1, 2, 3] shows as 3, 2, 1. Above 2 on screen is between 3 and 2.
    assert.deepEqual(placeDroppedTab([1, 2, 3], 9, 2, true), [1, 2, 9, 3]);
    // After the last row on screen (1) is first in Chrome order.
    assert.deepEqual(placeDroppedTab([1, 2, 3], 9, null, true), [9, 1, 2, 3]);
});

test('a tab already in the list moves to the drop point instead of being listed twice', () => {
    assert.deepEqual(placeDroppedTab([1, 9, 2, 3], 9, 3, false), [1, 2, 9, 3]);
});

test('a row that is no longer listed puts the link at the end', () => {
    assert.deepEqual(placeDroppedTab([1, 2], 9, 42, false), [1, 2, 9]);
});

const tabs = list => new Map(list.map(([id, index, extra = {}]) => [id, { id, index, windowId: 1, ...extra }]));

test('in Chrome the tab opens just right of the tab before it in the list', () => {
    const byId = tabs([
        [1, 3],
        [2, 4],
        [3, 5]
    ]);
    assert.equal(chromeIndexFor([1, 9, 2, 3], 9, byId, 1), 4);
    assert.equal(chromeIndexFor([1, 2, 3, 9], 9, byId, 1), 6);
});

test('first in the list, it opens just left of the tab after it', () => {
    const byId = tabs([
        [1, 3],
        [2, 4]
    ]);
    assert.equal(chromeIndexFor([9, 1, 2], 9, byId, 1), 3);
});

test('tabs of other windows are passed over, and with none here Chrome chooses', () => {
    const byId = tabs([
        [1, 2],
        [2, 0, { windowId: 2 }]
    ]);
    assert.equal(chromeIndexFor([1, 2, 9], 9, byId, 1), 3);
    assert.equal(chromeIndexFor([2, 9], 9, byId, 1), undefined);
    assert.equal(chromeIndexFor([9], 9, new Map(), 1), undefined);
});

test('a split pair is stepped over whole, so the new tab never lands between its halves', () => {
    const byId = tabs([
        [1, 3, { splitViewId: 5 }],
        [2, 4, { splitViewId: 5 }],
        [3, 6]
    ]);
    // Stored with the pair's halves the other way round from Chrome's strip.
    assert.equal(chromeIndexFor([2, 1, 9, 3], 9, byId, 1), 5);
    assert.equal(chromeIndexFor([9, 2, 1], 9, byId, 1), 3);
});

const row = (tabId, splitViewId) => ({
    dataset: { tabId: String(tabId), ...(splitViewId ? { splitViewId: String(splitViewId) } : {}) }
});

test('a drop line between the halves of a split pair moves above the whole pair', () => {
    const rows = [row(10), row(11, 5), row(12, 5), row(13)];
    assert.equal(rowAbovePair(rows, rows[2]), rows[1]);
});

test('a drop line above the pair, below it or outside any pair stays where it is', () => {
    const rows = [row(10), row(11, 5), row(12, 5), row(13)];
    assert.equal(rowAbovePair(rows, rows[1]), rows[1]);
    assert.equal(rowAbovePair(rows, rows[3]), rows[3]);
    assert.equal(rowAbovePair(rows, rows[0]), rows[0]);
    assert.equal(rowAbovePair(rows, null), null);
});

test('two tabs with the same split id that are not next to each other are not a pair', () => {
    const rows = [row(10, 5), row(11), row(12, 5)];
    assert.equal(rowAbovePair(rows, rows[2]), rows[2]);
});

test('above the pair, the list and Chrome keep the pair whole', () => {
    // Stored [10, 11 | 12, 13]: the pair is 11 and 12. A drop between them lands above 11.
    const stored = placeDroppedTab([10, 11, 12, 13], 99, 11, false);
    assert.deepEqual(stored, [10, 99, 11, 12, 13]);
    const byId = tabs([
        [10, 3],
        [11, 4, { splitViewId: 5 }],
        [12, 5, { splitViewId: 5 }],
        [13, 6]
    ]);
    assert.equal(chromeIndexFor(stored, 99, byId, 1), 4);
});
