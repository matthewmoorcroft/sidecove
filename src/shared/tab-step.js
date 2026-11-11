// Next and previous tab in a space, in the order the side panel shows them: the pinned tabs of
// the top bar, then the space's favorites in bookmark order, then its other tabs, which the panel
// reverses when new tabs show at the top. Pure, so the service worker and the unit tests share it.
export function tabsInDisplayOrder(space, { invertTabOrder = false, openTabIds }) {
    const open = id => openTabIds.has(id);
    const favorites = (space?.spaceBookmarks ?? []).filter(open);
    const others = (space?.temporaryTabs ?? []).filter(id => open(id) && !favorites.includes(id));
    if (invertTabOrder) others.reverse();
    return [...favorites, ...others];
}

// The cycle the shortcuts walk. As in Arc, pinned tabs belong to every space's cycle. `pinnedIds`
// are the window's pinned tabs in tab strip order; with separate favorites per space, only the
// space's own pinned tabs count.
export function tabCycleOrder(
    space,
    { pinnedIds = [], perSpaceFavorites = false, invertTabOrder = false, openTabIds }
) {
    const own = new Set(space?.pinnedTabs ?? []);
    const pins = pinnedIds.filter(id => openTabIds.has(id) && (!perSpaceFavorites || own.has(id)));
    const listed = tabsInDisplayOrder(space, { invertTabOrder, openTabIds }).filter(id => !pins.includes(id));
    return [...pins, ...listed];
}

// The tab to activate, wrapping at both ends, or null when there is nowhere to go.
export function adjacentTabId(orderedIds, currentId, direction) {
    const index = orderedIds.indexOf(currentId);
    if (index === -1 || orderedIds.length < 2) return null;
    const step = direction === 'next' ? 1 : -1;
    return orderedIds[(index + step + orderedIds.length) % orderedIds.length];
}
