import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CHROME_COLOR_NAMES,
    PALETTE,
    choiceForKey,
    customChoice,
    paletteChoice,
    spaceColorKey,
    spaceLook
} from '../../../../../src/sidebar/features/space-colors/space-palette.js';
import {
    BAND,
    FADED,
    fadedTextContrast,
    textContrast
} from '../../../../../src/sidebar/features/space-colors/readable-surface.js';
import { COLOR_NAMES, DARK_DEFAULTS, LIGHT_DEFAULTS } from '../../../../../src/shared/color-palette.js';

test('24 colours, each named once, each with a Chrome tab group colour', () => {
    assert.equal(PALETTE.length, 24);
    assert.equal(new Set(PALETTE.map(c => c.name)).size, 24);
    for (const colour of PALETTE) assert.ok(CHROME_COLOR_NAMES.includes(colour.chrome), colour.name);
    // All nine of Chrome's colours are there, so an imported orange group gets a colour.
    for (const name of CHROME_COLOR_NAMES) assert.equal(PALETTE.find(c => c.name === name)?.chrome, name);
});

test("today's eight keep exactly their light and dark values", () => {
    for (const name of COLOR_NAMES) {
        const colour = PALETTE.find(c => c.name === name);
        assert.equal(colour.light, LIGHT_DEFAULTS[name]);
        assert.equal(colour.dark, DARK_DEFAULTS[name]);
    }
});

test('every palette colour is readable in both modes', () => {
    for (const colour of PALETTE) {
        for (const mode of ['light', 'dark']) {
            const ratio = textContrast(mode, colour[mode]);
            assert.ok(ratio >= BAND[mode].min && ratio <= BAND[mode].max, `${colour.name} ${mode}: ${ratio}`);
        }
        assert.ok(fadedTextContrast('dark', colour.dark) >= FADED.min, colour.name);
    }
});

test('a space with no shade looks as it always has', () => {
    assert.equal(spaceColorKey({ color: 'blue' }), 'blue');
    assert.deepEqual(spaceLook({ color: 'blue' }), { key: 'blue', named: true, label: 'Blue' });
    assert.deepEqual(spaceLook({ color: 'blue', shade: null }), { key: 'blue', named: true, label: 'Blue' });
});

test('an imported orange space, which had no colour before, now has one', () => {
    assert.deepEqual(spaceLook({ color: 'orange' }), {
        key: 'orange',
        light: '#ffc38c',
        dark: '#4d2a01',
        label: 'Orange'
    });
});

test('a palette shade paints its own light and dark values', () => {
    assert.equal(spaceColorKey({ color: 'cyan', shade: 'teal' }), 'teal');
    assert.deepEqual(spaceLook({ color: 'cyan', shade: 'teal' }), {
        key: 'teal',
        light: '#8fd8c9',
        dark: '#013a32',
        label: 'Teal'
    });
});

test('a custom shade paints readable surfaces for both modes', () => {
    const look = spaceLook({ color: 'orange', shade: '#E07A5F' });
    assert.equal(look.key, '#e07a5f');
    assert.equal(look.custom, true);
    assert.equal(look.label, '#E07A5F');
    assert.ok(textContrast('light', look.light) >= BAND.light.min);
    assert.ok(textContrast('dark', look.dark) >= BAND.dark.min);
});

test('an unknown shade is ignored', () => {
    assert.equal(spaceColorKey({ color: 'red', shade: 'plaid' }), 'red');
    assert.equal(spaceColorKey({ color: 'red', shade: 42 }), 'red');
});

test('a palette choice stores the Chrome colour, and a shade only beyond Chrome’s nine', () => {
    assert.deepEqual(paletteChoice('blue'), { color: 'blue', shade: null });
    assert.deepEqual(paletteChoice('orange'), { color: 'orange', shade: null });
    assert.deepEqual(paletteChoice('teal'), { color: 'cyan', shade: 'teal' });
    assert.deepEqual(paletteChoice('stone'), { color: 'grey', shade: 'stone' });
    assert.equal(paletteChoice('plaid'), null);
});

test('a custom choice takes the nearest tab group colour unless one is chosen', () => {
    assert.deepEqual(customChoice('#6A4C93'), { color: 'purple', shade: '#6a4c93' });
    assert.deepEqual(customChoice('#6a4c93', 'green'), { color: 'green', shade: '#6a4c93' });
    assert.deepEqual(customChoice('#6a4c93', 'auto'), { color: 'purple', shade: '#6a4c93' });
    assert.equal(customChoice('not a colour'), null);
    assert.deepEqual(choiceForKey('mint'), { color: 'green', shade: 'mint' });
    assert.deepEqual(choiceForKey('#ff8c1a'), { color: 'orange', shade: '#ff8c1a' });
});
