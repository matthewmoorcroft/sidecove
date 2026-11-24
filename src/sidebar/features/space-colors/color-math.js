// Colour maths for space colours: sRGB hex, WCAG contrast, OKLCH and HSV. Pure, no DOM.

const HEX = /^#?([0-9a-f]{6})$/i;

// '#rrggbb' in lower case, or null when the text is not a six-digit hex colour.
export function normalizeHex(text) {
    const match = HEX.exec(String(text ?? '').trim());
    return match ? `#${match[1].toLowerCase()}` : null;
}

export const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

export const rgbToHex = rgb =>
    '#' +
    rgb
        .map(v =>
            Math.round(Math.min(255, Math.max(0, v)))
                .toString(16)
                .padStart(2, '0')
        )
        .join('');

const toLinear = c => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055);

export function luminance(rgb) {
    const [r, g, b] = rgb.map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio of two opaque [r, g, b] colours, from 1 to 21.
export function contrast(a, b) {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

// [lightness 0-1, chroma, hue in degrees]
export function rgbToOklch(rgb) {
    const [r, g, b] = rgb.map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function oklchToRgbUnclamped([L, C, H]) {
    const a = C * Math.cos((H * Math.PI) / 180);
    const b = C * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ].map(fromLinear);
}

const inGamut = rgb => rgb.every(v => v >= -0.5 && v <= 255.5);

// The nearest displayable colour: chroma shrinks until the colour fits in sRGB, so the hue
// and lightness stay as asked.
export function oklchToRgb([L, C, H]) {
    let chroma = C;
    for (let i = 0; i < 60 && !inGamut(oklchToRgbUnclamped([L, chroma, H])); i++) chroma *= 0.95;
    return oklchToRgbUnclamped([L, chroma, H]).map(v => Math.min(255, Math.max(0, v)));
}

// Hue 0-360, saturation and value 0-1, as the colour square and hue slider use them.
export function hsvToHex(h, s, v) {
    const f = n => {
        const k = (n + h / 60) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return rgbToHex([f(5), f(3), f(1)].map(x => x * 255));
}

export function hexToHsv(hex) {
    const [r, g, b] = hexToRgb(hex).map(x => x / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
}
