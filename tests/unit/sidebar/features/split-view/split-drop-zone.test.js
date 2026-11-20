import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createSplitArming,
    splitDropCandidate,
    splitDropZone
} from '../../../../../src/sidebar/features/split-view/split-drop-zone.js';

const row = { top: 100, height: 40 };

test('only the middle band of a row offers a split; its top and bottom keep reordering', () => {
    assert.equal(splitDropZone(row, 100), 'reorder');
    assert.equal(splitDropZone(row, 111), 'reorder');
    assert.equal(splitDropZone(row, 112), 'split');
    assert.equal(splitDropZone(row, 120), 'split');
    assert.equal(splitDropZone(row, 128), 'split');
    assert.equal(splitDropZone(row, 129), 'reorder');
    assert.equal(splitDropZone(row, 140), 'reorder');
});

test('a pointer outside the row, or a row with no height, never offers a split', () => {
    assert.equal(splitDropZone(row, 90), 'reorder');
    assert.equal(splitDropZone(row, 150), 'reorder');
    assert.equal(splitDropZone({ top: 100, height: 0 }, 100), 'reorder');
    assert.equal(splitDropZone(null, 100), 'reorder');
});

const candidate = (extra = {}) => ({
    section: 'temporary',
    draggedId: 1,
    targetId: 2,
    carriedCount: 1,
    draggedInSplit: false,
    targetInSplit: false,
    ...extra
});

test('one open tab dragged onto another open tab of the list may be split with it', () => {
    assert.equal(splitDropCandidate(candidate()), true);
});

test('favorites never offer a split, so a drag over their list is never one', () => {
    assert.equal(splitDropCandidate(candidate({ section: 'pinned' })), false);
});

test('a selection of several tabs, or a tab onto itself, is not split', () => {
    assert.equal(splitDropCandidate(candidate({ carriedCount: 2 })), false);
    assert.equal(splitDropCandidate(candidate({ targetId: 1 })), false);
});

test('a row without an open tab, a favorite that is not open say, is not split', () => {
    assert.equal(splitDropCandidate(candidate({ targetId: null })), false);
    assert.equal(splitDropCandidate(candidate({ draggedId: null })), false);
});

test('a tab already in a split view is not offered another, dragged or dropped on', () => {
    assert.equal(splitDropCandidate(candidate({ draggedInSplit: true })), false);
    assert.equal(splitDropCandidate(candidate({ targetInSplit: true })), false);
});

test('the offer turns on only after the same row is held for the whole dwell', () => {
    const arming = createSplitArming({ dwellMs: 500 });
    assert.equal(arming.next('2:1', 0), false);
    assert.equal(arming.next('2:1', 499), false);
    assert.equal(arming.next('2:1', 500), true);
    assert.equal(arming.next('2:1', 900), true);
});

test('moving to another row, or out of the middle band, starts the hold again', () => {
    const arming = createSplitArming({ dwellMs: 500 });
    arming.next('2:1', 0);
    assert.equal(arming.next('3:1', 600), false);
    assert.equal(arming.next('3:1', 1000), false);
    assert.equal(arming.next('3:1', 1100), true);
    assert.equal(arming.next(null, 1200), false);
    assert.equal(arming.next('3:1', 1300), false);
    assert.equal(arming.next('3:1', 1800), true);
});

test('reset forgets the hold, as when a drag ends', () => {
    const arming = createSplitArming({ dwellMs: 500 });
    arming.next('2:1', 0);
    arming.reset();
    assert.equal(arming.next('2:1', 600), false);
});
