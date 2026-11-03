/**
 * Clean All - close a space's temporary tabs without losing them.
 *
 * Arc's Clear can be undone and its tabs stay in the archive. Here every closed tab is
 * archived first, and the returned records let Undo reopen exactly what was closed.
 * Chrome and storage calls are injected so the order of operations can be tested.
 */

export async function archiveAndCloseTabs(tabs, spaceId, { addArchivedTab, removeTabs }) {
    if (!tabs.length) return [];
    const records = [];
    for (const tab of tabs) {
        const addedToArchive = await addArchivedTab({ url: tab.url, name: tab.title || tab.url, spaceId });
        records.push({ url: tab.url, spaceId, addedToArchive: addedToArchive === true });
    }
    await removeTabs(tabs.map(tab => tab.id));
    return records;
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
