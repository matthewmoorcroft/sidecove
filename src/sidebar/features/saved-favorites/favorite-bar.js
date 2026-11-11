// What the top bar shows with saved favorites: each saved favorite, live where this window has a
// pinned tab for it and dimmed (`tab: null`) where it does not, then this window's pins the worker
// has not saved yet, so a pin never goes missing while it catches up. With separate favorites per
// space, only the space's favorites and pins show.
export function favoriteBarItems({
    favorites = [],
    records = [],
    pins = [],
    windowId,
    perSpace = false,
    spaceId = null,
    spaceTabIds = new Set()
}) {
    const here = new Map(pins.filter(tab => tab.windowId === windowId).map(tab => [tab.id, tab]));
    const items = favorites
        .filter(favorite => !perSpace || favorite.spaceId === spaceId)
        .map(favorite => {
            const record = records.find(r => r.favoriteId === favorite.id && here.has(r.tabId));
            return { favorite, tab: record ? here.get(record.tabId) : null };
        });
    const bound = new Set(records.map(record => record.tabId));
    const unsaved = [...here.values()]
        .filter(tab => !bound.has(tab.id) && (!perSpace || spaceTabIds.has(tab.id)))
        .sort((a, b) => a.index - b.index)
        .map(tab => ({ favorite: null, tab }));
    return [...items, ...unsaved];
}

// The favorite a drop into the bar lands before: the one the indicator is left of, else the next
// one after it, else none (the end).
export function favoriteIdBefore(afterElement, position) {
    if (!afterElement?.classList.contains('pinned-favicon')) return null;
    let element = position === 'left' ? afterElement : afterElement.nextElementSibling;
    while (element && (!element.classList.contains('pinned-favicon') || element.classList.contains('dragging')))
        element = element.nextElementSibling;
    return element?.dataset.favoriteId || null;
}
