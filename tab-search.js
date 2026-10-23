/**
 * Tab search - rank open tabs and favorites for the sidebar's search box.
 *
 * Runs entirely in the side panel over titles and URLs the extension already has; nothing
 * is sent anywhere. Every word of the query must appear in the title or URL.
 */

const fold = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function wordScore(word, title, url) {
    if (title.startsWith(word)) return 4;
    if (new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) return 3;
    if (title.includes(word)) return 2;
    if (url.includes(word)) return 1;
    return 0;
}

export function searchEntries(query, entries, { currentSpaceId = null, limit = 20 } = {}) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    entries.forEach((entry, index) => {
        const title = fold(entry.title);
        const url = fold(entry.url);
        let score = 0;
        for (const word of words) {
            const value = wordScore(word, title, url);
            if (!value) return;
            score += value;
        }
        scored.push({ entry, score, index });
    });
    scored.sort((a, b) =>
        b.score - a.score
        || (b.entry.spaceId === currentSpaceId) - (a.entry.spaceId === currentSpaceId)
        || (a.entry.kind === 'favorite') - (b.entry.kind === 'favorite')
        || a.index - b.index);
    return scored.slice(0, limit).map(item => item.entry);
}
