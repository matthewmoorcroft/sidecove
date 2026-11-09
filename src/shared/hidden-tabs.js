import { sections } from './space-membership.js';
import { restoreTabOrder } from './pending-clean.js';

// Clean All takes the tabs it clears out of every space while its Undo toast is on screen.
export function hideTabs(spaces, tabIds) {
    for (const space of spaces) {
        for (const key of sections) space[key] = space[key].filter(id => !tabIds.includes(id));
        // A hidden tab must not be what the space reopens on.
        if (tabIds.includes(space.lastTab)) delete space.lastTab;
    }
}

// Puts hidden tabs back into `target`: in their old places in the list, except a tab pinned
// meanwhile, which belongs with the pinned tabs.
export function showTabs(spaces, target, { tabIds, order, pinnedIds }) {
    for (const space of spaces) for (const key of sections) space[key] = space[key].filter(id => !tabIds.includes(id));
    target.pinnedTabs.push(...tabIds.filter(id => pinnedIds.has(id)));
    target.temporaryTabs = restoreTabOrder(
        target.temporaryTabs,
        order,
        tabIds.filter(id => !pinnedIds.has(id))
    );
}
