import { registerTourMessages } from '../shared/tour-state.js';
registerTourMessages();
/**
 * Background Service Worker (Manifest V3) - Core extension orchestrator
 *
 * Purpose: Manages extension lifecycle, message passing, and system integrations
 * Key Functions: Auto-archive system, tab activity tracking, Chrome API access
 * Architecture: Service worker that handles all Chrome API calls and coordinates between content scripts
 *
 * Critical Notes:
 * - Only context with full Chrome API access (tabs, storage, etc.)
 * - Manages tab activity tracking for auto-archive functionality
 * - All content script Chrome API requests must route through here via message passing
 */

import { SpaceStore } from '../shared/space-store.js';
import { registerBookmarkListeners } from './bookmark-events.js';
import { enqueueBookmarkOperation } from './bookmark-writer.js';

registerBookmarkListeners();

const spaceStore = new SpaceStore();
spaceStore.install();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'spaceStore') return;
    spaceStore.dispatch(message).then(
        spaces => sendResponse({ success: true, spaces }),
        error => sendResponse({ success: false, error: error.message })
    );
    return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'bookmarkOrder') return;
    enqueueBookmarkOperation(message.operation).then(
        result => sendResponse({ success: true, ...result }),
        error =>
            sendResponse({
                success: false,
                error: error.message,
                code: error.code,
                observedOrders: error.observedOrders,
                moved: error.moved
            })
    );
    return true;
});

import { Utils } from '../shared/utils.js';
import { Logger } from '../shared/logger.js';
import { copyCurrentTabUrlWithFallback } from './url-copy.js';
import { parseSpaceCommand, switchSpaceWithoutSidebar } from '../shared/space-navigation.js';
import { registerAutoArchive, TAB_ACTIVITY_STORAGE_KEY } from './auto-archive.js';
import { openOnboardingIfDue } from './onboarding-lifecycle.js';
import { RECENT_TAB_COMMAND, registerRecentTab } from './recent-tab.js';

// Helper to handle async message responses with consistent error handling
function handleAsyncMessage(handler, sendResponse, errorContext, defaultErrorData = {}) {
    (async () => {
        try {
            const result = await handler();
            sendResponse({ success: true, ...result });
        } catch (error) {
            Logger.error(`[Background] Error ${errorContext}:`, error);
            sendResponse({ success: false, error: error.message, ...defaultErrorData });
        }
    })();
    return true; // Indicates async response
}

// Most recently used tab shortcut: keeps the use order and returns the command handler.
const onRecentTabCommand = registerRecentTab({ spaceStore });

// Configure Chrome side panel behavior
chrome.sidePanel
    .setPanelBehavior({
        openPanelOnActionClick: true
    })
    .catch(error => Logger.error(error));

// Listen for extension installation
chrome.runtime.onInstalled.addListener(openOnboardingIfDue);

// Listen for messages from the content script (sidebar)
// Do not return a Promise for unrelated messages: it can win the response race
// against the asynchronous space-store handler on Chrome versions with Promise replies.
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    // Forward the pin toggle command to the sidebar
    if (request.command === 'toggleSpacePin') {
        chrome.runtime.sendMessage({ command: 'toggleSpacePin', tabId: request.tabId });
    }
});

chrome.commands.onCommand.addListener(async function (command) {
    if (command === 'quickPinToggle') {
        // Send a message to the sidebar
        chrome.runtime.sendMessage({ command: 'quickPinToggle' });
    } else if (command === 'NextTabInSpace') {
        Utils.findActiveSpaceAndTab().then(async ({ space, tab }) => {
            if (space) {
                await Utils.movToNextTabInSpace(tab.id, space);
            }
        });
    } else if (command === 'PrevTabInSpace') {
        Utils.findActiveSpaceAndTab().then(async ({ space, tab }) => {
            if (space) {
                await Utils.movToPrevTabInSpace(tab.id, space);
            }
        });
        Logger.log('sending');
        // Send a message to the sidebar
        chrome.runtime.sendMessage({ command: 'PrevTabInSpace' });
    } else if (command === RECENT_TAB_COMMAND) {
        await onRecentTabCommand();
    } else if (command === 'copyCurrentUrl') {
        await copyCurrentTabUrlWithFallback();
    } else {
        const request = parseSpaceCommand(command);
        if (request) await switchSpaceFromCommand(request);
    }
});

// The open sidebar of the focused window switches spaces itself so its view stays in step;
// without one, the worker activates the target space's last tab directly.
async function switchSpaceFromCommand(request) {
    try {
        const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        let handled = false;
        try {
            const response = await chrome.runtime.sendMessage({ command: 'switchSpace', windowId: window.id, request });
            handled = response?.handled === true;
        } catch {
            // No sidebar is listening.
        }
        if (!handled) {
            await switchSpaceWithoutSidebar({
                chromeApi: chrome,
                dispatch: message => spaceStore.dispatch(message),
                windowId: window.id,
                request
            });
        }
    } catch (error) {
        Logger.error('[Spaces] Could not switch space from shortcut:', error);
    }
}

// Auto-archive: the alarm and the tab activity it reads.
const { removeTabLastActivity, setupAutoArchiveAlarm } = registerAutoArchive(spaceStore);

// Clean up timestamp when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    await removeTabLastActivity(tabId);

    // Clean up tab name override for closed tab
    await Utils.removeTabNameOverride(tabId);
});

// Optional: Listen for messages from options page to immediately update alarm
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateAutoArchiveSettings') {
        Logger.log('Received message to update auto-archive settings.');
        setupAutoArchiveAlarm();
        sendResponse({ success: true });
        return false; // Synchronous response
    } else if (message.action === 'openNewTab') {
        chrome.tabs.create({ url: message.url });
        sendResponse({ success: true });
        return false; // Synchronous response
    } else if (message.action === 'switchToTab') {
        return handleAsyncMessage(
            async () => {
                await chrome.tabs.update(message.tabId, { active: true });
                await chrome.windows.update(message.windowId, { focused: true });
                return {};
            },
            sendResponse,
            'switching to tab'
        );
    } else if (message.action === 'searchTabs') {
        return handleAsyncMessage(
            async () => {
                const tabs = await chrome.tabs.query({});
                const query = message.query?.toLowerCase() || '';
                const filteredTabs = tabs.filter(tab => {
                    if (!tab.title || !tab.url) return false;
                    if (!query) return true;
                    return tab.title.toLowerCase().includes(query) || tab.url.toLowerCase().includes(query);
                });
                return { tabs: filteredTabs };
            },
            sendResponse,
            'searching tabs'
        );
    } else if (message.action === 'getRecentTabs') {
        return handleAsyncMessage(
            async () => {
                const tabs = await chrome.tabs.query({});
                const storage = await chrome.storage.local.get([TAB_ACTIVITY_STORAGE_KEY]);
                const activityData = storage[TAB_ACTIVITY_STORAGE_KEY] || {};

                const tabsWithActivity = tabs
                    .filter(tab => tab.url && tab.title)
                    .map(tab => ({ ...tab, lastActivity: activityData[tab.id] || 0 }))
                    .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
                    .slice(0, message.limit || 5);

                return { tabs: tabsWithActivity };
            },
            sendResponse,
            'getting recent tabs'
        );
    } else if (message.action === 'searchBookmarks') {
        return handleAsyncMessage(
            async () => {
                const bookmarks = await chrome.bookmarks.search(message.query);
                return { bookmarks: bookmarks.filter(b => b.url) };
            },
            sendResponse,
            'searching bookmarks'
        );
    } else if (message.action === 'activatePinnedTab') {
        // The original runtime message is already delivered to every extension
        // context, including the sidebar. A second send can duplicate activation.
        sendResponse({ success: true });
        return false; // Synchronous response
    }

    return false; // No async response needed
});
