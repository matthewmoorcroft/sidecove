import { CLOSED_LINKS_KEY, CLOSED_LINKS_MESSAGE, linksFrom } from '../../../shared/closed-links.js';

// Panels never write the links; the service worker does (background/closed-links.js).
async function request(action, payload = {}, runtime = chrome.runtime) {
    const response = await runtime.sendMessage({ type: CLOSED_LINKS_MESSAGE, action, ...payload });
    if (!response?.success) throw new Error(response?.error || 'Closed links are unavailable');
    return response;
}

export const openClosedLink = (linkId, windowId) => request('open', { linkId, windowId });
export const removeClosedLink = linkId => request('remove', { linkId });

export async function readClosedLinks(storage = chrome.storage.local) {
    return linksFrom(await storage.get(CLOSED_LINKS_KEY));
}

// Clear takes a space's links out of its list and puts them in Archived. `undo` puts them back
// and takes out of Archived what Clear added there.
export async function clearClosedLinks(spaceId, runtime = chrome.runtime) {
    const { cleared } = await request('clear', { spaceId }, runtime);
    return {
        count: cleared.length,
        undo: () => (cleared.length ? request('restore', { cleared }, runtime) : Promise.resolve())
    };
}

export const clearedMessage = (tabs, links) => {
    const count = tabs + links;
    return `Closed ${count} ${count === 1 ? 'tab' : 'tabs'}. They're in Archived.`;
};
