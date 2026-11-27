import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countBookmarks } from '../../../../../src/sidebar/features/space-options/space-options-menu.js';

test('counts the bookmarks in a folder and all its subfolders', () => {
    const tree = { children: [{ url: 'a' }, { children: [{ url: 'b' }, { children: [] }, { url: 'c' }] }] };
    assert.equal(countBookmarks(tree), 3);
    assert.equal(countBookmarks({ children: [] }), 0);
});
