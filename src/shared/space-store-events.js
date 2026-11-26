import { syncSpaceGroups } from './tab-group-sync.js';
import { followLinkPins } from './pinned-tab-links.js';
import { followStoreSettings } from './space-store-settings.js';
import { sections, spaceForActivation } from './space-membership.js';
import { removeTab } from './space-tab-removal.js';

// Wires the browser's events to a SpaceStore: each tab, window and setting change is run in the
// store's queue and followed by a save, and tab-strip changes ask for the tab groups to be redrawn.
export function installSpaceStoreEvents(store) {
    const handle = operation =>
        store
            .run(async () => {
                await operation();
                await store.persist();
            })
            .catch(console.error);
    chrome.tabs.onCreated.addListener(tab => handle(() => store.track(tab)));
    chrome.tabs.onUpdated.addListener((id, change, tab) => {
        if (change.url || change.pinned !== undefined) handle(() => store.track(tab));
    });
    followLinkPins(chrome, store);
    chrome.tabs.onRemoved.addListener((id, info) => handle(() => removeTab(store, id, info)));
    chrome.tabs.onReplaced.addListener((added, removed) =>
        handle(() => {
            store.linkTails.replaced(added, removed);
            store.linkPins.replaced(added, removed);
            for (const space of store.spaces) {
                for (const key of sections) space[key] = space[key].map(id => (id === removed ? added : id));
                if (space.lastTab === removed) space.lastTab = added;
            }
        })
    );
    chrome.tabs.onActivated.addListener(info =>
        handle(async () => {
            // Coming back to a tab starts its links again directly beneath it.
            store.linkTails.switchedTo(info.tabId);
            const { perSpacePinnedFavorites = false } = await chrome.storage.sync.get('perSpacePinnedFavorites');
            const space = spaceForActivation(store.spaces, info.tabId, perSpacePinnedFavorites);
            if (!space) return;
            space.lastTab = info.tabId;
            store.active[info.windowId] = space.id;
            // A tab changing in a window you are not looking at is not the space in use.
            if (
                await chrome.windows.get(info.windowId).then(
                    win => win.focused,
                    () => false
                )
            )
                store.lastActive = space.id;
        })
    );
    chrome.windows.onFocusChanged.addListener(windowId =>
        handle(() => {
            if (store.spaces.some(s => s.id === store.active[windowId])) store.lastActive = store.active[windowId];
        })
    );
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.pinnedTabStatesById || changes.tabNameOverridesById)) handle(() => {});
        if (area === 'sync' && changes.syncTabGroups) handle(() => {});
        if (area === 'sync') followStoreSettings(store, changes, handle);
    });
    // Tab-strip changes only request a projection; they never alter the model.
    let syncTimer;
    const scheduleSync = () => {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(
            () => store.run(() => syncSpaceGroups(store.spaces, store.active)).catch(console.error),
            200
        );
    };
    chrome.tabs.onMoved.addListener(scheduleSync);
    chrome.tabs.onUpdated.addListener((id, change) => {
        if (change.groupId !== undefined) scheduleSync();
    });
    chrome.tabGroups.onRemoved.addListener(scheduleSync);
    chrome.tabGroups.onUpdated.addListener(scheduleSync);
    store.run(() => {}).catch(console.error);
}
