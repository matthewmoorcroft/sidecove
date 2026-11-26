// The archive list: entries { url, name, spaceId, archivedAt }, newest first, at most
// MAX_ARCHIVED_TABS of them. Pure, so the rules can be tested without Chrome.
export const MAX_ARCHIVED_TABS = 100;

// The list with the entry added; `stored` says a new entry was added, and `archived` that the
// list now has an entry to restore the page to its space, new or already there. Each space
// keeps its own entry for a page, so archiving it from a second space loses neither.
export function addEntry(list, entry, archivedAt) {
    if (!entry?.url || !entry.name || !entry.spaceId) return { list, stored: false, archived: false };
    if (list.some(t => t.url === entry.url && t.spaceId === entry.spaceId))
        return { list, stored: false, archived: true };
    const next = [...list, { ...entry, archivedAt }].sort((a, b) => b.archivedAt - a.archivedAt);
    // Over the limit, the oldest entries go.
    return { list: next.slice(0, MAX_ARCHIVED_TABS), stored: true, archived: true };
}

export function removeEntry(list, url, spaceId) {
    return list.filter(t => !(t.url === url && t.spaceId === spaceId));
}
