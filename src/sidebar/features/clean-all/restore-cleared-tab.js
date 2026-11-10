import { PENDING_CLEAN_MESSAGE } from '../../../shared/pending-clean.js';

async function restoreOnWorker(tabId) {
    const response = await chrome.runtime.sendMessage({ type: PENDING_CLEAN_MESSAGE, action: 'restoreTab', tabId });
    if (!response?.success) throw new Error(response?.error || 'Clean All is unavailable');
    return response;
}

// Picking a tab Clear is hiding (Cmd+1 to 9, or a click in Chrome's tab strip) is an Undo for
// that one tab: it joins the list again and leaves Archived, and the rest still close on time.
// `restoreTab` and `removeArchivedTab` are injected so the order of operations can be tested.
export function createClearedTabs({
    restoreTab = restoreOnWorker,
    removeArchivedTab,
    readHiddenIds = async () => (await chrome.storage.session.get('hiddenTabs')).hiddenTabs || [],
    now = Date.now
} = {}) {
    const records = new Map(); // tab id -> { record, list, closeAt }

    return {
        // Call with what `clearTabs` returned; tabs past their Undo window are forgotten.
        remember({ records: cleared, closeAt }) {
            for (const [tabId, entry] of records) if (entry.closeAt <= now()) records.delete(tabId);
            for (const record of cleared) records.set(record.tabId, { record, list: cleared, closeAt });
        },

        // Is the tab one that Clear is hiding.
        async isHidden(tabId) {
            return (await readHiddenIds()).includes(tabId);
        },

        // The spaces after the tab came back, or null when it was not waiting to close.
        async restore(tabId) {
            const { restored, spaces } = await restoreTab(tabId);
            if (!restored.includes(tabId)) return null;
            const entry = records.get(tabId);
            records.delete(tabId);
            if (entry) {
                // The toast's Undo reopens what is still listed, and this tab is back already.
                entry.list.splice(entry.list.indexOf(entry.record), 1);
                // Only the entry Clear added: one archived earlier stays restorable.
                if (entry.record.addedToArchive) await removeArchivedTab(entry.record.url, entry.record.spaceId);
            }
            return spaces;
        }
    };
}
