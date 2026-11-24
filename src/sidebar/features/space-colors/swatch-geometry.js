// Geometry of the swatch grid and its name tip. Pure, no DOM.

// How far to move a name tip spanning left to right so it stays between minX and maxX (the
// edges of whatever clips it), with a small margin; 0 when it already fits. A tip wider than
// that keeps its left edge in view.
export function tipShift(left, right, minX, maxX, margin = 4) {
    if (right > maxX - margin) return Math.max(minX + margin - left, maxX - margin - right);
    if (left < minX + margin) return minX + margin - left;
    return 0;
}

// Where an arrow key moves focus in a grid of count swatches, columns wide; null for other keys.
export function arrowTarget(index, key, columns, count) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -index }[key];
    if (key === 'End') return count - 1;
    if (step === undefined) return null;
    const next = index + step;
    return next >= 0 && next < count ? next : index;
}
