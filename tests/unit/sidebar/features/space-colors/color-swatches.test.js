import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowTarget } from '../../../../../src/sidebar/features/space-colors/color-swatches.js';

test('arrow keys move through a six-wide grid of 24 and stop at its edges', () => {
    assert.equal(arrowTarget(0, 'ArrowRight', 6, 24), 1);
    assert.equal(arrowTarget(0, 'ArrowLeft', 6, 24), 0);
    assert.equal(arrowTarget(0, 'ArrowDown', 6, 24), 6);
    assert.equal(arrowTarget(3, 'ArrowUp', 6, 24), 3);
    assert.equal(arrowTarget(20, 'ArrowDown', 6, 24), 20);
    assert.equal(arrowTarget(9, 'Home', 6, 24), 0);
    assert.equal(arrowTarget(9, 'End', 6, 24), 23);
    assert.equal(arrowTarget(9, 'a', 6, 24), null);
});
