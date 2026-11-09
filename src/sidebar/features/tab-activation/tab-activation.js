// Follows Chrome's active tab in the panel: shows the space that owns it, marks its row, and
// keeps you in your space when the tab you were on closes (see close-tab/close-focus.js).
import { spaceForActivation } from '../../../shared/space-membership.js';
import { Logger } from '../../../shared/logger.js';

// Everything the panel owns is passed in: its state as getters, and its rendering as functions.
export function createTabActivationHandler({
    isCreatingSpace,
    getSpaces,
    getActiveSpaceId,
    setActiveSpaceId,
    getActiveTabId,
    setActiveTabId,
    tabExists,
    closeFocus,
    clearedTabs,
    adoptSpaces, // takes the spaces as the service worker holds them
    saveSpaces,
    clearSelection,
    activateSpaceInDOM,
    updateSpaceSwitcher,
    refreshActiveSpaceUI,
    activateTabInDOM,
    showAllOpenTabsInCollapsedFolders,
    collapsedFolderShownTabs,
    syncCollapsedFoldersInActiveSpace,
    scrollToTab
}) {
    async function run(activeInfo, removalMark, previousTabId) {
        const currentWindow = await chrome.windows.getCurrent({ populate: false });
        if (activeInfo.windowId !== currentWindow.id) {
            Logger.log('New tab is in a different window, ignoring...');
            return;
        }

        Logger.log('Tab activated:', activeInfo);
        // Find which space contains this tab
        const { perSpacePinnedFavorites = false } = await chrome.storage.sync.get('perSpacePinnedFavorites');
        let spaceWithTab = spaceForActivation(getSpaces(), activeInfo.tabId, perSpacePinnedFavorites);
        Logger.log('found space', spaceWithTab);
        // A tab Clear is hiding is in no space, and must not be where a close leaves you.
        const hidden = !spaceWithTab && (await clearedTabs.isHidden(activeInfo.tabId));

        if (
            (spaceWithTab || hidden) &&
            (await closeFocus.stayAfterClose({
                activatedTabId: activeInfo.tabId,
                activatedSpaceId: spaceWithTab?.id,
                activatedHidden: hidden,
                removalMark
            }))
        ) {
            Logger.log('Active tab closed; staying in the current space');
            return;
        }
        setActiveTabId(activeInfo.tabId);

        // Picked on purpose, so that one tab comes back, as an Undo for it alone. When the tab
        // you were on is gone, Chrome fell back to it instead, and it stays as it was.
        if (hidden && (previousTabId == null || (await tabExists(previousTabId)))) {
            try {
                const restored = await clearedTabs.restore(activeInfo.tabId);
                if (restored) {
                    await adoptSpaces(restored);
                    await refreshActiveSpaceUI();
                    spaceWithTab = spaceForActivation(getSpaces(), activeInfo.tabId, perSpacePinnedFavorites);
                }
            } catch (error) {
                // The tab is shown either way, so the panel still follows it.
                Logger.warn('Could not bring back the cleared tab:', error);
            }
        }

        if (spaceWithTab) {
            spaceWithTab.lastTab = activeInfo.tabId;
            saveSpaces();
            Logger.log('lasttab space', getSpaces());
        }

        if (spaceWithTab && spaceWithTab.id !== getActiveSpaceId()) {
            // Switch to the space containing the tab
            clearSelection();
            setActiveSpaceId(spaceWithTab.id);
            await activateSpaceInDOM(spaceWithTab.id, getSpaces(), updateSpaceSwitcher);
            await refreshActiveSpaceUI();
            activateTabInDOM(activeInfo.tabId);
        } else {
            // Activate only the tab in the current space
            activateTabInDOM(activeInfo.tabId);
        }

        // Arc-like behavior: if this tab is inside a collapsed folder, add it to the folder's shown tabs set.
        // This makes the tab stay visible in the collapsed folder until user manually opens/closes the folder.
        if (!showAllOpenTabsInCollapsedFolders()) {
            const tabElement = document.querySelector(`.tab[data-tab-id="${activeInfo.tabId}"]`);
            if (tabElement) {
                const parentFolder = tabElement.closest('.folder');
                if (parentFolder && parentFolder.classList.contains('collapsed')) {
                    let shownTabIds = collapsedFolderShownTabs.get(parentFolder);
                    if (!shownTabIds) {
                        shownTabIds = new Set();
                        collapsedFolderShownTabs.set(parentFolder, shownTabIds);
                    }
                    shownTabIds.add(activeInfo.tabId);
                }
            }
        }

        // Update collapsed-folder projections to follow Arc behavior (active-only) unless user enabled "show all open".
        syncCollapsedFoldersInActiveSpace();

        // Scroll to the activated tab's location
        scrollToTab(activeInfo.tabId, 0);
    }

    return function handleTabActivated(activeInfo) {
        if (isCreatingSpace()) {
            Logger.log('Skipping tab creation handler - space is being created');
            return;
        }
        // Taken before anything is awaited: whether the tab that closed was seen leaving before
        // this activation tells a close from Chrome showing the chosen tab first.
        const removalMark = closeFocus.mark();
        run(activeInfo, removalMark, getActiveTabId()).catch(error =>
            Logger.error('Could not follow the active tab:', error)
        );
    };
}
