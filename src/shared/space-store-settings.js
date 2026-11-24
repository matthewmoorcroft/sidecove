import { PINNED_TAB_LINKS_SETTING, opensLinksAsPinnedTabs } from './pinned-tab-links.js';

// The settings the space store follows: read when the worker starts, and kept current when they
// change, so a new value applies without a restart.
const STORE_SETTINGS = {
    defaultSpaceName: (store, value) => (store.defaultSpaceName = value || 'Home'),
    perSpacePinnedFavorites: (store, value) => (store.perSpacePinnedFavorites = value === true),
    invertTabOrder: (store, value) => (store.invertTabOrder = value !== false),
    [PINNED_TAB_LINKS_SETTING]: (store, value) => (store.pinsLinks = opensLinksAsPinnedTabs(value))
};

export async function readStoreSettings(store) {
    const settings = await chrome.storage.sync.get(Object.keys(STORE_SETTINGS));
    for (const [key, apply] of Object.entries(STORE_SETTINGS)) apply(store, settings[key]);
}

/** @param {(operation: () => void) => void} handle runs the change in the store's queue */
export function followStoreSettings(store, changes, handle) {
    for (const [key, apply] of Object.entries(STORE_SETTINGS))
        if (changes[key]) handle(() => apply(store, changes[key].newValue));
}
