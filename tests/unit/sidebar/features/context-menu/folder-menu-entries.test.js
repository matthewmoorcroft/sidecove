import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderMoveEntries } from '../../../../../src/sidebar/features/context-menu/folder-menu-entries.js';

const spaces = [
    { id: 'a', name: 'Home', icon: '🏠' },
    { id: 'b', name: 'Work' },
    { id: 'c', name: 'Play', icon: '🎵' }
];

test('a folder menu offers Move to Space with every other space, icon included', () => {
    const entries = folderMoveEntries({ spaces, currentSpaceId: 'a', onMove: () => {} });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, 'Move to Space');
    assert.deepEqual(
        entries[0].submenu.map(({ label, icon }) => ({ label, icon })),
        [
            { label: 'Work', icon: undefined },
            { label: 'Play', icon: '🎵' }
        ]
    );
});

test('choosing a space hands that space to onMove', () => {
    const moved = [];
    const [entry] = folderMoveEntries({ spaces, currentSpaceId: 'a', onMove: space => moved.push(space.id) });
    entry.submenu[1].action();
    assert.deepEqual(moved, ['c']);
});

test('with no other space there is no entry', () => {
    assert.deepEqual(folderMoveEntries({ spaces: [spaces[0]], currentSpaceId: 'a', onMove: () => {} }), []);
});
