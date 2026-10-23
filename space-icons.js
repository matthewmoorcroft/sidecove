/**
 * Space icons - the emoji or character that marks a space, as in Arc.
 *
 * Icons let the switcher shrink to compact chips when there are more spaces than fit.
 */

export const SPACE_ICON_CHOICES = [
    '🏠', '💼', '🎵', '📚', '✈️', '💰', '🛠️', '📷',
    '🎮', '🍳', '🏃', '🎨', '💡', '🧪', '🌱', '⭐',
    '❤️', '🔥', '🚀', '🎓', '🛒', '📰', '🗂️', '🐾'
];

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = text => segmenter ? [...segmenter.segment(text)].map(s => s.segment) : Array.from(text);

// One visible character (an emoji with modifiers counts as one), or null.
export function normalizeSpaceIcon(value) {
    const text = String(value ?? '').trim();
    if (!text || /[\u0000-\u001f\u007f]/.test(text)) return null;
    return graphemes(text).length === 1 ? text : null;
}

export function spaceInitial(name) {
    const first = graphemes(String(name ?? '').trim())[0];
    return first ? first.toLocaleUpperCase() : '?';
}
