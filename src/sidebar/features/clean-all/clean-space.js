import { clearTabs, closableTabs, undoClear } from './clean-all.js';
import { UNDO_WINDOW_MS, CLOSE_GRACE_MS } from '../../../shared/pending-clean.js';
import { Logger } from '../../../shared/logger.js';

// The Clear button: closes a space's open tabs (never favorites) into Archived, with Undo. `d` is
// what the panel gives it to work with.
export async function cleanSpace(spaceId, d) {
    Logger.log('Cleaning temporary tabs for space:', spaceId);
    const space = d.spaces().find(s => s.id === spaceId);
    if (!space) return;

    // Only close live tabs owned by this space, protecting favorite bindings.
    const ownedTabs = await d.ownedTabs(spaceId);
    const protectedIds = new Set(space.spaceBookmarks);
    const favoriteUrlKeys = await d.favoriteUrlKeys(space);
    const bindings = await d.pinnedStates();
    const closable = closableTabs(ownedTabs, { protectedIds, bindings, favoriteUrlKeys });
    if (!closable.length) return;

    // Clear in display order so Undo shows them the way they were listed.
    const displayOrder = d.tempSectionTabIds(spaceId);
    closable.sort((a, b) => displayOrder.indexOf(a.id) - displayOrder.indexOf(b.id));
    await d.pendingSaves();
    const cleared = await clearTabs(closable, spaceId, [...space.temporaryTabs], {
        addArchivedTab: entry => d.addArchivedTab(entry),
        removeArchivedTab: (url, targetSpaceId) => d.removeArchivedTab(url, targetSpaceId),
        activeTabId: d.activeTabId(),
        displayOrder: d.displayedTabIds(spaceId),
        openTabIds: d.openTabIds,
        activateTab: d.activateTab,
        openNewTab: d.openNewTab,
        startPendingClean: d.startPendingClean
    });
    if (!cleared) return;
    // The tabs stay open but leave the list at once.
    d.clearedTabs.remember(cleared);
    await d.adoptStoredSpaces(cleared.spaces);

    // Arc's Clear can be undone, and the tabs also stay in Archived.
    const count = cleared.records.length;
    d.showUndoToast(
        `Closed ${count} ${count === 1 ? 'tab' : 'tabs'}. They're in Archived.`,
        async () => {
            const invertTabOrder = await d.invertTabOrder();
            await d.pendingSaves();
            await undoClear(cleared.records, cleared.batchId, d.windowId, invertTabOrder, {
                undoPendingClean: d.undoPendingClean,
                createTab: props => d.createTab(props),
                assignTab: d.assignTab,
                removeArchivedTab: (url, targetSpaceId) => d.removeArchivedTab(url, targetSpaceId)
            });
            await d.adoptStoredSpaces(await d.fetchSpaces());
            await d.refresh();
        },
        // Ends before the worker closes the tabs, however long the round trip and render took.
        Math.min(UNDO_WINDOW_MS, cleared.closeAt - Date.now() - CLOSE_GRACE_MS / 2)
    );
}
