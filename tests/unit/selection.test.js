import test from 'node:test';
import assert from 'node:assert/strict';
import { Selection, selectionGesture } from '../../selection.js';

const order = ['a', 'b', 'c', 'd', 'e'];

test('Cmd or Ctrl click toggles single items and sets the range anchor', () => {
    const selection = new Selection();
    selection.toggle('b');
    selection.toggle('d');
    assert.deepEqual(selection.ordered(order), ['b', 'd']);
    selection.toggle('b');
    assert.deepEqual(selection.ordered(order), ['d']);
    assert.equal(selection.anchor, 'b');
});

test('Shift click selects the run from the anchor, in either direction', () => {
    const selection = new Selection();
    selection.toggle('b');
    selection.extendTo('d', order);
    assert.deepEqual(selection.ordered(order), ['b', 'c', 'd']);
    // A new shift click from the same anchor replaces the run.
    selection.extendTo('a', order);
    assert.deepEqual(selection.ordered(order), ['a', 'b']);
});

test('Shift click without an anchor starts from the active item', () => {
    const selection = new Selection();
    selection.extendTo('d', order, 'b');
    assert.deepEqual(selection.ordered(order), ['b', 'c', 'd']);
    const fresh = new Selection();
    fresh.extendTo('c', order);
    assert.deepEqual(fresh.ordered(order), ['c']);
});

test('clearing and pruning keep only items that still exist', () => {
    const selection = new Selection();
    ['a', 'c', 'e'].forEach(key => selection.toggle(key));
    selection.prune(['a', 'b', 'c']);
    assert.deepEqual(selection.ordered(order), ['a', 'c']);
    assert.equal(selection.size, 2);
    selection.clear();
    assert.equal(selection.size, 0);
    assert.equal(selection.anchor, null);
});

test('mouse modifiers map to selection gestures', () => {
    assert.equal(selectionGesture({ metaKey: true }), 'toggle');
    assert.equal(selectionGesture({ ctrlKey: true }), 'toggle');
    assert.equal(selectionGesture({ shiftKey: true }), 'range');
    assert.equal(selectionGesture({}), null);
});
