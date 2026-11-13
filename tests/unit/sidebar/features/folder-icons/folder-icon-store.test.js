import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    folderIconChanges,
    folderIconKey,
    loadFolderIcon,
    removeFolderIcons,
    saveFolderIcon
} from '../../../../../src/sidebar/features/folder-icons/folder-icon-store.js';

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        get: async key => (key in data ? { [key]: data[key] } : {}),
        set: async patch => Object.assign(data, patch),
        remove: async keys => [keys].flat().forEach(key => delete data[key])
    };
}

test('a folder icon is stored per folder and read back', async () => {
    const storage = memoryStorage();
    assert.equal(await loadFolderIcon(storage, '12'), null);
    assert.equal(await saveFolderIcon(storage, '12', '🎵'), '🎵');
    assert.equal(await saveFolderIcon(storage, '13', 'symbol:briefcase'), 'symbol:briefcase');
    assert.equal(await loadFolderIcon(storage, '12'), '🎵');
    assert.equal(await loadFolderIcon(storage, '13'), 'symbol:briefcase');
    assert.deepEqual(Object.keys(storage.data).sort(), [folderIconKey('12'), folderIconKey('13')]);
});

test('removing the icon, or saving one that is not valid, deletes the key', async () => {
    const storage = memoryStorage({ [folderIconKey('12')]: '🎵', [folderIconKey('13')]: '⭐' });
    assert.equal(await saveFolderIcon(storage, '12', null), null);
    assert.equal(await saveFolderIcon(storage, '13', 'not one icon'), null);
    assert.deepEqual(storage.data, {});
});

test('a stored value that is not a valid icon reads as none', async () => {
    const storage = memoryStorage({ [folderIconKey('12')]: 'two words' });
    assert.equal(await loadFolderIcon(storage, '12'), null);
});

test('a folder without an id has no icon and nothing is written', async () => {
    const storage = memoryStorage();
    assert.equal(await loadFolderIcon(storage, undefined), null);
    assert.equal(await saveFolderIcon(storage, '', '🎵'), null);
    assert.deepEqual(storage.data, {});
});

test('deleted folders lose their icons and others keep theirs', async () => {
    const storage = memoryStorage({
        [folderIconKey('1')]: '🎵',
        [folderIconKey('2')]: '⭐',
        [folderIconKey('3')]: '🔥'
    });
    await removeFolderIcons(storage, ['1', undefined, '3']);
    assert.deepEqual(storage.data, { [folderIconKey('2')]: '⭐' });
});

test('storage changes are read as folder icon updates, ignoring other keys', () => {
    assert.deepEqual(
        folderIconChanges({
            [folderIconKey('7')]: { oldValue: '⭐', newValue: '🎵' },
            [folderIconKey('8')]: { oldValue: '⭐' },
            'folderCollapsed:7': { newValue: true },
            spaces: { newValue: [] }
        }),
        [
            ['7', '🎵'],
            ['8', null]
        ]
    );
});
