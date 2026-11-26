import { Logger } from './logger.js';

// Archived tabs are stored here; the key is a stored contract.
export const ARCHIVED_TABS_KEY = 'archivedTabs';
export const ARCHIVE_MESSAGE = 'archive';

// The service worker is the only writer of the archive (background/archive-writer.js). Panels
// read it from storage and ask the worker for every change.
async function request(action, payload) {
    const response = await chrome.runtime.sendMessage({ type: ARCHIVE_MESSAGE, action, ...payload });
    if (!response?.success) throw new Error(response?.error || 'The archive is unavailable');
    return response;
}

export async function getArchivedTabs() {
    return (await chrome.storage.local.get(ARCHIVED_TABS_KEY))[ARCHIVED_TABS_KEY] || [];
}

// Resolves true only when a new entry was stored.
export const addArchivedTab = async entry => (await request('add', { entry })).stored;

export const removeArchivedTab = async (url, spaceId) => (await request('remove', { url, spaceId })).tabs;

// Archives an open tab under the space that owns it and closes it.
export async function archiveTab(tabId) {
    try {
        await request('archiveTab', { tabId });
    } catch (error) {
        Logger.error(`Error archiving tab ${tabId}:`, error);
    }
}

// Reopens an archived page in this window, in its space, and takes it out of the archive.
// Resolves to the new tab.
export async function restoreArchivedTab(entry) {
    const { id: windowId } = await chrome.windows.getCurrent();
    return (await request('restore', { entry, windowId })).tab;
}
