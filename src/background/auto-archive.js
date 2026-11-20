import { ownerOf } from '../shared/space-store.js';
import { isProtectedFavorite } from '../shared/favorite-safety.js';
import { Utils } from '../shared/utils.js';
import { Logger } from '../shared/logger.js';
import { ROOT_FOLDER_TITLE } from '../shared/constants.js';

export const AUTO_ARCHIVE_ALARM_NAME = 'autoArchiveTabsAlarm';
export const TAB_ACTIVITY_STORAGE_KEY = 'tabLastActivity'; // Key to store timestamps

// Archives tabs that stay idle past the user's threshold. The service worker calls this once,
// with its space store, to register the alarm and the activity tracking it relies on.
export function registerAutoArchive(spaceStore) {
    // --- Helper: Update Last Activity Timestamp ---
    async function updateTabLastActivity(tabId) {
        if (!tabId) return;
        try {
            // Wait for store init so this read-modify-write cannot undo the new-session reset.
            await spaceStore.run(() => {});
            const result = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
            const activityData = result[TAB_ACTIVITY_STORAGE_KEY] || {};
            activityData[tabId] = Date.now();
            // Optional: Prune old entries if the storage grows too large
            await chrome.storage.local.set({ [TAB_ACTIVITY_STORAGE_KEY]: activityData });
        } catch (error) {
            Logger.error('Error updating tab activity:', error);
        }
    }

    // --- Helper: Remove Activity Timestamp ---
    async function removeTabLastActivity(tabId) {
        if (!tabId) return;
        try {
            await spaceStore.run(() => {});
            const result = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
            const activityData = result[TAB_ACTIVITY_STORAGE_KEY] || {};
            delete activityData[tabId];
            await chrome.storage.local.set({ [TAB_ACTIVITY_STORAGE_KEY]: activityData });
        } catch (error) {
            Logger.error('Error removing tab activity:', error);
        }
    }

    // --- Alarm Creation ---
    async function setupAutoArchiveAlarm() {
        try {
            const settings = await Utils.getSettings();
            if (settings.autoArchiveEnabled && settings.autoArchiveIdleMinutes > 0) {
                // Create the alarm to fire periodically
                // Note: Chrome alarms are not exact, they fire *at least* this often.
                // Minimum period is 1 minute.
                const period = Math.max(1, settings.autoArchiveIdleMinutes / 2); // Check more frequently than the idle time
                await chrome.alarms.create(AUTO_ARCHIVE_ALARM_NAME, {
                    periodInMinutes: period
                });
            } else {
                // If disabled, clear any existing alarm
                await chrome.alarms.clear(AUTO_ARCHIVE_ALARM_NAME);
            }
        } catch (error) {
            Logger.error('Error setting up auto-archive alarm:', error);
        }
    }

    // --- Alarm Listener ---
    chrome.alarms.onAlarm.addListener(async alarm => {
        if (alarm.name === AUTO_ARCHIVE_ALARM_NAME) {
            await runAutoArchiveCheck();
        }
    });

    // --- Archiving Logic ---
    async function runAutoArchiveCheck() {
        const settings = await Utils.getSettings();
        if (!settings.autoArchiveEnabled || settings.autoArchiveIdleMinutes <= 0) {
            return;
        }

        const idleThresholdMillis = settings.autoArchiveIdleMinutes * 60 * 1000;
        const now = Date.now();

        try {
            // --- Build the protected favorite set from the durable Sidecove bookmark tree ---
            // NOTE: space.spaceBookmarks holds ephemeral tab-IDs (not URLs), so the old
            // check here was always empty and never protected favorites from archiving.
            // The Sidecove bookmark folder is the durable record of favorites; collect its
            // URLs normalized with the same pinned-URL key the renderer uses (origin+path).
            const protectedUrlKeys = new Set();
            try {
                const sidecoveFolder = (await chrome.bookmarks.search({ title: ROOT_FOLDER_TITLE })).find(
                    node => !node.url
                );
                if (sidecoveFolder) {
                    const [subTree] = await chrome.bookmarks.getSubTree(sidecoveFolder.id);
                    const collectUrls = node => {
                        if (!node) return;
                        if (node.url) {
                            protectedUrlKeys.add(Utils.getPinnedUrlKey(node.url));
                        }
                        if (node.children) node.children.forEach(collectUrls);
                    };
                    collectUrls(subTree);
                }
            } catch (bookmarkError) {
                Logger.warn('Auto-archive: could not read Sidecove bookmark tree for protection:', bookmarkError);
                return;
            }

            const currentSpaces = await spaceStore.dispatch({ action: 'get' });
            // Read activity only after init, which clears previous-session records.
            const activityResult = await chrome.storage.local.get(TAB_ACTIVITY_STORAGE_KEY);
            const tabActivity = activityResult[TAB_ACTIVITY_STORAGE_KEY] || {};
            const protectedIds = new Set(currentSpaces.flatMap(space => space.spaceBookmarks));
            const bindings = await Utils.getPinnedTabStates();

            // Get all non-pinned tabs across all windows
            const tabs = await chrome.tabs.query({ pinned: false });
            const tabsToArchive = [];

            for (const tab of tabs) {
                // Skip audible, active, or recently active tabs
                if (tab.audible || tab.active) {
                    await updateTabLastActivity(tab.id); // Update activity for active/audible tabs
                    continue;
                }

                // Protect Sidecove favorites: never archive a tab whose URL matches a bookmark
                // in the Sidecove tree (compared by origin+pathname to tolerate query/hash drift).
                if (isProtectedFavorite(tab, protectedIds, bindings, protectedUrlKeys)) {
                    // Refresh activity so protected favorites aren't re-checked repeatedly.
                    await updateTabLastActivity(tab.id);
                    continue;
                }

                const lastActivity = tabActivity[tab.id];

                // Start tracking tabs with no record (opened in the background, or restored with a
                // new id after restart) instead of treating them as idle.
                if (!lastActivity) {
                    await updateTabLastActivity(tab.id);
                    continue;
                }

                if (now - lastActivity > idleThresholdMillis) {
                    // Check if tab still exists before archiving
                    try {
                        await chrome.tabs.get(tab.id); // Throws error if tab closed
                        tabsToArchive.push(tab);
                    } catch (e) {
                        await removeTabLastActivity(tab.id); // Clean up record for closed tab
                    }
                }
            }

            for (const tab of tabsToArchive) {
                const tabData = {
                    url: tab.url,
                    name: tab.title || tab.url, // Use URL if title is empty
                    spaceId: ownerOf(await spaceStore.dispatch({ action: 'get' }), tab.id)?.id
                };

                // Archive only tabs owned by an extension space.
                if (tabData.spaceId) {
                    await Utils.addArchivedTab(tabData);
                    await chrome.tabs.remove(tab.id); // Close the tab after archiving
                    await removeTabLastActivity(tab.id); // Remove activity timestamp after archiving
                } else {
                    // Decide if you want to update its activity or leave it for next check
                    // await updateTabLastActivity(tab.id);
                }
            }
        } catch (error) {
            Logger.error('Error during auto-archive check:', error);
        }
    }

    // --- Event Listeners to Track Activity and Setup Alarm ---

    // Run setup when the extension is installed or updated
    chrome.runtime.onInstalled.addListener(() => {
        setupAutoArchiveAlarm();
        // Initialize activity for all existing tabs? Maybe too much overhead.
        // Better to let the alarm handle it over time.
    });

    // Run setup when Chrome starts
    chrome.runtime.onStartup.addListener(() => {
        setupAutoArchiveAlarm();
    });

    // Listen for changes in storage (e.g., settings updated from options page)
    chrome.storage.onChanged.addListener((changes, areaName) => {
        // Check if any of the auto-archive settings changed
        const settingsChanged = ['autoArchiveEnabled', 'autoArchiveIdleMinutes'].some(key => key in changes);

        if ((areaName === 'sync' || areaName === 'local') && settingsChanged) {
            setupAutoArchiveAlarm(); // Re-create or clear the alarm based on new settings
        }

        // Clean up activity data if a tab is removed
        if (areaName === 'local' && TAB_ACTIVITY_STORAGE_KEY in changes) {
            // This might be less reliable than using tab removal events
        }
    });

    // Track tab activation
    chrome.tabs.onActivated.addListener(async activeInfo => {
        await updateTabLastActivity(activeInfo.tabId);
    });

    // Track tab updates (e.g., audible status changes)
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        // If a tab becomes active (e.g., navigation finishes) or audible, update its timestamp
        if (changeInfo.status === 'complete' || changeInfo.audible !== undefined) {
            if (tab.active || tab.audible) {
                await updateTabLastActivity(tabId);
            }
        }
    });

    return { removeTabLastActivity, setupAutoArchiveAlarm };
}
