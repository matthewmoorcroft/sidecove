/**
 * Space navigation - pure helpers for switching spaces from keys, commands and the chip strip.
 *
 * Kept free of DOM and extension globals so the sidebar, the service worker and the unit
 * tests share one definition of which space a shortcut means.
 */

export const SPACE_SHORTCUT_SLOTS = 9;

// Manifest command names. They have no default keys: Chrome allows only four suggested
// shortcuts per extension, so people assign these in chrome://extensions/shortcuts.
export function parseSpaceCommand(command) {
    if (command === 'NextSpace') return { delta: 1 };
    if (command === 'PrevSpace') return { delta: -1 };
    const match = /^SwitchToSpace([1-9])$/.exec(command || '');
    return match ? { slot: Number(match[1]) } : null;
}

// Ctrl+1 to Ctrl+8 pick that space and Ctrl+9 the last one, as in Arc and Chrome's tab strip.
// Ctrl+Shift+[ and Ctrl+Shift+] step back and forward. Only plain Ctrl, so Cmd and Alt
// shortcuts keep their browser meaning.
export function spaceRequestFromKey(event) {
    if (!event?.ctrlKey || event.metaKey || event.altKey) return null;
    if (event.shiftKey) {
        if (event.code === 'BracketLeft') return { delta: -1 };
        if (event.code === 'BracketRight') return { delta: 1 };
        return null;
    }
    const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || '');
    return match ? { slot: Number(match[1]) } : null;
}

// Resolve a request ({ delta } or { slot }) to a space id, or null when nothing changes.
export function resolveSpaceTarget(spaces, activeSpaceId, request) {
    if (!request || !spaces?.length) return null;
    const currentIndex = spaces.findIndex(space => space.id === activeSpaceId);
    let index;
    if (request.slot) {
        if (request.slot === SPACE_SHORTCUT_SLOTS) index = spaces.length - 1;
        else if (request.slot > spaces.length) return null;
        else index = request.slot - 1;
    } else if (request.delta) {
        if (currentIndex === -1) index = request.delta > 0 ? 0 : spaces.length - 1;
        else index = (currentIndex + request.delta + spaces.length) % spaces.length;
    } else {
        return null;
    }
    const target = spaces[index];
    return target && target.id !== activeSpaceId ? target.id : null;
}

// Horizontal scroll position that shows an item inside a scrolling strip. The insets keep
// the item clear of overlays at either edge (the add-space button covers the right end).
export function scrollLeftToReveal({ scrollLeft, viewWidth, itemLeft, itemWidth, startInset = 0, endInset = 0 }) {
    const visibleStart = scrollLeft + startInset;
    const visibleEnd = scrollLeft + viewWidth - endInset;
    if (itemLeft < visibleStart) return Math.max(0, itemLeft - startInset);
    if (itemLeft + itemWidth > visibleEnd) return itemLeft + itemWidth - viewWidth + endInset;
    return scrollLeft;
}

/**
 * Switch the space of a window when its sidebar is closed. The panel normally handles the
 * command itself; this keeps the shortcut useful without it by activating the target
 * space's last tab, or only recording the space for new tabs when it has none.
 */
export async function switchSpaceWithoutSidebar({ chromeApi, dispatch, windowId, request }) {
    const spaces = await dispatch({ action: 'get' });
    const [activeTab] = await chromeApi.tabs.query({ active: true, windowId });
    const { activeSpaces = {} } = await chromeApi.storage.session.get('activeSpaces');
    const owner = activeTab && spaces.find(space =>
        [...space.spaceBookmarks, ...space.temporaryTabs].includes(activeTab.id));
    const currentId = owner?.id || activeSpaces[windowId] || spaces[0]?.id;
    const targetId = resolveSpaceTarget(spaces, currentId, request);
    if (!targetId) return null;
    const target = spaces.find(space => space.id === targetId);
    await dispatch({ action: 'activate', windowId, spaceId: targetId });
    const windowTabs = new Set((await chromeApi.tabs.query({ windowId })).filter(tab => !tab.pinned).map(tab => tab.id));
    const owned = [...target.spaceBookmarks, ...target.temporaryTabs].filter(id => windowTabs.has(id));
    const tabId = owned.includes(target.lastTab) ? target.lastTab : owned[owned.length - 1];
    if (tabId) await chromeApi.tabs.update(tabId, { active: true });
    return targetId;
}
