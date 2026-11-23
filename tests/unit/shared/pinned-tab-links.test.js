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
            remove: async id => {
                bookmarks = bookmarks.filter(b => b.id !== id);
            },
            update: async (id, changes) => {
                Object.assign(
                    bookmarks.find(b => b.id === id),
                    changes
                );
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
        { id: 2, windowId: 1, url: 'https://p.test/' },
        { id: 3, windowId: 1, url: 'https://q.test/' }
    ];
    created = [];
    store = {
        spaces: [{ id: 'space', bookmarkFolderId: 's', spaceBookmarks: [2, 3], temporaryTabs: [9], pinnedTabs: [] }],
        linkTails: new LinkTails(),
        linkPins: new LinkPins(),
        restoredRanks: new Map(),
        pinsLinks: true,
        invertTabOrder: true
    };
    globalThis.chrome = fakeChrome();
});

// As the worker does when Chrome creates the tab: the store files it in the tab list (at the top,
// drawn reversed), then it is noted and pinned if it can be.
async function openLink(id, openerTabId, tab = {}) {
    const link = { id, windowId: 1, openerTabId, url: `https://link${id}.test/`, title: '', ...tab };
    liveTabs.push(link);
    store.spaces[0].temporaryTabs = store.linkTails.place(store.spaces[0].temporaryTabs, openerTabId, id, true);
    store.linkPins.noteNewTab(store, link);
    await pinWaitingLink(chrome, store, link);
    return link;
}

const children = async id => (await chrome.bookmarks.getChildren(id)).map(b => b.id);

test('the new pinned tab gets a bookmark directly beneath its pinned tab, bound to it', async () => {
    await openLink(4, 2);
    await openLink(5, 2);
    assert.deepEqual(await children('s'), ['a', 'f', 'p', 'new0', 'new1']);
    assert.deepEqual(bindings[4], { pinnedUrl: 'https://link4.test/', bookmarkId: 'new0' });
    assert.deepEqual(store.spaces[0].spaceBookmarks, [2, 3, 4, 5]);
    assert.deepEqual(store.spaces[0].temporaryTabs, [9]);
    // Named after its address until the page has a title.
    assert.equal(created[0].title, 'https://link4.test/');
    assert.equal(store.linkPins.waiting.size, 0);
});

test('a link from a pinned tab inside a folder becomes a pinned tab in that folder, beneath it', async () => {
    await openLink(4, 3);
    assert.deepEqual(await children('f'), ['c', 'q', 'new0']);
    assert.deepEqual(await children('s'), ['a', 'f', 'p']);
});

test('only a new link from a pinned tab waits, and only with the setting on', () => {
    const note = (tab, changes = {}) => {
        Object.assign(store, changes);
        store.linkPins.noteNewTab(store, { id: 4, windowId: 1, url: 'https://x.test/', ...tab });
        const waits = store.linkPins.waiting.has(4);
        store.linkPins.closed(4);
        return waits;
    };
    store.spaces[0].temporaryTabs = [9, 4];
    assert.equal(note({ openerTabId: 2 }), true);
    assert.equal(note({ openerTabId: 9 }), false, 'opened from a tab in the list');
    assert.equal(note({}), false, 'no opener');
    assert.equal(note({ openerTabId: 2, url: 'chrome://newtab/' }), false, 'a New Tab page');
    assert.equal(note({ openerTabId: 2 }, { pinsLinks: false }), false, 'setting off');
    store.pinsLinks = true;
    store.restoredRanks.set(4, 0);
    assert.equal(note({ openerTabId: 2 }), false, 'restored by Chrome');
});

test('a link tab without an address yet waits in the tab list, and is pinned once Chrome names it', async () => {
    for (const url of ['', 'about:blank']) {
        created = [];
        store.linkTails = new LinkTails();
        const link = await openLink(4, 2, { url });
        assert.equal(created.length, 0);
        assert.deepEqual(store.spaces[0].temporaryTabs, [9, 4]);
        assert.equal(store.linkPins.waiting.get(4), 2);
        await pinWaitingLink(chrome, store, { ...link, url: 'https://late.test/' });
        assert.equal(created.at(-1).url, 'https://late.test/');
        assert.equal(created.at(-1).parentId, 's');
        assert.deepEqual(store.spaces[0].temporaryTabs, [9]);
        store.spaces[0].spaceBookmarks = [2, 3];
        liveTabs = liveTabs.filter(t => t.id !== 4);
    }
});

test('a link that cannot be pinned there stays in the tab list, and the next link goes after it', async () => {
    const cases = {
        'opened into another window': () => openLink(4, 2, { windowId: 7 }),
        'a duplicate of the pinned tab': () => openLink(4, 2, { url: 'https://p.test/' }),
        'opener without a bookmark': () => {
            delete bindings[2];
            return openLink(4, 2);
        },
        'opener bookmark outside the space folder': () => {
            bookmarks.find(b => b.id === 'p').parentId = 'elsewhere';
            return openLink(4, 2);
        },
        'bookmark creation fails': () => {
            chrome.bookmarks.create = async () => Promise.reject(new Error('cannot bookmark'));
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
        assert.deepEqual(store.linkTails.entries(), [[2, [4]]], name);
        ({ bookmarks, bindings } = saved);
        globalThis.chrome = fakeChrome();
        store.spaces[0].temporaryTabs = [9];
        store.linkTails = new LinkTails();
        liveTabs = liveTabs.filter(t => t.id !== 4);
    }
});

test('a waiting link that loads blank, or after the setting is turned off, is not pinned', async () => {
    // Chrome reports a window.open tab created with no address and already complete.
    const blank = await openLink(4, 2, { url: '', status: 'complete' });
    assert.equal(store.linkPins.waiting.size, 1);
    await pinWaitingLink(chrome, store, { ...blank, url: 'about:blank', status: 'complete' }, { loaded: true });
    assert.equal(store.linkPins.waiting.size, 0);
    // The user later types an address into it.
    await pinWaitingLink(chrome, store, { ...blank, url: 'https://typed.test/' });
    assert.equal(created.length, 0);

    const late = await openLink(5, 2, { url: '' });
    store.pinsLinks = false;
    await pinWaitingLink(chrome, store, { ...late, url: 'https://late.test/' });
    assert.equal(created.length, 0);
    assert.deepEqual(store.spaces[0].spaceBookmarks, [2, 3]);
});

test('a bookmark whose binding cannot be saved is removed again, and the link stays in the list', async () => {
    chrome.storage.local.set = async () => Promise.reject(new Error('quota'));
    await openLink(4, 2);
    assert.equal(created.length, 1);
    assert.deepEqual(await children('s'), ['a', 'f', 'p']);
    assert.deepEqual(store.spaces[0].temporaryTabs, [9, 4]);
});

test('a waiting link that the user moved, or that closed, is left alone', async () => {
    store.linkPins.waiting.set(4, 2);
    await pinWaitingLink(chrome, store, { id: 4, windowId: 1, url: 'https://gone.test/' });
    assert.equal(created.length, 0);
    assert.equal(store.linkPins.waiting.size, 0);
    store.linkPins.waiting.set(5, 2);
    store.linkPins.closed(5);
    assert.equal(store.linkPins.waiting.size, 0);
});

test('once loaded, the bookmark takes the page title, but keeps a name given in the meantime', async () => {
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

test('a page that sets its title after loading still names its bookmark', async () => {
    const link = await openLink(4, 2);
    await nameLinkPin(chrome, store, { ...link, status: 'complete', title: 'link4.test/' });
    assert.equal(created[0].title, 'https://link4.test/');
    assert.equal(store.linkPins.titles.size, 1);
    await nameLinkPin(chrome, store, { ...link, status: 'complete', title: 'Inbox' });
    assert.equal(created[0].title, 'Inbox');
});

test('an untitled page whose address has no trailing slash still waits for its title', async () => {
    const link = await openLink(4, 2);
    await nameLinkPin(chrome, store, { ...link, status: 'complete', title: 'link4.test' });
    assert.equal(created[0].title, 'https://link4.test/');
    assert.equal(store.linkPins.titles.size, 1);
});

test('once the tab goes on to another page, its bookmark is no longer renamed', async () => {
    const link = await openLink(4, 2);
    await nameLinkPin(chrome, store, { ...link, status: 'complete', title: 'link4.test/' });
    await nameLinkPin(chrome, store, { ...link, status: 'complete', url: 'https://else.test/', title: 'Dashboard' });
    assert.equal(created[0].title, 'https://link4.test/');
    assert.equal(store.linkPins.titles.size, 0);
});

test('a link that redirected keeps the address it landed on, unless the address was changed', async () => {
    const link = await openLink(4, 2, { url: 'https://t.test/r?to=page' });
    await nameLinkPin(chrome, store, { ...link, status: 'complete', url: 'https://page.test/', title: 'Page' });
    assert.equal(created[0].url, 'https://page.test/');
    assert.deepEqual(bindings[4], { pinnedUrl: 'https://page.test/', bookmarkId: 'new0' });

    const edited = await openLink(5, 2, { url: 'https://t.test/r?to=other' });
    created[1].url = 'https://mine.test/';
    await nameLinkPin(chrome, store, { ...edited, status: 'complete', url: 'https://other.test/', title: 'Other' });
    assert.equal(created[1].url, 'https://mine.test/');
});

test('a page that finished loading before its pin was made is named at once', async () => {
    // Chrome reported the tab with no title; by the time it is pinned the page has loaded.
    liveTabs.push({ id: 4, windowId: 1, url: 'https://link4.test/', status: 'complete', title: 'Already here' });
    store.spaces[0].temporaryTabs.push(4);
    store.linkPins.waiting.set(4, 2);
    await pinWaitingLink(chrome, store, { id: 4, windowId: 1, url: 'https://link4.test/', title: '' });
    assert.equal(created[0].title, 'Already here');
    assert.equal(store.linkPins.titles.size, 0);
});

test('waiting links and titles survive a worker restart and follow a replaced tab', () => {
    const pins = new LinkPins();
    pins.waiting.set(4, 2);
    pins.titles.set(5, { bookmarkId: 'b', title: 't' });
    const restarted = new LinkPins(structuredClone(pins.entries()));
    restarted.replaced(40, 4);
    restarted.replaced(20, 2);
    assert.deepEqual(restarted.entries(), { waiting: [[40, 20]], titles: [[5, { bookmarkId: 'b', title: 't' }]] });
});
