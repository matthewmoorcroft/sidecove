import { SAVED_FAVORITES_MESSAGE } from '../../../shared/saved-favorites.js';

// Panels never write the saved list; the service worker does (background/saved-favorites.js).
export async function savedFavoritesRequest(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type: SAVED_FAVORITES_MESSAGE, action, ...payload });
    if (!response?.success) throw new Error(response?.error || 'Saved favorites are unavailable');
}
