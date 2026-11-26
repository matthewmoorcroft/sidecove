import test from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedFavorite } from '../../../src/shared/favorite-safety.js';

test('navigated favorites remain protected by membership or binding, not only live URL', () => {
    const tab = { id: 7, url: 'https://elsewhere.test/other' };
    assert.equal(isProtectedFavorite(tab, new Set([7]), {}, new Set()), true);
    assert.equal(isProtectedFavorite(tab, new Set(), { 7: { bookmarkId: 'b' } }, new Set()), true);
    assert.equal(isProtectedFavorite(tab, new Set(), {}, new Set()), false);
    assert.equal(isProtectedFavorite({ ...tab, pinned: true }, new Set(), {}, new Set()), true);
});

test('Sidecove’s own settings and setup-guide tabs are never swept up with other tabs', () => {
    globalThis.chrome = { runtime: { getURL: path => `chrome-extension://sidecove/${path}` } };
    try {
        for (const page of ['options.html', 'installation-onboarding.html']) {
            const own = { id: 7, url: `chrome-extension://sidecove/${page}` };
            assert.equal(isProtectedFavorite(own, new Set(), {}, new Set()), true, page);
            assert.equal(isProtectedFavorite({ id: 7, pendingUrl: own.url }, new Set(), {}, new Set()), true, page);
        }
        const other = { id: 8, url: 'chrome-extension://sidecove/offscreen.html' };
        assert.equal(isProtectedFavorite(other, new Set(), {}, new Set()), false);
        assert.equal(
            isProtectedFavorite({ id: 9, url: 'https://x.test/options.html' }, new Set(), {}, new Set()),
            false
        );
    } finally {
        delete globalThis.chrome;
    }
});
