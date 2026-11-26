import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowTarget, tipShift } from '../../../../../src/sidebar/features/space-colors/swatch-geometry.js';

test('arrow keys move through two rows of six (11 colours and the custom circle) and stop at the edges', () => {
    assert.equal(arrowTarget(0, 'ArrowRight', 6, 12), 1);
    assert.equal(arrowTarget(0, 'ArrowLeft', 6, 12), 0);
    assert.equal(arrowTarget(0, 'ArrowDown', 6, 12), 6);
    assert.equal(arrowTarget(5, 'ArrowDown', 6, 12), 11);
    assert.equal(arrowTarget(3, 'ArrowUp', 6, 12), 3);
    assert.equal(arrowTarget(8, 'ArrowDown', 6, 12), 8);
    assert.equal(arrowTarget(9, 'Home', 6, 12), 0);
    assert.equal(arrowTarget(4, 'End', 6, 12), 11);
    assert.equal(arrowTarget(9, 'a', 6, 12), null);
});

test('a name tip that would cross the edge of what clips it moves back inside', () => {
    // The spaces list, 8px inside a 360px panel on each side.
    const [minX, maxX] = [8, 352];
    // Fits: no move.
    assert.equal(tipShift(100, 200, minX, maxX), 0);
    // Runs 30px past the list's right edge: back by 30, plus the 4px margin.
    assert.equal(tipShift(250, 382, minX, maxX), -34);
    // Past the left edge.
    assert.equal(tipShift(2, 90, minX, maxX), 10);
    // Wider than the list: its left edge stays in view.
    assert.equal(tipShift(-20, 400, minX, maxX), 32);
});
