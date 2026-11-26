import { Utils } from './utils.js';
import { isOwnPageUrl } from './extension-pages.js';

// Tabs that Clear, Clean All, auto-archive and the empty-New-Tab sweep must leave open: favorites,
// and Sidecove's own settings and setup-guide tabs, which are listed like any tab but are not
// pages to archive. URL matching is conservative extra protection, never bookmark identity.
export function isProtectedFavorite(tab, memberIds, bindings, urlKeys) {
    return (
        tab.pinned ||
        isOwnPageUrl(tab.url || tab.pendingUrl) ||
        memberIds.has(tab.id) ||
        Boolean(bindings[tab.id]?.bookmarkId) ||
        urlKeys.has(Utils.getPinnedUrlKey(tab.url))
    );
}
