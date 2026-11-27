import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlierImports, importSpaces, uniqueSpaceName } from '../../../src/shared/import-spaces.js';

// A bookmark tree in memory, with the calls importSpaces makes.
function fakeChrome({ failAfter = Infinity } = {}) {
    const nodes = new Map([['root', { id: 'root', title: 'Sidecove', children: [] }]]);
    let next = 0;
    let creates = 0;
    const bookmarks = {
        async create({ parentId, title, url }) {
            if (++creates > failAfter) throw new Error('Bookmark quota reached');
            const node = { id: `n${++next}`, parentId, title, ...(url ? { url } : { children: [] }) };
            nodes.set(node.id, node);
            nodes.get(parentId).children.push(node);
            return node;
        },
        async getChildren(id) {
            return nodes.get(id).children;
        },
        async removeTree(id) {
            const node = nodes.get(id);
            const parent = nodes.get(node.parentId);
            parent.children = parent.children.filter(child => child.id !== id);
        }
    };
    return { chrome: { bookmarks }, root: nodes.get('root') };
}

function fakeStorage(root) {
    const registry = {};
    return {
        registry,
        getOrCreateSidecoveFolder: async () => root,
        getSpaceRegistry: async () => structuredClone(registry),
        async getOrCreateSpaceRegistryEntry(folderId, attrs) {
            registry[folderId] ||= { spaceUuid: `uuid-${folderId}`, bookmarkFolderId: folderId, ...attrs };
            return registry[folderId];
        },
        async updateSpaceRegistryEntry(folderId, attrs) {
            Object.assign(registry[folderId], attrs);
        },
        async removeSpaceRegistryEntry(folderId) {
            delete registry[folderId];
        }
    };
}

function fakeStore(storage, names = []) {
    return {
        spaces: names.map(name => ({ id: name, name })),
        async makeSpace(name, color, folder) {
            const entry = storage.registry[folder.id];
            return {
                id: entry.spaceUuid,
                name,
                color,
                shade: entry.shade,
                icon: entry.icon,
                bookmarkFolderId: folder.id
            };
        }
    };
}

const titles = node => node.children.map(child => (child.url ? child.title : [child.title, titles(child)]));

test('a used name gets the source after it, compared without case', () => {
    assert.equal(uniqueSpaceName('Work', ['Home'], 'Arc'), 'Work');
    assert.equal(uniqueSpaceName('Work', ['work'], 'Arc'), 'Work (Arc)');
    assert.equal(uniqueSpaceName('Work', ['Work', 'Work (Arc)'], 'Arc'), 'Work (Arc 2)');
});

test('each planned space gets a new folder with its tabs and folders, after the existing spaces', async () => {
    const { chrome, root } = fakeChrome();
    root.children.push({ id: 'old', title: 'Work', children: [] });
    const storage = fakeStorage(root);
    const store = fakeStore(storage, ['Work']);
    const plan = {
        source: 'Arc',
        spaces: [
            {
                name: 'Work',
                color: 'blue',
                shade: '#5c8ce6',
                icon: 'symbol:briefcase',
                items: [
                    { title: 'Docs', url: 'https://example.com/docs' },
                    { title: 'Projects', children: [{ title: 'Page', url: 'https://example.com/p' }] }
                ]
            },
            { name: 'Personal', color: 'grey', items: [] }
        ]
    };
    await importSpaces(store, plan, { chrome, storage });
    assert.deepEqual(
        root.children.map(c => c.title),
        ['Work', 'Work (Arc)', 'Personal']
    );
    assert.deepEqual(root.children[0].children, [], 'the existing space is untouched');
    assert.deepEqual(titles(root.children[1]), ['Docs', ['Projects', ['Page']]]);
    assert.deepEqual(
        store.spaces.map(s => [s.name, s.color, s.shade ?? null, s.icon ?? null]),
        [
            ['Work', undefined, null, null],
            ['Work (Arc)', 'blue', '#5c8ce6', 'symbol:briefcase'],
            ['Personal', 'grey', null, null]
        ]
    );
});

test('addresses that are not web pages or files are not saved', async () => {
    const { chrome, root } = fakeChrome();
    const storage = fakeStorage(root);
    const store = fakeStore(storage);
    const items = [
        { title: 'Script', url: 'javascript:alert(1)' },
        { title: 'Arc page', url: 'arc://easel' },
        { title: 'Broken', url: 'https://[not-an-address' },
        { title: 'File', url: 'file:///Users/me/notes.html' }
    ];
    await importSpaces(store, { source: 'Arc', spaces: [{ name: 'S', color: 'grey', items }] }, { chrome, storage });
    assert.deepEqual(titles(root.children[0]), ['File']);
});

test('a failure part way removes everything the import made', async () => {
    const { chrome, root } = fakeChrome({ failAfter: 4 });
    const storage = fakeStorage(root);
    const store = fakeStore(storage, ['Mine']);
    const tabs = [1, 2, 3].map(i => ({ title: `T${i}`, url: `https://example.com/${i}` }));
    const plan = {
        source: 'Arc',
        spaces: [
            { name: 'A', color: 'grey', items: tabs },
            { name: 'B', color: 'grey', items: tabs }
        ]
    };
    await assert.rejects(importSpaces(store, plan, { chrome, storage }), /quota/);
    assert.deepEqual(root.children, []);
    assert.deepEqual(storage.registry, {});
    assert.deepEqual(
        store.spaces.map(s => s.name),
        ['Mine']
    );
});

test('earlier imports count only spaces whose folder is still there', () => {
    const registry = {
        f1: { bookmarkFolderId: 'f1', importedFrom: 'arc:A', importedFavorites: true },
        f2: { bookmarkFolderId: 'f2', importedFrom: 'arc:B' },
        f3: { bookmarkFolderId: 'f3' }
    };
    const both = earlierImports(registry, ['f1', 'f2', 'f3']);
    assert.deepEqual([...both.sources], ['arc:A', 'arc:B']);
    assert.equal(both.favorites, true);
    const gone = earlierImports(registry, ['f2']);
    assert.deepEqual([...gone.sources], ['arc:B']);
    assert.equal(gone.favorites, false);
    assert.deepEqual([...earlierImports(undefined, []).sources], []);
});

test('importing the same spaces again creates nothing, and favorites are imported once', async () => {
    const { chrome, root } = fakeChrome();
    const storage = fakeStorage(root);
    const store = fakeStore(storage);
    const favorites = {
        favorites: true,
        title: 'Favorites from Arc',
        children: [{ title: 'Mail', url: 'https://example.net/mail' }]
    };
    const space = (name, id, items = []) => ({ name, color: 'grey', importedFrom: `arc:${id}`, items });
    await importSpaces(store, { source: 'Arc', spaces: [space('Work', 'A', [favorites])] }, { chrome, storage });
    const entry = Object.values(storage.registry)[0];
    assert.equal(entry.importedFrom, 'arc:A');
    assert.equal(entry.importedFavorites, true);

    await importSpaces(
        store,
        { source: 'Arc', spaces: [space('Work', 'A', [favorites]), space('Ideas', 'C', [favorites])] },
        { chrome, storage }
    );
    assert.deepEqual(
        root.children.map(c => c.title),
        ['Work', 'Ideas']
    );
    assert.deepEqual(titles(root.children[1]), [], 'favorites are not imported a second time');
    assert.deepEqual(
        store.spaces.map(s => s.name),
        ['Work', 'Ideas']
    );

    // Once the imported space is deleted, it can be imported again.
    await chrome.bookmarks.removeTree(root.children[0].id);
    store.spaces = store.spaces.filter(s => s.name !== 'Work');
    await importSpaces(store, { source: 'Arc', spaces: [space('Work', 'A', [favorites])] }, { chrome, storage });
    assert.deepEqual(
        root.children.map(c => c.title),
        ['Ideas', 'Work']
    );
    assert.deepEqual(titles(root.children[1]), [['Favorites from Arc', ['Mail']]]);
});
