import { spaceForActivation } from '../shared/space-membership.js';
import { tabCycleOrder, adjacentTabId } from '../shared/tab-step.js';

// The next and previous tab in space shortcuts: from the focused window's active tab, walk the
// pinned tabs and then the space's tabs. A shared pinned tab belongs to no one space, so the
// space the panel shows decides, as for the recent-tab shortcut. `chromeApi` is passed in so tests
// can fake it; `readState` returns the spaces, the space shown per window and the two settings.
export async function stepTabInSpace({ chromeApi, readState, direction }) {
    const window = await chromeApi.windows.getLastFocused({ windowTypes: ['normal'] });
    const [state, windowTabs] = await Promise.all([readState(), chromeApi.tabs.query({ windowId: window.id })]);
    const active = windowTabs.find(tab => tab.active);
    if (!active) return null;
    const { spaces, activeSpaces, perSpaceFavorites, invertTabOrder } = state;
    const space =
        spaceForActivation(spaces, active.id, perSpaceFavorites) ||
        spaces.find(s => s.id === activeSpaces?.[window.id]);
    if (!space) return null;
    const ordered = tabCycleOrder(space, {
        pinnedIds: windowTabs
            .filter(tab => tab.pinned)
            .sort((a, b) => a.index - b.index)
            .map(tab => tab.id),
        perSpaceFavorites,
        invertTabOrder,
        openTabIds: new Set(windowTabs.map(tab => tab.id))
    });
    const targetId = adjacentTabId(ordered, active.id, direction);
    if (targetId === null) return null;
    await chromeApi.tabs.update(targetId, { active: true });
    return targetId;
}
