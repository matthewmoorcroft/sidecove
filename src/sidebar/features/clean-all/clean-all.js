/**
 * Clean All - clear a space's temporary tabs without losing them.
 *
 * Arc's Clear can be undone and its tabs stay in the archive. Every cleared tab is archived
 * first. The tabs then leave the list at once but stay open, hidden and muted, while the Undo
 * toast is on screen; the service worker closes them afterwards (see background/pending-clean.js).
 * Undo shows the same tabs again, which works for a local file that Chrome could not reopen.
 * Chrome and storage calls are injected so the order of operations can be tested.
 */
import { pickTabAfterClose } from '../close-tab/close-focus.js';
import { isProtectedFavorite } from '../../../shared/favorite-safety.js';
import { isUntouchedPage } from '../../../shared/new-tab-page.js';
import { PENDING_CLEAN_MESSAGE } from '../../../shared/pending-clean.js';

// An untouched New Tab has nothing worth keeping: archiving it only adds a "New tab" entry and
// opens another one. Clear, and the button that offers it, leave such tabs out.
export const clearableTabs = tabs => tabs.filter(tab => !isUntouchedPage(tab));

// What Clear closes: the tabs left once favorites, which it never closes, and untouched New Tabs
// are out. The Clear button and Clear itself both use this, so the button never offers nothing.
export const closableTabs = (tabs, { protectedIds, bindings, favoriteUrlKeys }) =>
    clearableTabs(tabs.filter(tab => !isProtectedFavorite(tab, protectedIds, bindings, favoriteUrlKeys)));

// `addedToArchive`: Clean All made the entry, so Undo takes it back. `archived`: Archived can
// give the tab back, so it may close.
export async function archiveTabs(tabs, spaceId, { addArchivedTab }) {
    const records = [];
    for (const tab of tabs) {
        const { stored, archived } = await addArchivedTab({ url: tab.url, name: tab.title || tab.url, spaceId });
        records.push({
            tabId: tab.id,
            url: tab.url,
            spaceId,
            addedToArchive: stored === true,
            archived: archived === true
        });
    }
    return records;
}

// The tab being shown must not be one that is about to disappear from the list. Move to the
// one a close would have shown next, or to a New Tab when none is left.
export async function stepOffClearedTabs(
    clearedIds,
    { activeTabId, displayOrder, openTabIds, activateTab, openNewTab }
) {
    if (!clearedIds.has(activeTabId)) return;
    const open = new Set(await openTabIds());
    const isOpen = id => open.has(id) && !clearedIds.has(id);
    const target = pickTabAfterClose(displayOrder, activeTabId, isOpen) ?? displayOrder.find(isOpen);
    if (target === undefined) await openNewTab();
    else await activateTab(target);
}

export async function clearTabs(tabs, spaceId, spaceOrder, api) {
    if (!tabs.length) return null;
    // A tab Archived could not keep stays open and listed.
    const records = (await archiveTabs(tabs, spaceId, api)).filter(record => record.archived);
    if (!records.length) return null;
    const clearedIds = new Set(records.map(record => record.tabId));
    await stepOffClearedTabs(clearedIds, api);
    try {
        const { batchId, closeAt, spaces } = await api.startPendingClean({
            spaceId,
            tabIds: [...clearedIds],
            order: spaceOrder
        });
        return { records, batchId, closeAt, spaces };
    } catch (error) {
        // The tabs stay as they were, so they must not also be listed as archived.
        for (const record of records) {
            if (record.addedToArchive) await api.removeArchivedTab(record.url, record.spaceId);
        }
        throw error;
    }
}

// Undo shows the hidden tabs again. A tab that is gone by then (Chrome closed it, or the
// worker already finished) is reopened from its record, as Undo always did.
export async function undoClear(records, batchId, windowId, invertTabOrder, api) {
    const { restored } = await api.undoPendingClean(batchId);
    const back = new Set(restored);
    for (const record of records) {
        if (back.has(record.tabId) && record.addedToArchive) await api.removeArchivedTab(record.url, record.spaceId);
    }
    const missing = records.filter(record => !back.has(record.tabId));
    // New tabs join the top of an inverted list, so reopen bottom-up to keep the order.
    await reopenClosedTabs(invertTabOrder ? [...missing].reverse() : missing, windowId, api);
}

// Reopen in the original order and drop only the archive entries Clean All created, so an
// entry archived earlier stays restorable.
export async function reopenClosedTabs(records, windowId, { createTab, assignTab, removeArchivedTab }) {
    const reopened = [];
    for (const record of records) {
        const tab = await createTab({ url: record.url, active: false, windowId });
        await assignTab(tab.id, record.spaceId);
        if (record.addedToArchive) await removeArchivedTab(record.url, record.spaceId);
        reopened.push(tab.id);
    }
    return reopened;
}

async function request(action, payload) {
    const response = await chrome.runtime.sendMessage({ type: PENDING_CLEAN_MESSAGE, action, ...payload });
    if (!response?.success) throw new Error(response?.error || 'Clean All is unavailable');
    return response;
}

export const startPendingClean = payload => request('start', payload);
export const undoPendingClean = batchId => request('undo', { batchId });
