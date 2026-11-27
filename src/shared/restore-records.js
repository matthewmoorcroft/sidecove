// Records of tabs to put back in their space and place when Chrome brings them back (the store's
// restoreQueue). At a browser restart they are the saved snapshot, and any tab Chrome restores may
// take one. A tab that closed with its window leaves one too (space-tab-removal.js), with
// `openWindows`, the windows open then. Only Chrome reopening that window brings such a tab back:
// it is created on its address already, as Chrome restores it with its history (a new link tab has
// only the address it is going to), with no opener, in a window that was not open then. A window
// Chrome reopens is one closed window, so once it takes one of that window's records, that closed
// window's other records are only for it, and it takes no other closed window's.

export const windowCloseRecord = (record, windowId, openWindows) => ({ ...record, windowId, openWindows });

// Window ids start again with a new browser session, so the records become ordinary ones.
export const forNewSession = records =>
    records.map(record => {
        const ordinary = { ...record };
        delete ordinary.openWindows;
        return ordinary;
    });

/**
 * @param {object[]} queue the records waiting
 * @param {chrome.tabs.Tab} tab the tab being filed
 * @param {object} context `url` its address; `created` true when Chrome has just created or
 *   listed it, false when it is filed again later; `spaceIds` the spaces there are; `reopened`
 *   maps each window Chrome reopened to the closed window it brought back.
 * @returns {number} the index of the record the tab takes, or -1
 */
export function restoreRecordFor(queue, tab, { url, created, spaceIds, reopened }) {
    const from = reopened.get(tab.windowId);
    const taken = new Set(reopened.values());
    return queue.findIndex(record => {
        if ((record.section === 'pinnedTabs') !== Boolean(tab.pinned) || record.url !== url) return false;
        if (!spaceIds.has(record.spaceId)) return false;
        if (!record.openWindows) return true;
        if (!created || tab.url !== url || tab.openerTabId !== undefined) return false;
        if (record.openWindows.includes(tab.windowId)) return false;
        return from === undefined ? !taken.has(record.windowId) : from === record.windowId;
    });
}

export function noteReopened(reopened, tab, record) {
    if (record?.openWindows && !reopened.has(tab.windowId)) reopened.set(tab.windowId, record.windowId);
}
