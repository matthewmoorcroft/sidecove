import { spaceRequest } from '../../../shared/space-client.js';
import { Utils } from '../../../shared/utils.js';
import { Logger } from '../../../shared/logger.js';
import { MOUSE_BUTTON } from '../../../shared/constants.js';
import { isOtherWindow, selectFavoriteTabs } from '../all-windows/all-windows.js';
import { markOtherWindowFavicon } from '../all-windows/other-window-mark.js';
import { createOpenHere } from '../all-windows/open-here.js';
import { ALL_WINDOWS_SETTING, FAVORITE_TABS_KEY, SAVED_FAVORITES_KEY } from '../../../shared/saved-favorites.js';
import { favoriteBarItems, favoriteIdBefore } from '../saved-favorites/favorite-bar.js';
import { createSavedFavoriteIcon, refreshSavedFavoriteIcon } from '../saved-favorites/saved-favorite-icon.js';
import { savedFavoritesRequest } from '../saved-favorites/saved-favorites-client.js';
import { showMenu } from '../../dom-manager.js';
import { pinnedTabIndexAt } from './pin-index.js';

export function createPinnedFavorites({
    getWindow,
    showsAllWindows,
    getActiveSpaceId,
    clearAllActiveStates,
    clearSelection,
    getDragAfterElementFavicon,
    getDropPosition,
    showDropIndicator,
    hideAllDropIndicators
}) {
    const openHere = createOpenHere(chrome.tabs);
    chrome.storage.onChanged.addListener((changes, area) => {
        const savedListChanged = area === 'local' && (changes[SAVED_FAVORITES_KEY] || changes[FAVORITE_TABS_KEY]);
        const scopeChanged = area === 'sync' && (changes.perSpacePinnedFavorites || changes[ALL_WINDOWS_SETTING]);
        if (scopeChanged || savedListChanged) {
            updatePinnedFavicons().catch(error => Logger.error('Could not update favorites', error));
        }
    });
    // With all windows shown, the bar is the saved favorites list; incognito windows keep their own pins.
    const showsSavedList = () => showsAllWindows() && !getWindow().incognito;
    const request = (action, payload) =>
        savedFavoritesRequest(action, payload).catch(error => Logger.warn(`Could not ${action} favorite:`, error));
    const savedFavoriteIcon = favorite =>
        createSavedFavoriteIcon(favorite, {
            open: () => request('open', { favoriteId: favorite.id, windowId: getWindow().id }),
            showMenu: event =>
                showMenu(event.pageX, event.pageY, [
                    {
                        label: 'Remove from Favorites',
                        action: () => request('remove', { favoriteId: favorite.id })
                    }
                ])
        });
    return updatePinnedFavicons;

    // The bar's entries: { tab } for a live pin, { favorite, tab: null } for a dimmed favorite.
    async function barItems(perSpacePinnedFavorites, visibleIds) {
        const allWindows = showsAllWindows();
        if (showsSavedList()) {
            const stored = await chrome.storage.local.get([SAVED_FAVORITES_KEY, FAVORITE_TABS_KEY]);
            return favoriteBarItems({
                favorites: stored[SAVED_FAVORITES_KEY],
                records: stored[FAVORITE_TABS_KEY],
                pins: await chrome.tabs.query({ pinned: true, windowId: getWindow().id }),
                windowId: getWindow().id,
                perSpace: perSpacePinnedFavorites,
                spaceId: getActiveSpaceId(),
                spaceTabIds: visibleIds
            });
        }
        return selectFavoriteTabs(
            await chrome.tabs.query(allWindows ? { pinned: true } : { pinned: true, windowId: getWindow().id }),
            getWindow(),
            { allWindows, perSpace: perSpacePinnedFavorites, spaceTabIds: visibleIds }
        ).map(tab => ({ favorite: null, tab }));
    }

    async function updatePinnedFavicons() {
        const pinnedFavicons = document.getElementById('pinnedFavicons');
        // Read the worker's canonical membership: native pin events can arrive before
        // the panel's stored-space refresh, and a different panel may have moved a tab.
        const storedSpaces = await spaceRequest('get');
        const { perSpacePinnedFavorites = false } = await chrome.storage.sync.get('perSpacePinnedFavorites');
        const visibleIds = new Set(storedSpaces.find(space => space.id === getActiveSpaceId())?.pinnedTabs || []);
        const items = await barItems(perSpacePinnedFavorites, visibleIds);
        const pinnedTabs = items.filter(item => item.tab).map(item => item.tab);
        const dimmedIds = new Set(items.filter(item => !item.tab).map(item => item.favorite.id));

        const subtitle = pinnedFavicons.querySelector('.placeholder-subtitle');
        if (subtitle)
            subtitle.textContent = perSpacePinnedFavorites
                ? 'Favorites keep your most used sites close in this space'
                : 'Favorites keep your most used sites close across all spaces';

        // Remove favicon elements for tabs that are no longer pinned
        Array.from(pinnedFavicons.children).forEach(element => {
            // Only remove elements that are pinned favicons (have the pinned-favicon class)
            if (element.classList.contains('saved-favorite')) {
                if (!dimmedIds.has(element.dataset.favoriteId)) element.remove();
            } else if (element.classList.contains('pinned-favicon')) {
                const tabId = element.dataset.tabId;
                // A pin moved to another window is drawn again with that window's mark.
                const tab = pinnedTabs.find(tab => tab.id.toString() === tabId);
                if (!tab || element.dataset.windowId !== String(tab.windowId)) {
                    element.remove();
                }
            }
        });

        pinnedTabs.forEach(tab => {
            // Check if favicon element already exists for this tab
            const existingElement = pinnedFavicons.querySelector(`[data-tab-id="${tab.id}"]`);
            if (!existingElement) {
                const faviconElement = document.createElement('div');
                faviconElement.className = 'pinned-favicon';
                faviconElement.title = tab.title;
                faviconElement.dataset.tabId = tab.id;
                faviconElement.dataset.windowId = tab.windowId;
                faviconElement.draggable = true; // Make pinned favicon draggable
                const otherWindow = isOtherWindow(tab, getWindow().id);

                const img = document.createElement('img');
                img.src = Utils.getFaviconUrl(tab.url, '96');
                img.onerror = () => {
                    img.src = tab.favIconUrl;
                    img.onerror = () => {
                        img.src = '/assets/default_icon.png';
                    }; // Fallback favicon
                };
                img.alt = tab.title;

                faviconElement.appendChild(img);
                if (otherWindow) markOtherWindowFavicon(faviconElement);
                faviconElement.addEventListener('mousedown', event => {
                    if (event.button !== MOUSE_BUTTON.LEFT) return;
                    // Another window's pin stays there; picking it opens the page pinned in this window.
                    if (otherWindow) {
                        openHere(tab, getWindow().id).catch(error => Logger.warn('Could not open favorite:', error));
                        return;
                    }
                    clearAllActiveStates();
                    // Add active class to clicked tab
                    faviconElement.classList.add('active');
                    chrome.tabs.update(tab.id, { active: true });
                });

                // Add drag event listeners for pinned favicon
                faviconElement.addEventListener('dragstart', () => {
                    faviconElement.classList.add('dragging');
                });

                faviconElement.addEventListener('dragend', () => {
                    faviconElement.classList.remove('dragging');
                });

                pinnedFavicons.appendChild(faviconElement);
            }
        });

        // Already in order: the saved order, or tab strip order with this window's pins first.
        items.forEach(({ favorite, tab }) => {
            let element = tab
                ? pinnedFavicons.querySelector(`[data-tab-id="${tab.id}"]`)
                : pinnedFavicons.querySelector(`.saved-favorite[data-favorite-id="${favorite.id}"]`);
            if (!tab && !element) element = savedFavoriteIcon(favorite);
            else if (!tab) refreshSavedFavoriteIcon(element, favorite);
            if (!element) return;
            if (tab && favorite) element.dataset.favoriteId = favorite.id;
            else if (tab) delete element.dataset.favoriteId;
            pinnedFavicons.appendChild(element);
        });

        // Show/hide placeholder based on whether there are pinned tabs
        const placeholderContainer = pinnedFavicons.querySelector('.pinned-placeholder-container');
        if (placeholderContainer) {
            if (items.length === 0) {
                placeholderContainer.style.display = 'block';
            } else {
                placeholderContainer.style.display = 'none';
            }
        }

        // Add drag and drop event listeners ONCE. updatePinnedFavicons() is called from many
        // handlers; re-adding these container listeners every call leaked duplicate handlers
        // that fired repeatedly (B8). Guard on a dataset flag so they bind exactly once.
        if (!pinnedFavicons.dataset.dragListenersBound) {
            pinnedFavicons.dataset.dragListenersBound = 'true';
            pinnedFavicons.addEventListener('dragover', e => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');

                // Show drop indicator for horizontal favicons
                const draggingElement = document.querySelector('.dragging');
                if (draggingElement) {
                    const afterElement = getDragAfterElementFavicon(pinnedFavicons, e.clientX);
                    if (afterElement) {
                        // Check if this is a placeholder (empty container)
                        if (afterElement.classList.contains('pinned-placeholder-container')) {
                            // Show visual feedback on the placeholder itself
                            afterElement.classList.add('drag-over');
                            hideAllDropIndicators(); // Don't show traditional indicators for placeholders
                        } else {
                            // Show traditional drop indicators for actual favicons
                            const position = getDropPosition(afterElement, e.clientX, e.clientY, true);
                            showDropIndicator(afterElement, position);
                            // Remove any placeholder drag-over state
                            const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
                            if (placeholder) placeholder.classList.remove('drag-over');
                        }
                    } else {
                        hideAllDropIndicators();
                        // Remove any placeholder drag-over state
                        const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
                        if (placeholder) placeholder.classList.remove('drag-over');
                    }
                }
            });

            pinnedFavicons.addEventListener('dragleave', e => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                // Hide indicators when leaving the pinned favicons area
                if (!pinnedFavicons.contains(e.relatedTarget)) {
                    hideAllDropIndicators();
                    // Remove any placeholder drag-over state
                    const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
                    if (placeholder) placeholder.classList.remove('drag-over');
                }
            });

            pinnedFavicons.addEventListener('drop', async e => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                hideAllDropIndicators(); // Clean up indicators on drop
                // Remove any placeholder drag-over state
                const placeholder = pinnedFavicons.querySelector('.pinned-placeholder-container');
                if (placeholder) placeholder.classList.remove('drag-over');
                const draggingElement = document.querySelector('.dragging');
                if (draggingElement && draggingElement.dataset.tabId) {
                    const tabId = parseInt(draggingElement.dataset.tabId);

                    // If dragging a pinned favicon to reorder, handle positioning
                    if (draggingElement.classList.contains('pinned-favicon')) {
                        const afterElement = getDragAfterElementFavicon(pinnedFavicons, e.clientX);
                        if (afterElement) {
                            // Check if this is a placeholder (empty container)
                            if (afterElement.classList.contains('pinned-placeholder-container')) {
                                // Empty container - append directly and hide placeholder
                                pinnedFavicons.appendChild(draggingElement);
                                afterElement.style.display = 'none';
                            } else {
                                // Normal positioning logic for actual favicons
                                const position = getDropPosition(afterElement, e.clientX, e.clientY, true);

                                // Position element based on indicator logic
                                if (position === 'left') {
                                    pinnedFavicons.insertBefore(draggingElement, afterElement);
                                } else {
                                    // 'right'
                                    const nextSibling = afterElement.nextElementSibling;
                                    if (nextSibling) {
                                        pinnedFavicons.insertBefore(draggingElement, nextSibling);
                                    } else {
                                        pinnedFavicons.appendChild(draggingElement);
                                    }
                                }
                            }
                        } else {
                            // Fallback: append to end
                            pinnedFavicons.appendChild(draggingElement);
                        }
                        if (showsSavedList()) {
                            const order = [...pinnedFavicons.querySelectorAll('.pinned-favicon[data-favorite-id]')];
                            await request('reorder', { ids: order.map(el => el.dataset.favoriteId) });
                        }
                        const ids = [
                            ...pinnedFavicons.querySelectorAll('.pinned-favicon[data-tab-id]:not(.other-window)')
                        ].map(el => Number(el.dataset.tabId));
                        for (let index = 0; index < ids.length; index++) {
                            const live = await chrome.tabs.get(ids[index]);
                            if (live.pinned && live.windowId === getWindow().id)
                                await chrome.tabs.move(live.id, { index });
                        }
                        await updatePinnedFavicons();
                    } else {
                        // Dragging a regular tab to make it pinned
                        const afterElement = getDragAfterElementFavicon(pinnedFavicons, e.clientX);
                        let targetIndex = 0; // Default to index 0 for empty containers
                        let position = null;

                        if (afterElement) {
                            if (afterElement.classList.contains('pinned-placeholder-container')) {
                                // Empty container - use index 0 and hide placeholder after pinning
                                targetIndex = 0;
                            } else {
                                // Normal positioning logic for actual favicons
                                position = getDropPosition(afterElement, e.clientX, e.clientY, true);
                                targetIndex = pinnedTabIndexAt(afterElement, position, pinnedFavicons);
                            }
                        }

                        // Only the dragged tab is pinned; the rest of a selection stays where it was.
                        clearSelection();

                        // Step 1: Pin the tab (this adds it to the end by default)
                        await chrome.tabs.update(tabId, { pinned: true });

                        // Step 2: Move it to the correct position if needed
                        if (targetIndex !== undefined && targetIndex >= 0) {
                            try {
                                await chrome.tabs.move(tabId, { index: targetIndex });
                            } catch (error) {
                                Logger.warn('Error moving pinned tab to target index:', error);
                            }
                        }

                        if (showsSavedList())
                            await request('place', { tabId, beforeId: favoriteIdBefore(afterElement, position) });

                        // Step 3: Update the favicon display
                        updatePinnedFavicons();

                        // Hide placeholder if this was an empty container
                        if (afterElement && afterElement.classList.contains('pinned-placeholder-container')) {
                            afterElement.style.display = 'none';
                        }

                        // Remove the tab from its original container
                        draggingElement.remove();
                    }
                }
            });
        } // end bind-once guard for pinnedFavicons drag listeners
    }
}
