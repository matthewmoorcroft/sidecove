/**
 * WCAG AA contrast of the text a page shows.
 *
 * The page reports every visible piece of text (element text, input values, placeholders) with
 * its colour and the backgrounds and opacities of the elements it sits in; the maths runs here,
 * outside the page, so it can be unit tested.
 */

export const NORMAL_TEXT = 4.5;
export const LARGE_TEXT = 3;

/** Relative luminance of an [r, g, b] colour with 0-255 channels. */
export function luminance([r, g, b]) {
    const [lr, lg, lb] = [r, g, b].map(c => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast ratio of two opaque colours, from 1 to 21. */
export function contrastRatio(a, b) {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

/** An [r, g, b, alpha] colour (alpha 0-1) painted over an opaque [r, g, b]. */
export function over([r, g, b, a], under) {
    return [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
}

/** WCAG large text: 24px, or 18.66px (14pt) when bold. */
export function isLargeText({ fontSize, fontWeight }) {
    return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
}

/**
 * The text colour and the background colour as they are seen on screen.
 * `layers` runs from the outermost element to the one holding the text; each has the
 * element's background and its opacity, which fades it and everything inside it into
 * whatever is under it.
 */
export function seenColours({ text, layers, canvas }) {
    const paint = (index, under) => {
        const { background, opacity } = layers[index];
        const own = over(background, under);
        const inner = index === layers.length - 1 ? { background: own, text: over(text, own) } : paint(index + 1, own);
        return {
            background: over([...inner.background, opacity], under),
            text: over([...inner.text, opacity], under)
        };
    };
    return paint(0, canvas);
}

/** Each sample below its WCAG AA minimum, with the ratio it has and the one it needs. */
export function shortfalls(samples) {
    return samples
        .map(sample => {
            const { text, background } = seenColours(sample);
            const needed = isLargeText(sample) ? LARGE_TEXT : NORMAL_TEXT;
            return { ...sample, ratio: contrastRatio(text, background), needed };
        })
        .filter(({ ratio, needed }) => ratio + 0.005 < needed)
        .map(({ where, kind, content, ratio, needed }) => ({
            where,
            kind,
            content,
            ratio: Math.round(ratio * 100) / 100,
            needed
        }));
}

/**
 * Runs in the page. Visible text inside `rootSelectors` (the whole page by default).
 * Disabled controls are left out: WCAG does not ask inactive controls to meet contrast.
 * Text made only of emoji is left out too, as emoji draw in their own colours.
 */
function collectInPage(rootSelectors) {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    // Canvas turns any CSS colour (color-mix, rgba, named) into red, green, blue and alpha.
    const rgba = css => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = '#000';
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
    };
    const darkCanvas =
        matchMedia('(prefers-color-scheme: dark)').matches &&
        /dark/.test(getComputedStyle(document.documentElement).colorScheme);
    const canvas = darkCanvas ? [18, 18, 18] : [255, 255, 255];
    const emojiOnly = /^(?:\s|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f)*$/u;
    const textInputs = /^(text|search|url|email|number|password|tel|)$/;

    const clippedAway = element => {
        const box = element.getBoundingClientRect();
        // Screen-reader-only text is clipped to a 1px box.
        if (box.width <= 1 || box.height <= 1) return true;
        for (let a = element.parentElement; a; a = a.parentElement) {
            const style = getComputedStyle(a);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const clip = a.getBoundingClientRect();
            if (box.right <= clip.left || box.left >= clip.right || box.bottom <= clip.top || box.top >= clip.bottom)
                return true;
        }
        return false;
    };
    const describe = element => {
        const parts = [];
        for (let e = element; e && e !== document.body && parts.length < 3; e = e.parentElement) {
            const classes = [...e.classList]
                .slice(0, 2)
                .map(c => `.${c}`)
                .join('');
            parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${classes}`);
        }
        return parts.join(' > ');
    };
    const layersOf = element => {
        const layers = [];
        for (let e = element; e; e = e.parentElement) {
            const style = getComputedStyle(e);
            layers.unshift({ background: rgba(style.backgroundColor), opacity: +style.opacity });
        }
        return layers;
    };
    const sample = (element, kind, content, style) => {
        const fill = style.webkitTextFillColor;
        return {
            where: describe(element),
            kind,
            content: content.replace(/\s+/g, ' ').trim().slice(0, 40),
            text: rgba(fill && fill !== style.color && kind !== 'placeholder' ? fill : style.color),
            fontSize: parseFloat(style.fontSize),
            fontWeight: +style.fontWeight || 400,
            layers: layersOf(element),
            canvas
        };
    };

    const roots = rootSelectors ? rootSelectors.flatMap(s => [...document.querySelectorAll(s)]) : [document.body];
    const seen = new Set();
    const samples = [];
    for (const root of roots) {
        for (const element of [root, ...root.querySelectorAll('*')]) {
            if (seen.has(element)) continue;
            seen.add(element);
            if (element.closest('svg, script, style, template, noscript, option')) continue;
            if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
            if (element.closest(':disabled')) continue;
            const style = getComputedStyle(element);
            if (+style.opacity === 0) continue;
            const tag = element.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                if (tag === 'INPUT' && !textInputs.test(element.type)) continue;
                if (clippedAway(element)) continue;
                if (element.value) samples.push(sample(element, 'value', element.value, style));
                else if (element.placeholder)
                    samples.push(
                        sample(element, 'placeholder', element.placeholder, getComputedStyle(element, '::placeholder'))
                    );
                continue;
            }
            if (tag === 'SELECT') {
                if (!clippedAway(element))
                    samples.push(sample(element, 'value', element.selectedOptions[0]?.textContent ?? '', style));
                continue;
            }
            const own = [...element.childNodes]
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent)
                .join('');
            if (!own.trim() || emojiOnly.test(own)) continue;
            if (clippedAway(element)) continue;
            samples.push(sample(element, 'text', own, style));
        }
    }
    return samples;
}

/** Runs in the page: jumps running transitions and animations that end to their end, so text
 * is not measured halfway through a fade (a page in the background never plays them). Endless
 * ones, such as the tour's highlight, are left alone. */
function settleInPage() {
    for (const animation of document.getAnimations())
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
}

/** Every visible text sample in the page, or in the elements matching `roots`. */
export async function collectText(page, roots = null) {
    await page.evaluate(settleInPage);
    return page.evaluate(collectInPage, roots);
}

/** The text in the page, or in `roots`, that is below WCAG AA contrast. */
export async function lowContrastText(page, roots = null) {
    return shortfalls(await collectText(page, roots));
}
