// The 24 space colours offered with one click, and how a space's stored colour maps to what
// Sidecove paints.
//
// A space keeps `color`, one of Chrome's nine tab group colours, as it always has: import, tab
// group sync and older data all use it. The optional `shade` refines it: a palette name beyond
// Chrome's nine ('teal') or a custom '#rrggbb'. A space without one looks exactly as before.
import { COLOR_NAMES } from '../../../shared/color-palette.js';
import { normalizeHex } from './color-math.js';
import { nearestChromeColor, readableSurface } from './readable-surface.js';

// Hand-set light and dark surfaces, in rows of six by hue. The eight original colours keep
// their values (and their Settings overrides); every light one is 5.5:1 to 11:1 against the
// light text and every dark one at least 10:1 against the dark text.
const ROWS = [
    ['grey', '#cccccc', '#252d30', 'grey'],
    ['stone', '#d9d2ca', '#37322c', 'grey'],
    ['slate', '#c2ccd8', '#2c333d', 'grey'],
    ['sand', '#eadbb7', '#3d3112', 'yellow'],
    ['brown', '#e0b99d', '#4a2b12', 'orange'],
    ['olive', '#cfd7a2', '#313601', 'green'],
    ['red', '#ff9e97', '#4f0a10', 'red'],
    ['coral', '#ffab94', '#601b06', 'red'],
    ['orange', '#ffc38c', '#4d2a01', 'orange'],
    ['amber', '#ffd37e', '#432f01', 'yellow'],
    ['yellow', '#ffe29f', '#403100', 'yellow'],
    ['lime', '#d3ea96', '#2c3702', 'green'],
    ['green', '#8bda99', '#003310', 'green'],
    ['mint', '#a9e7c8', '#033b27', 'green'],
    ['teal', '#8fd8c9', '#013a32', 'cyan'],
    ['cyan', '#a5e2ea', '#013d44', 'cyan'],
    ['sky', '#a7d5f6', '#073650', 'blue'],
    ['blue', '#8bb3f3', '#002b4a', 'blue'],
    ['indigo', '#acb3f6', '#2c2c64', 'blue'],
    ['violet', '#c4abf8', '#3e2465', 'purple'],
    ['purple', '#d6a6ff', '#422159', 'purple'],
    ['orchid', '#eaa9f0', '#531a59', 'purple'],
    ['pink', '#fbaad7', '#54183e', 'pink'],
    ['rose', '#ffa9c0', '#5e1832', 'pink']
];

const label = name => name.charAt(0).toUpperCase() + name.slice(1);

export const PALETTE = ROWS.map(([name, light, dark, chrome]) => ({ name, label: label(name), light, dark, chrome }));

export const CHROME_COLOR_NAMES = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const chromeColorLabel = label;

const byName = new Map(PALETTE.map(entry => [entry.name, entry]));
export const paletteEntry = name => byName.get(name) ?? null;

// The original eight are painted through the stylesheet's variables, so Settings → Colors
// overrides keep applying to them.
export const isOverridable = name => COLOR_NAMES.includes(name);

// What the colour menu shows as chosen: a palette name, or the custom '#rrggbb'.
export function spaceColorKey(space) {
    const shade = space?.shade;
    if (typeof shade === 'string') {
        const hex = normalizeHex(shade);
        if (hex) return hex;
        if (byName.has(shade)) return shade;
    }
    return space?.color;
}

const surfaces = new Map();
function customSurfaces(hex) {
    if (!surfaces.has(hex))
        surfaces.set(hex, { light: readableSurface(hex, 'light'), dark: readableSurface(hex, 'dark') });
    return surfaces.get(hex);
}

// How to paint a space: `named` colours go through the stylesheet's --chrome-<name>-color
// variables (as every space did before); the rest carry their light and dark values.
export function spaceLook(space) {
    const key = spaceColorKey(space);
    const hex = normalizeHex(key);
    if (hex) return { key: hex, custom: true, ...customSurfaces(hex), label: hex.toUpperCase() };
    const entry = paletteEntry(key);
    if (!entry || isOverridable(key)) return { key, named: true, label: entry?.label ?? key };
    return { key, light: entry.light, dark: entry.dark, label: entry.label };
}

// The fields to store for a palette choice: the colour's own Chrome group colour, and a shade
// only when the name is not one of Chrome's.
export function paletteChoice(name) {
    const entry = paletteEntry(name);
    if (!entry) return null;
    return { color: entry.chrome, shade: entry.name === entry.chrome ? null : entry.name };
}

// The fields to store for a custom colour. The tab group takes the nearest Chrome colour unless
// one was chosen by hand.
export function customChoice(hex, groupColor = null) {
    const seed = normalizeHex(hex);
    if (!seed) return null;
    const color = CHROME_COLOR_NAMES.includes(groupColor) ? groupColor : nearestChromeColor(seed);
    return { color, shade: seed };
}

// The fields for whatever the menu's select holds: a palette name or a hex.
export const choiceForKey = (key, groupColor) => paletteChoice(key) ?? customChoice(key, groupColor);
