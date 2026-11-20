import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BAND,
    nearestChromeColor,
    readableSurface,
    textContrast
} from '../../../../../src/sidebar/features/space-colors/readable-surface.js';
import { hexToRgb, rgbToHex, rgbToOklch } from '../../../../../src/sidebar/features/space-colors/color-math.js';

// Every colour on an 18-step grid of the sRGB cube, 5,832 in all.
const STEPS = 18;
const grid = [];
for (let r = 0; r < STEPS; r++)
    for (let g = 0; g < STEPS; g++)
        for (let b = 0; b < STEPS; b++) grid.push(rgbToHex([r, g, b].map(c => (c * 255) / (STEPS - 1))));

for (const mode of ['light', 'dark']) {
    test(`every colour becomes a ${mode} surface inside the readable band`, () => {
        const outside = [];
        for (const hex of grid) {
            const surface = readableSurface(hex, mode);
            const ratio = textContrast(mode, surface);
            if (ratio < BAND[mode].min || ratio > BAND[mode].max) outside.push({ hex, surface, ratio });
        }
        assert.deepEqual(outside, []);
    });
}

test('a colour already readable is used exactly', () => {
    assert.equal(readableSurface('#8FD8C9', 'light'), '#8fd8c9');
    assert.equal(readableSurface('#013a32', 'dark'), '#013a32');
    assert.equal(readableSurface('8bb3f3', 'light'), '#8bb3f3');
});

test('only lightness moves: the hue stays, and the change is small', () => {
    for (const [hex, mode] of [
        ['#e07a5f', 'light'],
        ['#1a73e8', 'light'],
        ['#ffff00', 'light'],
        ['#e07a5f', 'dark'],
        ['#6a4c93', 'dark']
    ]) {
        const surface = readableSurface(hex, mode);
        assert.notEqual(surface, hex);
        const [, , hueBefore] = rgbToOklch(hexToRgb(hex));
        const [, , hueAfter] = rgbToOklch(hexToRgb(surface));
        const apart = Math.abs(hueBefore - hueAfter);
        assert.ok(Math.min(apart, 360 - apart) < 6, `${hex} ${mode}: hue ${hueBefore} became ${hueAfter}`);
        // Lands near the edge of the band it was outside, not anywhere in it.
        const ratio = textContrast(mode, surface);
        const { min, max, aim } = BAND[mode];
        assert.ok(ratio <= aim + 0.3 || ratio >= max - 0.6, `${hex} ${mode}: ${ratio}`);
        assert.ok(ratio >= min && ratio <= max);
    }
});

test('too vivid or dark in light mode is lightened; too bright in dark mode is deepened', () => {
    const lighter = (a, b) => rgbToOklch(hexToRgb(a))[0] > rgbToOklch(hexToRgb(b))[0];
    assert.ok(lighter(readableSurface('#1a73e8', 'light'), '#1a73e8'));
    assert.ok(lighter('#ffffff', readableSurface('#ffffff', 'light')));
    assert.ok(lighter('#ffc38c', readableSurface('#ffc38c', 'dark')));
});

test('a colour that is not hex is refused', () => {
    assert.throws(() => readableSurface('teal', 'light'));
});

test('the nearest Chrome tab group colour goes by hue, with greys as grey', () => {
    assert.equal(nearestChromeColor('#e07a5f'), 'red');
    assert.equal(nearestChromeColor('#ff8c1a'), 'orange');
    assert.equal(nearestChromeColor('#6a4c93'), 'purple');
    assert.equal(nearestChromeColor('#2e86de'), 'blue');
    assert.equal(nearestChromeColor('#ff0000'), 'red');
    assert.equal(nearestChromeColor('#00ff00'), 'green');
    assert.equal(nearestChromeColor('#00c8d0'), 'cyan');
    assert.equal(nearestChromeColor('#ff3fa4'), 'pink');
    assert.equal(nearestChromeColor('#ffd000'), 'yellow');
    assert.equal(nearestChromeColor('#808080'), 'grey');
    assert.equal(nearestChromeColor('#d9d2ca'), 'grey');
    assert.equal(nearestChromeColor('#000000'), 'grey');
    assert.equal(nearestChromeColor('#ffffff'), 'grey');
    assert.equal(nearestChromeColor('nonsense'), 'grey');
});
