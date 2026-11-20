import { pageOf } from './saved-favorites.js';

// A page open in a surviving window keeps the place it had in the list. The list puts a page where
// the earliest tab showing it sits, so when that tab is one of a closing window's, the page's
// earliest tab in another window takes its place. Returns the space's new tab order without the
// closed tab, or null when the closed tab's slot was not the page's. A saved list may have lost the
// closed tab already, so `slot` (the place it was last saved at) stands in for its index then.
export function orderAfterWindowClose({ order, removedId, page, windowId, incognito = false, slot, tabs }) {
    const found = order.indexOf(removedId);
    const at = found >= 0 ? found : Number.isInteger(slot) ? Math.min(slot, order.length) : -1;
    if (at < 0 || !page) return null;
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    const heir = order.find(id => {
        const tab = byId.get(id);
        return (
            tab &&
            id !== removedId &&
            !tab.pinned &&
            tab.windowId !== windowId &&
            Boolean(tab.incognito) === Boolean(incognito) &&
            pageOf(tab) === page
        );
    });
    if (heir === undefined || order.indexOf(heir) < at) return null;
    const next = order.filter(id => id !== removedId && id !== heir);
    next.splice(at, 0, heir);
    return next;
}
