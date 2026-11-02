import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpaceIcon, SPACE_ICON_CHOICES, SPACE_SYMBOLS, spaceSymbol, searchSpaceIcons, isTypedEmoji } from '../../space-icons.js';

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

test('a known symbol is a valid icon; an unknown one is not', () => {
    assert.equal(normalizeSpaceIcon('symbol:house'), 'symbol:house');
    assert.equal(spaceSymbol('symbol:house').label, 'Home');
    assert.equal(normalizeSpaceIcon('symbol:no-such-symbol'), null);
    assert.equal(spaceSymbol('🏠'), null);
});

test('searching finds symbols and emoji by name or keyword', () => {
    const music = searchSpaceIcons('music');
    assert.ok(music.symbols.includes('symbol:eighth-notes'));
    assert.ok(music.emoji.includes('🎵'));
    assert.ok(searchSpaceIcons('plan').symbols.includes('symbol:plane'));
    assert.deepEqual(searchSpaceIcons('zzzz'), { symbols: [], emoji: [] });
    const all = searchSpaceIcons('');
    assert.equal(all.symbols.length, SPACE_SYMBOLS.length);
    assert.equal(all.emoji.length, SPACE_ICON_CHOICES.length);
});

test('every symbol is drawn only from plain shapes', () => {
    const shapes = new Set(['path', 'circle', 'rect', 'line', 'ellipse', 'polyline', 'polygon']);
    for (const symbol of SPACE_SYMBOLS) {
        assert.ok(symbol.nodes.length > 0, symbol.name);
        for (const [tag, attrs] of symbol.nodes) {
            assert.ok(shapes.has(tag), `${symbol.name}: ${tag}`);
            for (const name of Object.keys(attrs)) assert.match(name, /^(d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height|points|fill)$/, `${symbol.name}: ${name}`);
        }
    }
});

test('only a single emoji counts as typed; letters and words are searched', () => {
    assert.equal(isTypedEmoji('🎷'), true);
    assert.equal(isTypedEmoji('🇬🇧'), true);
    assert.equal(isTypedEmoji('1️⃣'), true);
    assert.equal(isTypedEmoji('#️⃣'), true);
    assert.equal(isTypedEmoji('1'), false);
    assert.equal(isTypedEmoji('W'), false);
    assert.equal(isTypedEmoji('jazz'), false);
});
