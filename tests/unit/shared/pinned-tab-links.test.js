import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LinkTails } from '../../../src/shared/link-tab-placement.js';
import {
    LinkPins,
    PINNED_TAB_LINKS,
    nameLinkPin,
    opensLinksAsPinnedTabs,
    pinWaitingLink,
    pinnedLinkIndex
} from '../../../src/shared/pinned-tab-links.js';

const marks = ids => ids.map(id => ({ id }));

test('only the pin value makes links from a pinned tab new pinned tabs; anything else is the tab list', () => {
    assert.equal(opensLinksAsPinnedTabs(PINNED_TAB_LINKS.PIN), true);
    for (const value of [PINNED_TAB_LINKS.LIST, undefined, null, true, 'Pin', ''])
        assert.equal(opensLinksAsPinnedTabs(value), false);
});

test('links from a pinned tab stack directly beneath it in opening order', () => {
    const tails = new LinkTails();
    // Bookmarks a, P (open as tab 2) and b; b is not open.
    assert.equal(pinnedLinkIndex(marks(['a', 'p', 'b']), 'p', new Map([['p', 2]]), 2, 4, tails), 2);
    const after4 = new Map([
        ['p', 2],
        ['n4', 4]
    ]);
    assert.equal(pinnedLinkIndex(marks(['a', 'p', 'n4', 'b']), 'p', after4, 2, 5, tails), 3);
    after4.set('n5', 5);
    assert.equal(pinnedLinkIndex(marks(['a', 'p', 'n4', 'n5', 'b']), 'p', after4, 2, 6, tails), 4);
});

test('after switching back to the pinned tab, its next link goes directly beneath it again', () => {
    const tails = new LinkTails();
    const open = new Map([['p', 2]]);
    assert.equal(pinnedLinkIndex(marks(['p']), 'p', open, 2, 4, tails), 1);
    open.set('n4', 4);
    tails.switchedTo(2);
    assert.equal(pinnedLinkIndex(marks(['p', 'n4']), 'p', open, 2, 5, tails), 1);
});

test('a link moved away from under the pinned tab no longer decides where the next goes', () => {
    const tails = new LinkTails();
    const open = new Map([['p', 2]]);
    pinnedLinkIndex(marks(['p', 'x']), 'p', open, 2, 4, tails);
    open.set('n4', 4);
    // The user dragged n4 below x.
    assert.equal(pinnedLinkIndex(marks(['p', 'x', 'n4']), 'p', open, 2, 5, tails), 1);
});

let bookmarks, bindings, liveTabs, store, created;

function fakeChrome() {
    return {
        bookmarks: {
            get: async id => {
                const node = bookmarks.find(b => b.id === id);
                return node ? [{ ...node }] : Promise.reject(new Error('missing'));
            },
            getChildren: async parentId =>
                bookmarks.filter(b => b.parentId === parentId).sort((a, b) => a.index - b.index),
            create: async ({ parentId, index, title, url }) => {
                const siblings = bookmarks.filter(b => b.parentId === parentId);
                for (const sibling of siblings) if (sibling.index >= index) sibling.index++;
                const node = { id: `new${created.length}`, parentId, index, title, url };
                bookmarks.push(node);
                created.push(node);
                return node;
            },
            update: async (id, { title }) => {
                bookmarks.find(b => b.id === id).title = title;
            }
        },
        tabs: {
            get: async id => liveTabs.find(t => t.id === id) || Promise.reject(new Error('no tab'))
        },
        storage: {
            local: {
                get: async () => ({ pinnedTabStatesById: structuredClone(bindings) }),
                set: async ({ pinnedTabStatesById }) => {
                    bindings = structuredClone(pinnedTabStatesById);
                }
            }
        }
    };
}

beforeEach(() => {
    // Space folder s holds a, the folder f (with c and the pinned tab q inside) and the pinned tab p.
    bookmarks = [
        { id: 's', parentId: 'root', index: 0 },
        { id: 'a', parentId: 's', index: 0, url: 'https://a.test/', title: 'A' },
        { id: 'f', parentId: 's', index: 1 },
        { id: 'c', parentId: 'f', index: 0, url: 'https://c.test/', title: 'C' },
        { id: 'q', parentId: 'f', index: 1, url: 'https://q.test/', title: 'Q' },
        { id: 'p', parentId: 's', index: 2, url: 'https://p.test/', title: 'P' }
    ];
    bindings = {
        2: { pinnedUrl: 'https://p.test/', bookmarkId: 'p' },
        3: { pinnedUrl: 'https://q.test/', bookmarkId: 'q' }
    };
    liveTabs = [
        { id: 2, windowId: 1 },
        { id: 3, windowId: 1 }
    ];
    created = [];
    store = {
        spaces: [{ id: 'space', bookmarkFolderId: 's', spaceBookmarks: [2, 3], temporaryTabs: [9], pinnedTabs: [] }],
        linkTails: new LinkTails(),
        linkPins: new LinkPins(),
        invertTabOrder: true
    };
    globalThis.chrome = fakeChrome();
});

// As the store's track does with the setting on: the tab is filed under the pinned tabs first.
async function openLink(id, openerId, tab = {}) {
    const link = { id, windowId: 1, url: `https://link${id}.test/`, title: '', ...tab };
    liveTabs.push(link);
    store.spaces[0].spaceBookmarks.push(id);
    store.linkPins.wait(id, openerId);
    await pinWaitingLink(chrome, store, link);
    return link;
}

test('the new pinned tab gets a bookmark directly beneath its pinned tab, bound to it', async () => {
    await openLink(4, 2);
    await openLink(5, 2);
    assert.deepEqual(
        (await chrome.bookmarks.getChildren('s')).map(b => b.id),
        ['a', 'f', 'p', 'new0', 'new1']
    );
    assert.deepEqual(bindings[4], { pinnedUrl: 'https://link4.test/', bookmarkId: 'new0' });
    assert.deepEqual(store.spaces[0].spaceBookmarks, [2, 3, 4, 5]);
    assert.deepEqual(store.spaces[0].temporaryTabs, [9]);
    // Named after its address until the page has a title.
    assert.equal(created[0].title, 'https://link4.test/');
    assert.equal(store.linkPins.waiting.size, 0);
});

test('a link from a pinned tab inside a folder becomes a pinned tab in that folder, beneath it', async () => {
    await openLink(4, 3);
    assert.deepEqual(
        (await chrome.bookmarks.getChildren('f')).map(b => b.id),
        ['c', 'q', 'new0']
    );
    assert.deepEqual(
        (await chrome.bookmarks.getChildren('s')).map(b => b.id),
        ['a', 'f', 'p']
    );
});

test('a link tab without an address yet waits, and is pinned once Chrome names it', async () => {
    const link = await openLink(4, 2, { url: '' });
    assert.equal(created.length, 0);
    assert.equal(store.linkPins.waiting.get(4), 2);
    await pinWaitingLink(chrome, store, { ...link, url: 'about:blank' });
    assert.equal(created.length, 0);
    await pinWaitingLink(chrome, store, { ...link, url: 'https://late.test/' });
    assert.equal(created[0].url, 'https://late.test/');
    assert.equal(created[0].parentId, 's');
});

test('a link that cannot be pinned there opens in the tab list instead', async () => {
    const cases = {
        'opened into another window': () => openLink(4, 2, { windowId: 7 }),
        'opener without a bookmark': () => {
            delete bindings[2];
            return openLink(4, 2);
        },
        'opener bookmark outside the space folder': () => {
            bookmarks.find(b => b.id === 'p').parentId = 'elsewhere';
            return openLink(4, 2);
        }
    };
    for (const [name, open] of Object.entries(cases)) {
        const saved = { bookmarks: structuredClone(bookmarks), bindings: structuredClone(bindings) };
        await open();
        assert.equal(created.length, 0, name);
        assert.deepEqual(store.spaces[0].spaceBookmarks, [2, 3], name);
        // Drawn reversed: the top of the list, where links from outside the list go.
        assert.deepEqual(store.spaces[0].temporaryTabs, [9, 4], name);
        ({ bookmarks, bindings } = saved);
        store.spaces[0].temporaryTabs = [9];
        liveTabs = liveTabs.filter(t => t.id !== 4);
    }
});

test('a New Tab that names a pinned tab as its opener is not pinned and goes where new tabs go', async () => {
    store.invertTabOrder = false;
    await openLink(4, 2, { url: '', pendingUrl: 'chrome://newtab/' });
    assert.equal(created.length, 0);
    assert.deepEqual(store.spaces[0].spaceBookmarks, [2, 3]);
    assert.deepEqual(store.spaces[0].temporaryTabs, [9, 4]);
});

test('a link tab closed or moved before it is pinned is left alone', async () => {
    store.linkPins.wait(4, 2);
    await pinWaitingLink(chrome, store, { id: 4, windowId: 1, url: 'https://gone.test/' });
    assert.equal(created.length, 0);
    store.linkPins.wait(5, 2);
    store.linkPins.closed(5);
    assert.equal(store.linkPins.waiting.size, 0);
});

test('the bookmark takes the page title once loaded, but keeps a name given in the meantime', async () => {
    const link = await openLink(4, 2);
    await nameLinkPin(chrome, store, { ...link, status: 'loading', title: 'Half' });
    assert.equal(created[0].title, 'https://link4.test/');
    await nameLinkPin(chrome, store, { ...link, status: 'complete', title: 'Link four' });
    assert.equal(created[0].title, 'Link four');
    assert.equal(store.linkPins.titles.size, 0);

    const renamed = await openLink(5, 2);
    created[1].title = 'My name';
    await nameLinkPin(chrome, store, { ...renamed, status: 'complete', title: 'Link five' });
    assert.equal(created[1].title, 'My name');
});

test('a page that finished loading before its pin was made is named at once', async () => {
    // Chrome reported the tab with no title; by the time it is pinned the page has loaded.
    liveTabs.push({ id: 4, windowId: 1, url: 'https://link4.test/', status: 'complete', title: 'Already here' });
    store.spaces[0].spaceBookmarks.push(4);
    store.linkPins.wait(4, 2);
    await pinWaitingLink(chrome, store, { id: 4, windowId: 1, url: 'https://link4.test/', title: '' });
    assert.equal(created[0].title, 'Already here');
    assert.equal(store.linkPins.titles.size, 0);
});

test('waiting links and titles survive a worker restart and follow a replaced tab', () => {
    const pins = new LinkPins();
    pins.wait(4, 2);
    pins.titles.set(5, { bookmarkId: 'b', title: 't' });
    const restarted = new LinkPins(structuredClone(pins.entries()));
    restarted.replaced(40, 4);
    restarted.replaced(20, 2);
    assert.deepEqual(restarted.entries(), { waiting: [[40, 20]], titles: [[5, { bookmarkId: 'b', title: 't' }]] });
    restarted.closed(20);
    assert.deepEqual(restarted.entries().waiting, []);
});
