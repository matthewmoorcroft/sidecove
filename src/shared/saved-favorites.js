// Saved favorites: with "Show tabs and favorites from all windows" on, the top-bar favorites are
// one saved list shown in every window, like a space's pinned tabs. A favorite needs no open tab;
// where a window has no pinned tab for it, it shows dimmed there and opens when picked. The
// service worker is the only writer. Nothing here touches chrome.* or the DOM.
//
// State, kept in chrome.storage.local:
//   favorites: [{ id, url, title, spaceId }] in top-bar order. `url` is the page saved, which a
//     tab can browse away from. `spaceId` is the space it belongs to with separate favorites.
//   tabs: [{ tabId, favoriteId, windowId, url }], the pinned tabs that stand for a favorite, at
//     most one per window. `url` is the tab's latest page, to recognise it after a restart.
//   restore: [{ favoriteId, url }], closed tabs (or last session's) that Chrome may bring back,
//     under the page they last showed.

export const ALL_WINDOWS_SETTING = 'showTabsFromAllWindows';
export const SAVED_FAVORITES_KEY = 'savedFavorites';
export const FAVORITE_TABS_KEY = 'favoriteTabs';
export const FAVORITE_RESTORE_KEY = 'favoriteRestore';
export const SAVED_FAVORITES_MESSAGE = 'savedFavorites';

const RESTORE_LIMIT = 100;

// The page a tab shows.
export const pageOf = tab => tab?.url || tab?.pendingUrl || '';

export const stateFrom = stored => ({
    favorites: stored?.[SAVED_FAVORITES_KEY] || [],
    tabs: stored?.[FAVORITE_TABS_KEY] || [],
    restore: stored?.[FAVORITE_RESTORE_KEY] || []
});

export const favoriteOfTab = (state, tabId) => state.tabs.find(record => record.tabId === tabId)?.favoriteId ?? null;
export const tabsOfFavorite = (state, favoriteId) =>
    state.tabs.filter(record => record.favoriteId === favoriteId).map(record => record.tabId);

const hasTabIn = (state, favoriteId, windowId) =>
    state.tabs.some(record => record.favoriteId === favoriteId && record.windowId === windowId);

// Makes `tab` stand for `favoriteId`.
export function bindTab(state, tab, favoriteId) {
    const tabs = state.tabs.filter(record => record.tabId !== tab.id);
    tabs.push({ tabId: tab.id, favoriteId, windowId: tab.windowId, url: pageOf(tab) });
    return { ...state, tabs };
}

// A pinned tab in a normal window. A tab already standing for a favorite keeps it and refreshes
// its window, page and, while on the saved page (or while the favorite has no name yet), the title.
// Otherwise it takes the favorite it was before it closed or Chrome restarted, else a favorite
// saved on its page that has no tab in its window yet, else it becomes a new favorite at the end
// (unless `add` is false). So the same page pinned in two windows is one favorite, and binding the
// same pins again changes nothing. With separate favorites per space (`perSpace`), only a favorite
// of the tab's own space is joined, so the same page in two spaces stays two favorites.
export function bindPin(state, tab, { spaceId = null, perSpace = false, add = true, newId }) {
    const url = pageOf(tab);
    const known = state.tabs.find(record => record.tabId === tab.id);
    // A tab moved into a window that already has one for its favorite starts again, as a window
    // shows each favorite once.
    const twin =
        known &&
        state.tabs.some(r => r.tabId !== tab.id && r.favoriteId === known.favoriteId && r.windowId === tab.windowId);
    if (known && !twin) {
        const tabs = state.tabs.map(record =>
            record.tabId === tab.id ? { ...record, windowId: tab.windowId, url: url || record.url } : record
        );
        const favorites = state.favorites.map(favorite =>
            favorite.id === known.favoriteId &&
            tab.title &&
            (url === favorite.url || favorite.title === favorite.url) &&
            tab.title !== favorite.title
                ? { ...favorite, title: tab.title }
                : favorite
        );
        return { ...state, favorites, tabs };
    }
    if (twin) state = { ...state, tabs: state.tabs.filter(record => record.tabId !== tab.id) };
    if (!url) return state;
    const free = id => {
        const favorite = state.favorites.find(f => f.id === id);
        if (!favorite || hasTabIn(state, id, tab.windowId)) return false;
        return !perSpace || !spaceId || !favorite.spaceId || favorite.spaceId === spaceId;
    };
    const restoredAt = state.restore.findIndex(record => record.url === url && free(record.favoriteId));
    if (restoredAt >= 0) {
        const { favoriteId } = state.restore[restoredAt];
        return bindTab({ ...state, restore: state.restore.filter((_, i) => i !== restoredAt) }, tab, favoriteId);
    }
    const saved = state.favorites.find(favorite => favorite.url === url && free(favorite.id));
    if (saved) return bindTab(state, tab, saved.id);
    if (!add) return state;
    const favorite = { id: newId(), url, title: tab.title || url, spaceId };
    return bindTab({ ...state, favorites: [...state.favorites, favorite] }, tab, favorite.id);
}

// A tab that stood for a favorite closed: the favorite stays. Chrome can reopen the tab (or its
// window), and it is recognised by the page it last showed then.
export function unbindTab(state, tabId) {
    const record = state.tabs.find(r => r.tabId === tabId);
    if (!record) return state;
    const restore = [...state.restore, { favoriteId: record.favoriteId, url: record.url }].slice(-RESTORE_LIMIT);
    return { ...state, tabs: state.tabs.filter(r => r.tabId !== tabId), restore };
}

export function removeFavorite(state, favoriteId) {
    return {
        favorites: state.favorites.filter(favorite => favorite.id !== favoriteId),
        tabs: state.tabs.filter(record => record.favoriteId !== favoriteId),
        restore: state.restore.filter(record => record.favoriteId !== favoriteId)
    };
}

export function replaceTab(state, addedId, removedId) {
    return {
        ...state,
        tabs: state.tabs.map(record => (record.tabId === removedId ? { ...record, tabId: addedId } : record))
    };
}

// A window shows only some favorites (its space's, with separate favorites per space), so the
// shown ones swap places among themselves and the others keep where they are.
export function reorderFavorites(state, ids) {
    const order = [...new Set(ids)].filter(id => state.favorites.some(favorite => favorite.id === id));
    const shown = new Set(order);
    const byId = new Map(state.favorites.map(favorite => [favorite.id, favorite]));
    let next = 0;
    const favorites = state.favorites.map(favorite => (shown.has(favorite.id) ? byId.get(order[next++]) : favorite));
    return { ...state, favorites };
}

// Moves a favorite to just before another, or to the end when `beforeId` is not a favorite.
export function placeFavorite(state, favoriteId, beforeId) {
    const moving = state.favorites.find(favorite => favorite.id === favoriteId);
    if (!moving || favoriteId === beforeId) return state;
    const favorites = state.favorites.filter(favorite => favorite.id !== favoriteId);
    const at = favorites.findIndex(favorite => favorite.id === beforeId);
    favorites.splice(at < 0 ? favorites.length : at, 0, moving);
    return { ...state, favorites };
}

// After a browser restart tab IDs start again, so last session's tabs can only be recognised by
// the page they showed.
export function startSession(state) {
    const previous = state.tabs.map(({ favoriteId, url }) => ({ favoriteId, url }));
    return { ...state, tabs: [], restore: [...state.restore, ...previous].slice(-RESTORE_LIMIT) };
}

// Brings the list up to date with the pins open now: forgets tabs that are gone or no longer
// pinned, then binds every pin, window by window in tab strip order. Run when the setting is on at
// startup, this is also the migration: today's favorites become the saved list, once each.
export function reconcilePins(state, pins, { spaceOf = () => null, ...options }) {
    const live = new Set(pins.map(tab => tab.id));
    let next = { ...state, tabs: state.tabs.filter(record => live.has(record.tabId)) };
    const ordered = [...pins].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
    for (const tab of ordered) next = bindPin(next, tab, { ...options, spaceId: spaceOf(tab.id) });
    return next;
}

// Where to put a new pinned tab for a favorite in a window so this window's pins follow the
// saved order: after the pins of every favorite saved before it.
export function pinIndexFor(state, favoriteId, windowPins) {
    const rank = new Map(state.favorites.map((favorite, index) => [favorite.id, index]));
    const own = rank.get(favoriteId) ?? Infinity;
    return windowPins.filter(tab => (rank.get(favoriteOfTab(state, tab.id)) ?? Infinity) < own).length;
}

// Each favorite follows the space of its pinned tab, so moving a favorite's tab to another space
// moves the favorite. When its tabs disagree, the one that moved wins and the others are moved
// to match (`moves`). A favorite with no tab whose space was deleted goes to the first space.
export function followSpaces(state, spaces, ownerOf) {
    const valid = new Set(spaces.map(space => space.id));
    const moves = [];
    const favorites = state.favorites.map(favorite => {
        const owners = tabsOfFavorite(state, favorite.id)
            .map(tabId => ({ tabId, spaceId: ownerOf(tabId) }))
            .filter(owner => owner.spaceId);
        const moved = owners.find(owner => owner.spaceId !== favorite.spaceId);
        let spaceId = moved ? moved.spaceId : favorite.spaceId;
        if (!owners.length && !valid.has(spaceId)) spaceId = spaces[0]?.id ?? null;
        for (const owner of owners) if (owner.spaceId !== spaceId) moves.push({ tabId: owner.tabId, spaceId });
        return spaceId === favorite.spaceId ? favorite : { ...favorite, spaceId };
    });
    return { state: { ...state, favorites }, moves };
}
