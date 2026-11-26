// The archive list: entries { url, name, spaceId, archivedAt }, newest first, at most
// MAX_ARCHIVED_TABS of them. Pure, so the rules can be tested without Chrome.
export const MAX_ARCHIVED_TABS = 100;

// The list with the entry added, and whether a new entry was stored. One page is archived once.
export function addEntry(list, entry, archivedAt) {
    if (!entry?.url || !entry.name || !entry.spaceId) return { list, stored: false };
    if (list.some(t => t.url === entry.url)) return { list, stored: false };
    const next = [...list, { ...entry, archivedAt }].sort((a, b) => b.archivedAt - a.archivedAt);
    // Over the limit, the oldest entries go.
    return { list: next.slice(0, MAX_ARCHIVED_TABS), stored: true };
}

export function removeEntry(list, url, spaceId) {
    return list.filter(t => !(t.url === url && t.spaceId === spaceId));
}
