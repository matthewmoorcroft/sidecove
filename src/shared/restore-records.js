// Records of tabs to put back in their space and place when Chrome brings them back (the store's
// restoreQueue). At a browser restart they are the saved snapshot, and any tab Chrome restores may
// take one. A tab that closed with its window leaves one too (space-tab-removal.js), with
// `openWindows`, the windows open then. Only Chrome reopening that window brings such a tab back:
// it is created on its address already, as Chrome restores it with its history (a new link tab has
// only the address it is going to), with no opener, in a window that was not open then. A window
// Chrome reopens is one closed window, so once it takes one of that window's records, that closed
// window's other records are only for it, and it takes no other closed window's.
//
// Each record also has the tab's window and place in it (`windowId`, `index`; a snapshot saved by
// an older version has neither). After a restart Chrome gives every window and tab a new id, so a
// window is known by the records its tabs take: the same page open in two spaces goes back to the
// space of the window it was in, and to the record of its own place in it.

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
 *   maps each window Chrome reopened to the closed window it brought back, and `restarted` each
 *   window after a restart to the window it was before.
 * @returns {number} the index of the record the tab takes, or -1
 */
export function restoreRecordFor(queue, tab, { url, created, spaceIds, reopened, restarted = new Map() }) {
    const from = reopened.get(tab.windowId);
    const taken = new Set(reopened.values());
    const takes = record => {
        if ((record.section === 'pinnedTabs') !== Boolean(tab.pinned) || record.url !== url) return false;
        if (!spaceIds.has(record.spaceId)) return false;
        if (!record.openWindows) return true;
        if (!created || tab.url !== url || tab.openerTabId !== undefined) return false;
        if (record.openWindows.includes(tab.windowId)) return false;
        return from === undefined ? !taken.has(record.windowId) : from === record.windowId;
    };
    const was = restarted.get(tab.windowId);
    const elsewhere = new Set([...restarted].filter(([now]) => now !== tab.windowId).map(([, old]) => old));
    // The record of the window it was in counts most, then its own place; the first one wins a tie.
    const fit = record => {
        if (record.openWindows || record.windowId === undefined) return 0;
        const window = record.windowId === was ? 2 : elsewhere.has(record.windowId) ? -2 : 0;
        return window + (record.index === tab.index ? 1 : 0);
    };
    let best = -1;
    queue.forEach((record, index) => {
        if (takes(record) && (best < 0 || fit(record) > fit(queue[best]))) best = index;
    });
    return best;
}

export function noteReopened(reopened, tab, record) {
    if (record?.openWindows && !reopened.has(tab.windowId)) reopened.set(tab.windowId, record.windowId);
}

export function noteRestarted(restarted, tab, record) {
    if (!record || record.openWindows || record.windowId === undefined || restarted.has(tab.windowId)) return;
    restarted.set(tab.windowId, record.windowId);
}

// A record still waiting from an earlier session names a window of that session, not this one.
export const forSnapshot = queue =>
    queue.map(record => {
        if (record.openWindows) return record;
        const saved = { ...record };
        delete saved.windowId;
        delete saved.index;
        return saved;
    });
