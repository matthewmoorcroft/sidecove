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

// `stored`: a new entry was added. `archived`: Archived can give the page back to its space,
// with a new entry or one already there; a tab is closed only then.
export async function addArchivedTab(entry) {
    const { stored, archived } = await request('add', { entry });
    return { stored, archived };
}

// The entry a favorite's address opens from: the one archived from this space, else any.
export const findArchivedEntry = (list, url, spaceId) =>
    list.find(t => t.url === url && t.spaceId === spaceId) || list.find(t => t.url === url);

export const removeArchivedTab = async (url, spaceId) => (await request('remove', { url, spaceId })).tabs;

// Archives an open tab under the space that owns it, and closes it once Archived can give it back.
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
