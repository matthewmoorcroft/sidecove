import {
    ALL_WINDOWS_SETTING,
    FAVORITE_RESTORE_KEY,
    FAVORITE_TABS_KEY,
    SAVED_FAVORITES_KEY,
    SAVED_FAVORITES_MESSAGE,
    bindPin,
    bindTab,
    favoriteOfTab,
    followSpaces,
    pinIndexFor,
    placeFavorite,
    reconcilePins,
    removeFavorite,
    reorderFavorites,
    replaceTab,
    startSession,
    stateFrom,
    tabsOfFavorite,
    unbindTab
} from '../shared/saved-favorites.js';
import { ownerOf } from '../shared/space-membership.js';
import { Logger } from '../shared/logger.js';

// Marks this browser session, so a worker that wakes again does not take its own tab IDs for a
// restart's.
const SESSION_KEY = 'savedFavoritesSession';
// Chrome reports a pinned tab as unpinned just before it closes, so an unpin only counts once
// the tab is seen still open after this long.
export const UNPIN_SETTLE_MS = 150;

// Keeps the saved favorites list (see shared/saved-favorites.js) while the all-windows setting is
// on. With it off, no favorite is added, so nothing is migrated and the panels draw today's bar;
// unpinning or closing a favorite's tab is still noted, so the list is right when it is turned on.
export function registerSavedFavorites({
    chrome,
    spaceStore,
    newId = () => crypto.randomUUID(),
    schedule = setTimeout
}) {
    let state;
    let enabled = false;
    let written = '';
    let loading;
    let chain = Promise.resolve();

    const run = operation => {
        const pending = chain.then(async () => {
            await (loading ||= load());
            await operation();
            await save();
        });
        chain = pending.catch(error => Logger.error('Saved favorites update failed:', error));
        return pending;
    };

    const stored = keys => chrome.storage.local.get(keys);
    const pageOfTab = tab => tab.url || tab.pendingUrl || '';
    // Sidecove's own pages are never saved, as they are never in a space.
    const savable = tab => !tab.incognito && !pageOfTab(tab).startsWith(chrome.runtime.getURL(''));
    const spacesNow = async () => (await stored('spaces')).spaces || [];

    async function load() {
        state = stateFrom(await stored([SAVED_FAVORITES_KEY, FAVORITE_TABS_KEY, FAVORITE_RESTORE_KEY]));
        written = JSON.stringify(state);
        if (!(await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY]) {
            state = startSession(state);
            await chrome.storage.session.set({ [SESSION_KEY]: true });
        }
        const settings = await chrome.storage.sync.get({ [ALL_WINDOWS_SETTING]: true });
        enabled = settings[ALL_WINDOWS_SETTING] !== false;
        if (enabled) await reconcile();
    }

    async function save() {
        const json = JSON.stringify(state);
        if (json === written) return;
        written = json;
        await chrome.storage.local.set({
            [SAVED_FAVORITES_KEY]: state.favorites,
            [FAVORITE_TABS_KEY]: state.tabs,
            [FAVORITE_RESTORE_KEY]: state.restore
        });
    }

    async function reconcile() {
        const spaces = await spacesNow();
        const pins = (await chrome.tabs.query({ pinned: true })).filter(savable);
        state = reconcilePins(state, pins, { spaceOf: id => ownerOf(spaces, id)?.id ?? null, newId });
    }

    async function bind(tab) {
        if (!enabled || !tab.pinned || !savable(tab)) return;
        const spaces = await spacesNow();
        state = bindPin(state, tab, { spaceId: ownerOf(spaces, tab.id)?.id ?? null, newId });
    }

    // Removing a favorite removes it from every window, so its tabs elsewhere are unpinned too;
    // otherwise they would be saved again as new favorites. With the setting off, other windows'
    // pins are left alone, as before.
    async function remove(favoriteId, exceptTabId = null) {
        const others = tabsOfFavorite(state, favoriteId).filter(id => id !== exceptTabId);
        state = removeFavorite(state, favoriteId);
        if (!enabled) return;
        await Promise.all(others.map(id => chrome.tabs.update(id, { pinned: false }).catch(() => {})));
    }

    async function followSpaceChanges() {
        const spaces = await spacesNow();
        if (!spaces.length) return;
        const result = followSpaces(state, spaces, id => ownerOf(spaces, id)?.id ?? null);
        state = result.state;
        for (const { tabId, spaceId } of result.moves)
            await spaceStore.dispatch({ action: 'assignPin', tabId, spaceId });
    }

    // Picking a favorite opens it in the window you are in, pinned and in its space, and never
    // moves or focuses another window's tab.
    async function open(favoriteId, windowId) {
        const favorite = state.favorites.find(f => f.id === favoriteId);
        if (!favorite) throw new Error('That favorite is no longer saved');
        const here = state.tabs.find(r => r.favoriteId === favoriteId && r.windowId === windowId);
        if (here) {
            await chrome.tabs.update(here.tabId, { active: true });
            return;
        }
        const pins = await chrome.tabs.query({ windowId, pinned: true });
        const tab = await chrome.tabs.create({
            windowId,
            url: favorite.url,
            pinned: true,
            active: true,
            index: pinIndexFor(state, favoriteId, pins)
        });
        state = bindTab(state, { ...tab, url: favorite.url }, favoriteId);
        if ((await spacesNow()).some(space => space.id === favorite.spaceId))
            await spaceStore.dispatch({ action: 'assignPin', tabId: tab.id, spaceId: favorite.spaceId });
    }

    async function handle(message) {
        switch (message.action) {
            case 'open':
                return open(message.favoriteId, message.windowId);
            case 'remove':
                return remove(message.favoriteId);
            case 'reorder':
                state = reorderFavorites(state, message.ids || []);
                return;
            case 'place': {
                // A tab dropped into the top bar: save it there now rather than at the end.
                await bind(await chrome.tabs.get(message.tabId));
                const favoriteId = favoriteOfTab(state, message.tabId);
                if (favoriteId) state = placeFavorite(state, favoriteId, message.beforeId);
                return;
            }
            default:
                throw new Error('Unknown saved favorites action');
        }
    }

    chrome.tabs.onCreated.addListener(tab => {
        if (tab.pinned) run(() => bind(tab));
    });
    chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
        if (change.pinned === false)
            schedule(
                () =>
                    run(async () => {
                        const favoriteId = favoriteOfTab(state, tabId);
                        if (!favoriteId) return;
                        const now = await chrome.tabs.get(tabId).catch(() => null);
                        if (now && !now.pinned) await remove(favoriteId, tabId);
                    }),
                UNPIN_SETTLE_MS
            );
        else if (tab.pinned && (change.pinned || change.url || change.title)) run(() => bind(tab));
    });
    chrome.tabs.onAttached.addListener(tabId =>
        run(async () => bind(await chrome.tabs.get(tabId).catch(() => ({ pinned: false }))))
    );
    chrome.tabs.onRemoved.addListener((tabId, info) =>
        run(() => {
            state = unbindTab(state, tabId, { windowClosing: Boolean(info?.isWindowClosing) });
        })
    );
    chrome.tabs.onReplaced.addListener((added, removed) =>
        run(() => {
            state = replaceTab(state, added, removed);
        })
    );
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[ALL_WINDOWS_SETTING])
            run(async () => {
                enabled = changes[ALL_WINDOWS_SETTING].newValue !== false;
                if (enabled) await reconcile();
            });
        if (area === 'local' && changes.spaces) run(followSpaceChanges);
    });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== SAVED_FAVORITES_MESSAGE) return;
        run(() => handle(message)).then(
            () => sendResponse({ success: true }),
            error => sendResponse({ success: false, error: error.message })
        );
        return true;
    });
    run(() => {});
}
