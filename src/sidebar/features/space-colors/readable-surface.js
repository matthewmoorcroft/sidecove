// Keeps the sidebar readable on any colour someone picks. The text colour is fixed per mode
// and many rules assume it, so the surface moves instead: the picked colour keeps its OKLCH
// hue and chroma, and only its lightness changes, by the least needed, into a band.
import { contrast, hexToRgb, normalizeHex, oklchToRgb, rgbToHex, rgbToOklch } from './color-math.js';

export const TEXT = { light: '#333333', dark: '#eceff1' };

// Light: never darker than blue, the darkest of the original eight (5.92:1), so text that stays
// readable on those stays so (5.5 would already keep the 90% secondary text at AA); and 11
// keeps the tour's white-on-mixed button readable (a white surface would drop it to 4.27).
// Dark: the 10:1 every built-in dark colour has, which keeps the muted text readable on the
// lighter hover shade.
export const BAND = {
    light: { min: 5.9, max: 11, aim: 6.3 },
    dark: { min: 10, max: 18, aim: 11 }
};

// In dark mode a closed favorite's title is the text at 60%. On a saturated surface that can
// fall under AA while the full text is still 10:1, so it has a floor of its own there.
export const FADED = { alpha: 0.6, min: 4.6, aim: 4.7 };

const textRgb = mode => hexToRgb(TEXT[mode]);
const mainContrast = mode => rgb => contrast(textRgb(mode), rgb);
const fadedContrast = mode => rgb =>
    contrast(
        textRgb(mode).map((c, i) => c * FADED.alpha + rgb[i] * (1 - FADED.alpha)),
        rgb
    );

export const textContrast = (mode, hex) => mainContrast(mode)(hexToRgb(hex));
export const fadedTextContrast = (mode, hex) => fadedContrast(mode)(hexToRgb(hex));

// Too little contrast for the text, rather than too much.
const tooFaint = (mode, hex) =>
    textContrast(mode, hex) < BAND[mode].min || (mode === 'dark' && fadedTextContrast(mode, hex) < FADED.min);
const readable = (mode, hex) => !tooFaint(mode, hex) && textContrast(mode, hex) <= BAND[mode].max;

// The lightness at which measure reaches target, on its readable side. Lighter raises contrast
// with the dark text of light mode; darker does with the light text of dark mode.
function lightnessFor(mode, chroma, hue, measure, target) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const value = measure(oklchToRgb([mid, chroma, hue]));
        if (mode === 'light' ? value < target : value > target) lo = mid;
        else hi = mid;
    }
    return mode === 'light' ? hi : lo;
}

// The surface Sidecove paints for a picked colour in a mode. A colour already readable is used
// exactly; any other moves just inside the band, on the side it fell out of.
export function readableSurface(hex, mode) {
    const seed = normalizeHex(hex);
    if (!seed) throw new Error(`Not a hex colour: ${hex}`);
    if (readable(mode, seed)) return seed;
    const band = BAND[mode];
    const [, chroma, hue] = rgbToOklch(hexToRgb(seed));
    let lightness;
    if (tooFaint(mode, seed)) {
        lightness = lightnessFor(mode, chroma, hue, mainContrast(mode), band.aim);
        if (mode === 'dark')
            lightness = Math.min(lightness, lightnessFor(mode, chroma, hue, fadedContrast(mode), FADED.aim));
    } else lightness = lightnessFor(mode, chroma, hue, mainContrast(mode), band.max - 0.3);
    let surface = rgbToHex(oklchToRgb([lightness, chroma, hue]));
    // Rounding to whole sRGB steps can land a hair outside; nudge until it is inside.
    for (let i = 0; i < 60 && !readable(mode, surface); i++) {
        lightness += tooFaint(mode, surface) === (mode === 'light') ? 0.004 : -0.004;
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
