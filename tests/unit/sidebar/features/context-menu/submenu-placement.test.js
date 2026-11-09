import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeSubmenu } from '../../../../../src/sidebar/features/context-menu/submenu-placement.js';

const viewport = { width: 300, height: 600 };
const item = (left, top) => ({ left, right: left + 120, top, bottom: top + 28 });
const size = { width: 150, height: 200 };

test('opens to the right when there is room', () => {
    const style = placeSubmenu(item(10, 100), size, viewport);
    assert.equal(style.left, '');
    assert.equal(style.right, '');
});

test('opens to the left when the right side is too narrow', () => {
    const style = placeSubmenu(item(170, 100), size, viewport);
    assert.equal(style.left, 'auto');
    assert.equal(style.right, '100%');
});

test('opens under the item, inside the panel, when neither side has room', () => {
    // 120px item in a 300px panel with a 220px submenu: 120 + 220 > 300 and 100 - 220 < 0.
    const style = placeSubmenu(item(100, 100), { width: 220, height: 200 }, viewport);
    assert.equal(style.top, '100%');
    assert.equal(style.right, 'auto');
    // Item left is 100, panel allows at most 300 - 220 = 80, so shift left by 20.
    assert.equal(style.left, '-20px');
});

test('under the item, a submenu that would start left of the panel is shifted right', () => {
    const style = placeSubmenu({ left: -10, right: 110, top: 100, bottom: 128 }, { width: 290, height: 100 }, viewport);
    assert.equal(style.left, '10px');
});

test('under the item, opens above it when the panel has no room below', () => {
    const style = placeSubmenu(item(100, 500), { width: 220, height: 200 }, viewport);
    assert.equal(style.top, 'auto');
    assert.equal(style.bottom, '100%');
});

test('beside the item, aligns to the bottom when it would run off the panel', () => {
    const style = placeSubmenu(item(10, 500), size, viewport);
    assert.equal(style.top, 'auto');
    assert.equal(style.bottom, '0');
});
