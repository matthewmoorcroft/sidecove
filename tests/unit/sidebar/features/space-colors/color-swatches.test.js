import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowTarget } from '../../../../../src/sidebar/features/space-colors/color-swatches.js';

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
