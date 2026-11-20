/**
 * Split view in the sidebar: the menu entries that start and end a split, and what each does to
 * Chrome and to the space's tab order. The sidebar passes in what it owns.
 */
import { brokenSplitViewIds, canSplit, splitCandidates, splitViewSupported } from './split-logic.js';
import { bulkSplitEntries, tabSplitEntries } from './split-menu.js';
import { separateSplit, splitTabs, splitWithNewTab } from './split-actions.js';

/**
 * chromeApi        chrome
 * runMutation      runs a change to the list, then redraws it and reports errors
 * listedTabIds     the ordinary tabs of the active space in the order the list shows them
 * titleOf          the title the list shows for a tab id
 * placeAfter       (anchorId, movedId) puts a tab right after another in the space's order
 * adoptNewTab      (tab) files a tab Chrome just opened under the active space
 */
export function createSplitView({ chromeApi, runMutation, listedTabIds, titleOf, placeAfter, adoptNewTab }) {
    const supported = splitViewSupported(chromeApi);

    const withTab = (tabId, partnerId) =>
        runMutation(async () => {
            await splitTabs(chromeApi, tabId, partnerId);
            await placeAfter(tabId, partnerId);
        });

    const actionsFor = tabId => ({
        separate: () => runMutation(() => separateSplit(chromeApi, tabId)),
        withNewTab: () =>
            runMutation(async () => {
                const created = await splitWithNewTab(chromeApi, tabId);
                await adoptNewTab(created);
                await placeAfter(tabId, created.id);
            }),
        withTab: partnerId => withTab(tabId, partnerId)
    });

    return {
        supported,

        // Entries for one tab's menu; none where Chrome has no split view.
        async tabEntries(tabId) {
            if (!supported) return [];
            const tab = await chromeApi.tabs.get(tabId).catch(() => null);
            if (!tab) return [];
            const windowTabs = await chromeApi.tabs.query({ windowId: tab.windowId });
            const byId = new Map(windowTabs.map(t => [t.id, t]));
            const listed = listedTabIds()
                .map(id => byId.get(id))
                .filter(Boolean);
            return tabSplitEntries({
                tab,
                candidates: splitCandidates(tab, listed).map(t => ({ id: t.id, title: titleOf(t.id) || t.title })),
                actions: actionsFor(tabId)
            });
        },

        // Entries for a selection of tabs.
        async bulkEntries(tabIds) {
            if (!supported || tabIds.length !== 2) return [];
            const tabs = await Promise.all(tabIds.map(id => chromeApi.tabs.get(id).catch(() => null)));
            if (tabs.includes(null)) return [];
            return bulkSplitEntries({ tabs, actions: { withTabs: withTab } });
        },

        // After a reorder: a pair whose halves are no longer together is separated, as in Arc.
        async separateTornPairs(rows) {
            if (!supported) return;
            for (const id of brokenSplitViewIds(rows)) {
                await chromeApi.tabs.unsplit(id).catch(() => {});
            }
        },

        // Whether a tab dragged onto another may be split with it: both in the active space's
        // list and a pair Chrome accepts, exactly what the menu would offer.
        async canPair(tabId, partnerId) {
            if (!supported) return false;
            const listed = listedTabIds();
            if (!listed.includes(tabId) || !listed.includes(partnerId)) return false;
            const [tab, partner] = await Promise.all(
                [tabId, partnerId].map(id => chromeApi.tabs.get(id).catch(() => null))
            );
            return canSplit(tab, partner);
        },

        // The menu's Split View with… <tab>: `partnerId` moves next to `tabId` and they split.
        splitWith: (tabId, partnerId) => actionsFor(tabId).withTab(partnerId),

        separate: tabId => actionsFor(tabId).separate()
    };
}
