import { pickAction } from './all-windows.js';

// The list shows the other window's entry until it redraws with the new tab, so a quick second
// click within this time does not open the page twice.
export const REOPEN_GUARD_MS = 1500;

// Picks an entry as pickAction says, with `tabs` being chrome.tabs.
export function createOpenHere(tabs, { schedule = setTimeout } = {}) {
    const opening = new Set();
    return async function openHere(tab, windowId) {
        const action = pickAction(tab, windowId);
        if (action.activate != null) return tabs.update(action.activate, { active: true });
        const { url, pinned } = action.open;
        const key = `${pinned}:${url}`;
        if (!url || opening.has(key)) return null;
        opening.add(key);
        try {
            return await tabs.create(action.open);
        } finally {
            schedule(() => opening.delete(key), REOPEN_GUARD_MS);
        }
    };
}
