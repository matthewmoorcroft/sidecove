import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_FOLDER_TITLE } from '../../constants.js';
import { LocalStorage } from '../../localstorage.js';
import { BookmarkUtils } from '../../bookmark-utils.js';
import { readBookmarkSpaces } from '../../onboarding-bookmarks.js';
import { getSpaceBookmarkFolder } from '../../space-bookmarks.js';

// A bookmark tree holding a root folder another extension left behind, and optionally a Sidecove root.
// Only the exact Sidecove title is ever adopted, whatever the other folder is called.
function mock({ sidecove = false } = {}) {
    const nodes = [
        { id: '0', title: '' }, { id: '2', parentId: '0', title: 'Other bookmarks' },
        { id: 'upstream', parentId: '2', title: 'Upstream' }, { id: 'upstream-space', parentId: 'upstream', title: 'Work' }
    ];
    if (sidecove) nodes.push({ id: 'sidecove', parentId: '2', title: 'Sidecove' }, { id: 'sidecove-space', parentId: 'sidecove', title: 'Home' });
    const writes = [];
    globalThis.chrome = { bookmarks: {
        async search({ title }) { return nodes.filter(node => node.title === title); },
        async get(id) { return nodes.filter(node => node.id === id); },
        async getChildren(id) { return nodes.filter(node => node.parentId === id); },
        async create(details) { writes.push(['create', details]); const node = { id: 'created', parentId: '2', ...details }; nodes.push(node); return node; },
        async update(id, changes) { writes.push(['update', id, changes]); },
        async move(id, destination) { writes.push(['move', id, destination]); }
    } };
    return { writes };
}

test('the root bookmark folder is titled Sidecove', () => {
    assert.equal(ROOT_FOLDER_TITLE, 'Sidecove');
});

test('a fresh install creates a Sidecove folder and leaves a folder from another extension untouched', async () => {
    const { writes } = mock();
    const folder = await LocalStorage.getOrCreateSidecoveFolder();
    assert.equal(folder.title, 'Sidecove');
    assert.deepEqual(writes, [['create', { title: 'Sidecove' }]]);
});

test('an existing Sidecove folder is reused without writes', async () => {
    const { writes } = mock({ sidecove: true });
    assert.equal((await LocalStorage.getOrCreateSidecoveFolder()).id, 'sidecove');
    assert.equal((await BookmarkUtils.findSidecoveFolder()).id, 'sidecove');
    assert.deepEqual(writes, []);
});

test('lookups never adopt a folder from another extension', async () => {
    mock();
    assert.equal(await BookmarkUtils.findSidecoveFolder(), null);
    assert.deepEqual(await readBookmarkSpaces(), { folderId: null, names: [] });
    await assert.rejects(getSpaceBookmarkFolder({ bookmarkFolderId: 'upstream-space' }), /Sidecove folder/);
});

test('setup reads spaces from the Sidecove folder only', async () => {
    mock({ sidecove: true });
    assert.deepEqual(await readBookmarkSpaces(), { folderId: 'sidecove', names: ['Home'] });
    assert.equal((await getSpaceBookmarkFolder({ bookmarkFolderId: 'sidecove-space' })).id, 'sidecove-space');
});
