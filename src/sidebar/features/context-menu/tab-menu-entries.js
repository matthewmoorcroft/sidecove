// The one layout of every tab menu, so the menus of ordinary tabs, pinned tabs, favorites with
// no open tab and tabs in another window cannot drift apart. Pure: callers hand in what is known
// about the tab and the actions to run, and get showMenu entries back.
//
// Four groups, always in this order, with a separator between the groups that are present:
//   link    Copy Link
//   edit    Rename Tab, Mute Tab, Replace Bookmark URL with Current URL
//   arrange Add to Favorites, Pin Tab, split view, Duplicate Tab, Move to Space
//   close   Close Tab, Archive Tab, then the type's own removal: Unpin Tab or Remove Bookmark
export const MENU_GROUPS = ['link', 'edit', 'arrange', 'close'];

// Every item a tab menu can hold, by group and in the order it appears.
export const MENU_ITEMS = {
    link: ['copyLink'],
    edit: ['rename', 'mute', 'replaceUrl'],
    arrange: ['addToFavorites', 'pin', 'split', 'duplicate', 'moveToSpace'],
    close: ['close', 'archive', 'unpin', 'removeBookmark']
};

// Which items each kind of row can offer. An item is left out where it would do something the
// row cannot: a favorite with no open tab has no tab to mute, rename, duplicate, close or archive,
// and a tab in another window cannot be pinned, duplicated or archived from here.
// Split view stays with ordinary tabs: Chrome pairs adjacent unpinned tabs of one window, and
// pinned rows live in a section of their own.
export const MENU_KINDS = {
    tab: [
        'copyLink',
        'rename',
        'mute',
        'addToFavorites',
        'pin',
        'split',
        'duplicate',
        'moveToSpace',
        'close',
        'archive'
    ],
    pinned: [
        'copyLink',
        'rename',
        'mute',
        'replaceUrl',
        'addToFavorites',
        'duplicate',
        'moveToSpace',
        'close',
        'archive',
        'unpin'
    ],
    saved: ['copyLink', 'moveToSpace', 'removeBookmark'],
    otherWindow: ['copyLink', 'rename', 'mute', 'moveToSpace', 'close']
};

/**
 * The menu as groups: [{ group, entries }], empty groups left out.
 *   kind          'tab', 'pinned', 'saved' or 'otherWindow' (see MENU_KINDS)
 *   muted         the tab's live mute state
 *   splitEntries  entries from the split view feature
 *   moveEntries   the Move to Space submenu entries; no entry when there are none
 *   actions       copyLink, rename, setMuted(value), replaceUrl, addToFavorites, togglePin,
 *                 duplicate, close, archive, removeBookmark. An item with no action is left out.
 */
export function tabMenuGroups({ kind, muted = false, splitEntries = [], moveEntries = [], actions }) {
    const allowed = new Set(MENU_KINDS[kind]);
    const items = {
        copyLink: { label: 'Copy Link', action: actions.copyLink },
        rename: { label: 'Rename Tab', action: actions.rename },
        mute: {
            label: muted ? 'Unmute Tab' : 'Mute Tab',
            action: actions.setMuted && (() => actions.setMuted(!muted))
        },
        replaceUrl: { label: 'Replace Bookmark URL with Current URL', action: actions.replaceUrl },
        addToFavorites: { label: 'Add to Favorites', action: actions.addToFavorites },
        pin: { label: 'Pin Tab', action: actions.togglePin },
        duplicate: { label: 'Duplicate Tab', action: actions.duplicate },
        close: { label: 'Close Tab', action: actions.close },
        archive: { label: 'Archive Tab', action: actions.archive },
        unpin: { label: 'Unpin Tab', action: actions.togglePin },
        removeBookmark: { label: 'Remove Bookmark', action: actions.removeBookmark }
    };
    const built = {};
    for (const id of allowed) {
        if (items[id]?.action) built[id] = [{ id, ...items[id] }];
    }
    if (allowed.has('split') && splitEntries.length)
        built.split = splitEntries.map(entry => ({ id: 'split', ...entry }));
    if (allowed.has('moveToSpace') && moveEntries.length) {
        built.moveToSpace = [{ id: 'moveToSpace', label: 'Move to Space', submenu: moveEntries }];
    }

    return MENU_GROUPS.map(group => ({
        group,
        entries: MENU_ITEMS[group].flatMap(id => built[id] ?? [])
    })).filter(({ entries }) => entries.length);
}

// The same menu as one list for showMenu, a separator between groups.
export function tabMenuEntries(options) {
    return tabMenuGroups(options).flatMap(({ entries }, index) => (index ? ['separator', ...entries] : entries));
}
