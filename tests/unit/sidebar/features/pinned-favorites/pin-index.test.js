import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedTabIndexAt } from '../../../../../src/sidebar/features/pinned-favorites/pin-index.js';

const icon = (tabId, ...classes) => ({
    dataset: tabId ? { tabId: String(tabId) } : {},
    classList: { contains: name => classes.includes(name) }
});
const bar = icons => ({ querySelectorAll: () => icons });

test('with only this window’s pins, the index is the drop position, as before', () => {
    const icons = [icon(1), icon(2), icon(3)];
    assert.equal(pinnedTabIndexAt(icons[1], 'left', bar(icons)), 1);
    assert.equal(pinnedTabIndexAt(icons[1], 'right', bar(icons)), 2);
    assert.equal(pinnedTabIndexAt(null, 'left', bar(icons)), 3);
    assert.equal(pinnedTabIndexAt(icon(9), 'left', bar(icons)), 3);
});

test('dimmed favorites and other windows’ pins before the drop point are not counted', () => {
    const icons = [icon(null, 'saved-favorite'), icon(1), icon(5, 'other-window'), icon(2)];
    assert.equal(pinnedTabIndexAt(icons[3], 'left', bar(icons)), 1);
    assert.equal(pinnedTabIndexAt(icons[3], 'right', bar(icons)), 2);
    assert.equal(pinnedTabIndexAt(icons[0], 'left', bar(icons)), 0);
});
