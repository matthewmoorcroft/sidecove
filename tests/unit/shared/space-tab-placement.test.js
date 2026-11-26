import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkTails } from '../../../src/shared/link-tab-placement.js';
import { placeNewTab } from '../../../src/shared/space-tab-placement.js';

const newStore = invertTabOrder => ({ invertTabOrder, linkTails: new LinkTails(), restoredMetadata: [] });
const onScreen = (store, ids) => (store.invertTabOrder ? [...ids].reverse() : ids);

test('a copy goes directly beneath the tab it copies, ahead of its links, whichever way the list is drawn', () => {
    for (const inverted of [false, true]) {
        const store = newStore(inverted);
        const space = { temporaryTabs: onScreen(store, [1, 2, 3]) };
        placeNewTab(store, space, 'temporaryTabs', { id: 5, openerTabId: 2, url: 'https://x.test/' }, {});
        placeNewTab(store, space, 'temporaryTabs', { id: 8, openerTabId: 2, copyOf: 2 }, {});
        assert.deepEqual(onScreen(store, space.temporaryTabs), [1, 2, 8, 5, 3], `inverted: ${inverted}`);
        // The copy is not one of the tab's links.
        assert.deepEqual(store.linkTails.entries(), [[2, [5]]]);
    }
});

test('a tab with no opener goes at the end, and a restored tab takes its stored place', () => {
    const store = newStore(false);
    const space = { temporaryTabs: [1, 2] };
    placeNewTab(store, space, 'temporaryTabs', { id: 3 }, {});
    assert.deepEqual(space.temporaryTabs, [1, 2, 3]);
    store.restoredRanks = new Map([
        [1, 0],
        [2, 2],
        [3, 3]
    ]);
    placeNewTab(store, space, 'temporaryTabs', { id: 4 }, { restored: { order: 1 } });
    assert.deepEqual(space.temporaryTabs, [1, 4, 2, 3]);
    assert.deepEqual(store.restoredMetadata, [{ order: 1, tabId: 4 }]);
});
