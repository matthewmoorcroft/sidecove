/**
 * Space icons - what marks a space in the space bar, as in Arc: a monochrome symbol
 * (stored as "symbol:<name>"), an emoji, or any single character.
 */

import { SPACE_SYMBOLS } from './space-symbols.js';

export { SPACE_SYMBOLS };
export const SYMBOL_PREFIX = 'symbol:';

export const SPACE_ICON_CHOICES = [
    '🏠', '💼', '🎵', '📚', '✈️', '💰', '🛠️', '📷',
    '🎮', '🍳', '🏃', '🎨', '💡', '🧪', '🌱', '⭐',
    '❤️', '🔥', '🚀', '🎓', '🛒', '📰', '🗂️', '🐾'
];

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = text => segmenter ? [...segmenter.segment(text)].map(s => s.segment) : Array.from(text);

// Words for each emoji choice, so a search for "music" finds 🎵.
const EMOJI_KEYWORDS = {
    '🏠': 'home house', '💼': 'work job briefcase office', '🎵': 'music song note', '📚': 'books reading study library',
    '✈️': 'travel plane flight trip', '💰': 'money finance bank', '🛠️': 'tools build fix', '📷': 'camera photos pictures',
    '🎮': 'games gaming play', '🍳': 'cooking food recipes kitchen', '🏃': 'running fitness sport exercise', '🎨': 'art design paint',
    '💡': 'ideas light inspiration', '🧪': 'science lab experiment test', '🌱': 'garden plant nature growth', '⭐': 'star favourite favorite',
    '❤️': 'heart love', '🔥': 'fire hot trending', '🚀': 'rocket launch startup project', '🎓': 'school education learning university',
    '🛒': 'shopping cart buy store', '📰': 'news newspaper reading', '🗂️': 'files folders organise organize', '🐾': 'pets animals dog cat'
};

// A symbol's stored name, or null.
export function spaceSymbol(icon) {
    if (typeof icon !== 'string' || !icon.startsWith(SYMBOL_PREFIX)) return null;
    return SPACE_SYMBOLS.find(symbol => symbol.name === icon.slice(SYMBOL_PREFIX.length)) || null;
}

// A known symbol, or one visible character (an emoji with modifiers counts as one), or null.
export function normalizeSpaceIcon(value) {
    const text = String(value ?? '').trim();
    if (spaceSymbol(text)) return text;
    if (!text || /[\u0000-\u001f\u007f]/.test(text)) return null;
    return graphemes(text).length === 1 ? text : null;
}

// Whether text is a single emoji, as opposed to a letter or a word to search for.
export function isTypedEmoji(text) {
    const icon = normalizeSpaceIcon(text);
    return Boolean(icon) && !spaceSymbol(icon) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(icon);
}

// Symbols and emoji whose names or keywords start with every word of the query; all of
// them for an empty query.
export function searchSpaceIcons(query) {
    const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const matches = terms => words.every(word => terms.some(term => term.startsWith(word)));
    const symbolTerms = symbol => [symbol.name, ...symbol.name.split('-'), ...symbol.label.toLowerCase().split(' '), ...symbol.tags];
    return {
        symbols: SPACE_SYMBOLS.filter(symbol => matches(symbolTerms(symbol))).map(symbol => SYMBOL_PREFIX + symbol.name),
        emoji: SPACE_ICON_CHOICES.filter(emoji => matches((EMOJI_KEYWORDS[emoji] || '').split(' ')))
    };
}
