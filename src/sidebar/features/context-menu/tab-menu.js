import { Utils } from '../../../shared/utils.js';
import { Logger } from '../../../shared/logger.js';
import { archiveTab } from '../../../shared/archive-client.js';
import { copyText, showMenu, showUrlCopyToast } from '../../dom-manager.js';
import { moveToSpaceEntries } from './space-menu-entries.js';
import { tabMenuEntries } from './tab-menu-entries.js';

// A failing action is logged, as every menu item has always done; it never reaches the page.
const guarded =
    (label, action) =>
    async (...args) => {
        try {
            await action(...args);
        } catch (error) {
            Logger.warn(`[ContextMenu] ${label} failed:`, error);
        }
    };

// The right-click menu of a row in a space: an ordinary tab, a pinned tab, or a favorite with no
// open tab. Which items each offers is decided in tab-menu-entries.js.
export function showTabContextMenu(
    x,
    y,
    tab,
    isPinned,
    isBookmarkOnly,
    tabElement,
    closeTab,
    spaces,
    moveTabToSpace,
    setActiveSpace,
    allBookmarkSpaceFolders,
    createSpaceFromInactive,
    onReplaceBookmarkUrlWithCurrent = null,
    moveFavoriteToSpace = null,
    { muted = false, onRename = null, splitEntries = [] } = {}
) {
    const kind = isBookmarkOnly ? 'saved' : isPinned ? 'pinned' : 'tab';
    const currentSpace = isBookmarkOnly
        ? spaces.find(s => s.id === tabElement.closest('.space')?.dataset.spaceId)
        : spaces.find(s => s.temporaryTabs.includes(tab.id) || s.spaceBookmarks.includes(tab.id));
    // Creating an inactive space needs a live tab, which unloaded favorites do not have.
    const activeSpaceNames = new Set(spaces.map(s => s.name));
    const inactiveFolders = isBookmarkOnly
        ? []
        : allBookmarkSpaceFolders.filter(f => !f.url && !activeSpaceNames.has(f.title));
    // Favorites must carry their saved bookmark so moving them does not silently unpin them.
    const canMove = !isBookmarkOnly || typeof moveFavoriteToSpace === 'function';

    const moveEntries = canMove
        ? moveToSpaceEntries({
              spaces,
              currentSpaceId: currentSpace?.id,
              inactiveFolders,
              onMove: async space => {
                  if (isPinned && typeof moveFavoriteToSpace === 'function') {
                      try {
                          await moveFavoriteToSpace(tab, tabElement, space.id);
                      } catch (error) {
                          Logger.warn('[ContextMenu] Failed to move favorite to space:', error);
                          return;
                      }
                  } else {
                      await moveTabToSpace(tab.id, space.id, false);
                  }
                  // Set the space as active, but prevent it from auto-activating a different tab
                  await setActiveSpace(space.id, false);
                  // Explicitly activate the tab that was just moved
                  if (!isBookmarkOnly) await Utils.focusTab(tab.id);
              },
              onCreate: folder => createSpaceFromInactive(folder.title, tab)
          })
        : [];

    const togglePin = () => chrome.runtime.sendMessage({ command: 'toggleSpacePin', tabId: tab.id });
    const close = () => closeTab(tabElement, tab, isPinned, isBookmarkOnly);
    const actions = {
        // Favorites without an open tab can still share their link.
        copyLink: async () => {
            let url = tabElement.dataset.url || tab.url;
            if (!isBookmarkOnly && tab.id) {
                try {
                    url = (await chrome.tabs.get(tab.id)).url || url;
                } catch {
                    /* closed meanwhile */
                }
            }
            if (await copyText(url)) showUrlCopyToast('Copied link');
        },
        rename: typeof onRename === 'function' ? onRename : null,
        setMuted: value => chrome.tabs.update(tab.id, { muted: value }),
        // Arc-like: update the underlying space bookmark URL to the current tab URL.
        replaceUrl:
            typeof onReplaceBookmarkUrlWithCurrent === 'function'
                ? () => onReplaceBookmarkUrlWithCurrent(tab, tabElement)
                : null,
        addToFavorites: () => chrome.tabs.update(tab.id, { pinned: true }),
        togglePin,
        duplicate: () => chrome.tabs.duplicate(tab.id),
        close,
        archive: () => archiveTab(tab.id),
        // A favorite with no open tab is removed, never closed: it has no tab.
        removeBookmark: close
    };
    for (const [name, action] of Object.entries(actions)) {
        if (action) actions[name] = guarded(name, action);
    }

    showMenu(x, y, tabMenuEntries({ kind, muted, splitEntries, moveEntries, actions }));
}
