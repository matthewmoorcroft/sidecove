// Back, forward and reload for the tab you are looking at. Pure: the keys and the click are
// turned into an action here, and the action is run against the tabs API passed in.

export const NAV_BACK = 'back';
export const NAV_FORWARD = 'forward';
export const NAV_RELOAD = 'reload';

// Command-[, Command-] and Command-R on a Mac; Alt+Left, Alt+Right and Ctrl+R elsewhere. Shift
// with R reloads without the cache, as in Chrome. Shift with a bracket is Chrome's own tab
// switch, so it is not taken. Returns null for any other key, and for a held key so that a
// reload is not repeated.
export function navActionFromKey(event, isMac) {
    if (!event || event.repeat) return null;
    const { code, shiftKey } = event;
    if (isMac) {
        if (!event.metaKey || event.ctrlKey || event.altKey) return null;
        if (!shiftKey && code === 'BracketLeft') return { name: NAV_BACK };
        if (!shiftKey && code === 'BracketRight') return { name: NAV_FORWARD };
    } else {
        if (event.metaKey) return null;
        if (event.altKey && !event.ctrlKey && !shiftKey) {
            if (code === 'ArrowLeft') return { name: NAV_BACK };
            if (code === 'ArrowRight') return { name: NAV_FORWARD };
            return null;
        }
        if (!event.ctrlKey || event.altKey) return null;
    }
    return code === 'KeyR' ? { name: NAV_RELOAD, bypassCache: Boolean(shiftKey) } : null;
}

// A click on a row button. Shift-click on reload skips the cache.
export function navActionFromClick(name, event) {
    if (name === NAV_BACK || name === NAV_FORWARD) return { name };
    if (name === NAV_RELOAD) return { name, bypassCache: Boolean(event?.shiftKey) };
    return null;
}

// Acts on the active tab of this window. Resolves false when there is no such tab or Chrome
// refuses, as goBack does when there is nowhere to go: nothing happens then.
export async function runNavAction(tabs, action) {
    if (!action) return false;
    try {
        const [tab] = await tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) return false;
        if (action.name === NAV_BACK) await tabs.goBack(tab.id);
        else if (action.name === NAV_FORWARD) await tabs.goForward(tab.id);
        else if (action.name === NAV_RELOAD) await tabs.reload(tab.id, { bypassCache: Boolean(action.bypassCache) });
        else return false;
        return true;
    } catch {
        return false;
    }
}
