import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asFiled, copiedTab } from '../../../src/shared/duplicate-tab.js';

const tab = (id, index, url, extra = {}) => ({ id, windowId: 1, index, pinned: false, url, ...extra });
const strip = [tab(1, 0, 'https://a.test/'), tab(2, 1, 'https://b.test/'), tab(3, 2, 'https://c.test/')];

test('a new tab right of a tab on the same address is its copy', () => {
    assert.equal(copiedTab(tab(9, 2, 'https://b.test/'), strip)?.id, 2);
    assert.equal(copiedTab(tab(9, 2, undefined, { pendingUrl: 'https://b.test/' }), strip)?.id, 2);
    const pins = [tab(1, 0, 'https://p.test/', { pinned: true })];
    assert.equal(copiedTab(tab(9, 1, 'https://p.test/', { pinned: true }), pins)?.id, 1);
});

test('a link, or a new tab on another address, is not a copy', () => {
    assert.equal(copiedTab(tab(9, 2, 'https://link.test/', { openerTabId: 2 }), strip), null);
    assert.equal(copiedTab(tab(9, 3, 'https://b.test/'), strip), null, 'not directly right of it');
    const pins = [tab(1, 0, 'https://p.test/', { pinned: true })];
    assert.equal(copiedTab(tab(9, 1, 'https://p.test/'), pins), null, 'a pinned tab next to an ordinary one');
});

test('a tab in another window, or with no address or place yet, is not a copy', () => {
    assert.equal(copiedTab(tab(9, 2, 'https://b.test/', { windowId: 2 }), strip), null);
    assert.equal(copiedTab(tab(9, 2, undefined), strip), null);
    assert.equal(copiedTab(tab(9, undefined, 'https://b.test/'), strip), null);
});

test('a blank or New Tab page next to another is not a copy', () => {
    for (const url of ['about:blank', 'chrome://newtab/', 'chrome://new-tab-page/']) {
        assert.equal(copiedTab(tab(9, 1, url), [tab(1, 0, url)]), null, url);
    }
});

test('a copy is filed as beneath the tab it copies, and remembered as a copy', async () => {
    const chromeApi = { tabs: { query: async ({ windowId }) => strip.filter(t => t.windowId === windowId) } };
    const store = { copies: new Set() };
    const copy = tab(9, 2, 'https://b.test/', { openerTabId: 3 });
    assert.deepEqual(await asFiled(chromeApi, store, copy), { ...copy, openerTabId: 2, copyOf: 2 });
    assert.deepEqual([...store.copies], [9]);
    const link = tab(10, 2, 'https://link.test/', { openerTabId: 2 });
    assert.equal(await asFiled(chromeApi, store, link), link);
    assert.deepEqual([...store.copies], [9]);
});
