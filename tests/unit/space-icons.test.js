import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpaceIcon, spaceInitial, SPACE_ICON_CHOICES } from '../../space-icons.js';

test('a space icon is a single emoji or character', () => {
    assert.equal(normalizeSpaceIcon('🎵'), '🎵');
    assert.equal(normalizeSpaceIcon('  👩‍💻 '), '👩‍💻');
    assert.equal(normalizeSpaceIcon('🇬🇧'), '🇬🇧');
    assert.equal(normalizeSpaceIcon('W'), 'W');
});

test('empty, multi-character and control input is rejected', () => {
    assert.equal(normalizeSpaceIcon(''), null);
    assert.equal(normalizeSpaceIcon('   '), null);
    assert.equal(normalizeSpaceIcon(null), null);
    assert.equal(normalizeSpaceIcon('🎵🎸'), null);
    assert.equal(normalizeSpaceIcon('Work'), null);
    assert.equal(normalizeSpaceIcon('\u0007'), null);
});

test('the picker offers distinct valid choices', () => {
    assert.ok(SPACE_ICON_CHOICES.length >= 16);
    assert.equal(new Set(SPACE_ICON_CHOICES).size, SPACE_ICON_CHOICES.length);
    for (const icon of SPACE_ICON_CHOICES) assert.equal(normalizeSpaceIcon(icon), icon);
});

test('a space without an icon shows its first letter in compact chips', () => {
    assert.equal(spaceInitial('work'), 'W');
    assert.equal(spaceInitial('  ëlan'), 'Ë');
    assert.equal(spaceInitial('🎵 Music'), '🎵');
    assert.equal(spaceInitial(''), '?');
});
