import test from 'node:test';
import assert from 'node:assert/strict';
import { hideTabs, showTabs } from '../../../src/shared/hidden-tabs.js';

const space = (id, parts = {}) => ({ id, spaceBookmarks: [], temporaryTabs: [], pinnedTabs: [], ...parts });

test('hiding takes the tabs out of every section and forgets them as the last tab', () => {
    const spaces = [space('a', { temporaryTabs: [1, 2], pinnedTabs: [3], lastTab: 2 }), space('b', { lastTab: 9 })];
    hideTabs(spaces, [2, 3]);
    assert.deepEqual(spaces[0].temporaryTabs, [1]);
    assert.deepEqual(spaces[0].pinnedTabs, []);
    assert.equal(spaces[0].lastTab, undefined);
    assert.equal(spaces[1].lastTab, 9);
});

test('showing puts tabs back in their old places, and a tab pinned meanwhile with the pinned tabs', () => {
    const target = space('a', { temporaryTabs: [1, 5], pinnedTabs: [7] });
    showTabs([target], target, { tabIds: [2, 3, 4], order: [1, 2, 3, 4], pinnedIds: new Set([3]) });
    assert.deepEqual(target.temporaryTabs, [1, 2, 4, 5]);
    assert.deepEqual(target.pinnedTabs, [7, 3]);
});
