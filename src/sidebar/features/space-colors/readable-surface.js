// Keeps the sidebar readable on any colour someone picks. The text colour is fixed per mode
// and many rules assume it, so the surface moves instead: the picked colour keeps its OKLCH
// hue and chroma, and only its lightness changes, by the least needed, into a band.
import { contrast, hexToRgb, normalizeHex, oklchToRgb, rgbToHex, rgbToOklch } from './color-math.js';

export const TEXT = { light: '#333333', dark: '#eceff1' };

// Light: 5.5 keeps the 90% secondary text at WCAG AA, and 11 keeps the tour's white-on-mixed
// button readable (a white surface would drop it to 4.27). Dark: the 10:1 every built-in dark
// colour has, which keeps the muted text readable on the lighter hover shade.
export const BAND = {
    light: { min: 5.5, max: 11, aim: 6 },
    dark: { min: 10, max: 18, aim: 11 }
};

export const textContrast = (mode, hex) => contrast(hexToRgb(TEXT[mode]), hexToRgb(hex));

const inBand = (mode, ratio) => ratio >= BAND[mode].min && ratio <= BAND[mode].max;

// Lighter in light mode raises contrast with the dark text; darker does in dark mode.
function lightnessFor(mode, chroma, hue, target) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const ratio = contrast(hexToRgb(TEXT[mode]), oklchToRgb([mid, chroma, hue]));
        if (mode === 'light' ? ratio < target : ratio > target) lo = mid;
        else hi = mid;
    }
    return mode === 'light' ? hi : lo;
}

// The surface Sidecove paints for a picked colour in a mode. A colour already readable is used
// exactly; any other moves just inside the band, on the side it fell out of.
export function readableSurface(hex, mode) {
    const seed = normalizeHex(hex);
    if (!seed) throw new Error(`Not a hex colour: ${hex}`);
    const band = BAND[mode];
    const start = textContrast(mode, seed);
    if (inBand(mode, start)) return seed;
    const [, chroma, hue] = rgbToOklch(hexToRgb(seed));
    const aim = start < band.min ? band.aim : band.max - 0.3;
    let lightness = lightnessFor(mode, chroma, hue, aim);
    let surface = rgbToHex(oklchToRgb([lightness, chroma, hue]));
    // Rounding to whole sRGB steps can land a hair outside; nudge until it is inside.
    for (let i = 0; i < 40 && !inBand(mode, textContrast(mode, surface)); i++) {
        const tooLow = textContrast(mode, surface) < band.min;
        lightness += tooLow === (mode === 'light') ? 0.004 : -0.004;
        surface = rgbToHex(oklchToRgb([lightness, chroma, hue]));
    }
    return surface;
}

// Chrome's nine tab group colours, close to how Chrome draws them in light mode; only their
// hue is used.
export const CHROME_GROUP_COLORS = {
    grey: '#5f6368',
    blue: '#1a73e8',
    red: '#d93025',
    yellow: '#f9ab00',
    green: '#188038',
    pink: '#d01884',
    purple: '#a142f4',
    cyan: '#007b83',
    orange: '#fa903e'
};

const GROUP_HUES = Object.entries(CHROME_GROUP_COLORS)
    .filter(([name]) => name !== 'grey')
    .map(([name, hex]) => [name, rgbToOklch(hexToRgb(hex))[2]]);

// The tab group colour for a picked colour: the nearest of Chrome's by hue, or grey for a
// colour with almost no hue.
export function nearestChromeColor(hex) {
    const seed = normalizeHex(hex);
    if (!seed) return 'grey';
    const [, chroma, hue] = rgbToOklch(hexToRgb(seed));
    if (chroma < 0.04) return 'grey';
    let best = 'grey';
    let bestDistance = Infinity;
    for (const [name, groupHue] of GROUP_HUES) {
        const apart = Math.abs(hue - groupHue);
        const distance = Math.min(apart, 360 - apart);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = name;
        }
    }
    return best;
}
