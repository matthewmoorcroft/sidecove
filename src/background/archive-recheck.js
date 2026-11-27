import { isProtectedFavorite } from '../shared/favorite-safety.js';

// The archive check can take seconds with many tabs, so each tab is read again just before it
// closes: one the user switched to, played, pinned or bound to a favourite meanwhile stays open.
export function stillIdle(tab, { memberIds, bindings, urlKeys, lastActivity, now, idleMillis }) {
    if (!tab || tab.active || tab.audible || tab.pinned) return false;
    if (isProtectedFavorite(tab, memberIds, bindings, urlKeys)) return false;
    return Boolean(lastActivity) && now - lastActivity > idleMillis;
}
