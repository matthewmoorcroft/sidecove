import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LARGE_TEXT,
    NORMAL_TEXT,
    contrastRatio,
    isLargeText,
    luminance,
    over,
    seenColours,
    shortfalls
} from '../../../e2e/helpers/contrast.js';

const opaque = (r, g, b) => ({ background: [r, g, b, 1], opacity: 1 });
const clear = { background: [0, 0, 0, 0], opacity: 1 };
const sample = overrides => ({
    where: 'div',
    kind: 'text',
    content: 'Text',
    text: [236, 239, 241, 1],
    fontSize: 13,
    fontWeight: 400,
    layers: [opaque(37, 45, 48)],
    canvas: [255, 255, 255],
    ...overrides
});

test('luminance and contrast follow WCAG: black on white is 21:1, a colour on itself 1:1', () => {
    assert.equal(luminance([0, 0, 0]), 0);
    assert.equal(luminance([255, 255, 255]), 1);
    assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
    assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
    assert.equal(contrastRatio([80, 80, 80], [80, 80, 80]), 1);
    // #767676 is the lightest grey that passes 4.5:1 on white.
    assert.ok(contrastRatio([118, 118, 118], [255, 255, 255]) >= 4.5);
    assert.ok(contrastRatio([119, 119, 119], [255, 255, 255]) < 4.5);
});

test('a translucent colour is painted over what is under it', () => {
    assert.deepEqual(over([255, 255, 255, 0.5], [0, 0, 0]), [127.5, 127.5, 127.5]);
    assert.deepEqual(over([10, 20, 30, 1], [0, 0, 0]), [10, 20, 30]);
    assert.deepEqual(over([10, 20, 30, 0], [1, 2, 3]), [1, 2, 3]);
});

test('large text is 24px, or 18.66px when bold', () => {
    assert.equal(isLargeText({ fontSize: 24, fontWeight: 400 }), true);
    assert.equal(isLargeText({ fontSize: 23, fontWeight: 400 }), false);
    assert.equal(isLargeText({ fontSize: 19, fontWeight: 700 }), true);
    assert.equal(isLargeText({ fontSize: 19, fontWeight: 600 }), false);
});

test('backgrounds stack from the outermost element in, over the page canvas', () => {
    const { background } = seenColours(
        sample({ layers: [clear, opaque(0, 0, 0), { background: [255, 255, 255, 0.3], opacity: 1 }] })
    );
    assert.deepEqual(background, [76.5, 76.5, 76.5]);
    // Nothing painted: the text sits on the canvas.
    assert.deepEqual(seenColours(sample({ layers: [clear] })).background, [255, 255, 255]);
});

test('opacity fades an element and everything in it into what is under it', () => {
    const { text, background } = seenColours(
        sample({
            text: [255, 255, 255, 1],
            layers: [opaque(0, 0, 0), { background: [0, 0, 0, 0], opacity: 0.5 }]
        })
    );
    assert.deepEqual(background, [0, 0, 0]);
    assert.deepEqual(text, [127.5, 127.5, 127.5]);
});

test('shortfalls lists only text under its minimum, with the ratio it has and the one it needs', () => {
    const grey = [117, 117, 117, 1];
    const found = shortfalls([
        sample({ content: 'Readable' }),
        sample({ kind: 'placeholder', content: 'Untitled', text: grey }),
        sample({ content: 'Big', text: grey, layers: [opaque(0, 0, 0)], fontSize: 24 })
    ]);
    assert.deepEqual(
        found.map(({ content, needed }) => ({ content, needed })),
        [{ content: 'Untitled', needed: NORMAL_TEXT }]
    );
    assert.equal(found[0].ratio, Math.round(contrastRatio([117, 117, 117], [37, 45, 48]) * 100) / 100);
    assert.equal(LARGE_TEXT, 3);
});
