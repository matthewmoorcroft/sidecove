import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BATCH_MS,
    CLOSED_LINKS_LIMIT,
    addLinks,
    archiveEntryOf,
    clearSpace,
    isLinkablePage,
    linkForClosedTab,
    linksFrom,
    openPagesOf,
    orderAfterWindowClose,
    splitIdle,
    visibleLinks,
    withoutDeletedSpaces,
    withoutLink,
    withoutPage
} from '../../../src/shared/closed-links.js';

const record = { tabId: 1, spaceId: 's1', section: 'temporaryTabs', order: 3, url: 'https://a.test/' };
const tab = { url: 'https://a.test/', title: 'A', incognito: false };
let counter = 0;
const newId = () => `id${++counter}`;
const closing = (over = {}) =>
    linkForClosedTab({ record, tab, openElsewhere: false, windowId: 9, links: [], now: 1000, newId, ...over });
const link = (over = {}) => ({
    id: 'x',
    url: 'https://a.test/',
    title: 'A',
    spaceId: 's1',
    closedAt: 1000,
    batchAt: 1000,
    windowId: 9,
    order: 0,
    ...over
});

test('only http and https pages are linkable', () => {
    assert.equal(isLinkablePage('https://a.test/'), true);
    assert.equal(isLinkablePage('http://a.test/'), true);
    for (const url of [
        'chrome://newtab/',
        'about:blank',
        'chrome-extension://x/sidebar.html',
        'file:///a',
        '',
        undefined
    ])
        assert.equal(isLinkablePage(url), false, String(url));
});

test('a closed ordinary tab leaves a link with its page, title, space and place', () => {
    assert.deepEqual(closing(), {
        id: 'id' + counter,
        url: 'https://a.test/',
        title: 'A',
        spaceId: 's1',
        closedAt: 1000,
        batchAt: 1000,
        windowId: 9,
        order: 3
    });
});

test('a tab with no title is named after its address', () => {
    assert.equal(closing({ tab: { ...tab, title: '' } }).title, 'https://a.test/');
});

test('no link for pins, favourites, incognito, unknown tabs, or pages that are not links', () => {
    assert.equal(closing({ record: { ...record, section: 'pinnedTabs' } }), null);
    assert.equal(closing({ record: { ...record, section: 'spaceBookmarks' } }), null);
    assert.equal(closing({ record: null }), null);
    assert.equal(closing({ tab: null }), null);
    assert.equal(closing({ tab: { ...tab, incognito: true } }), null);
    assert.equal(closing({ tab: { ...tab, url: 'chrome://newtab/' } }), null);
    assert.equal(closing({ tab: { ...tab, url: '' } }), null);
});

test('a page still open in a window that stays is not closed, so it leaves no link', () => {
    assert.equal(closing({ openElsewhere: true }), null);
});

test('tabs of one window closing together share a batch time', () => {
    const first = link({ closedAt: 1000, batchAt: 1000 });
    const second = closing({ links: [first], now: 1000 + BATCH_MS });
    assert.equal(second.batchAt, 1000);
    const later = closing({ links: [first], now: 1001 + BATCH_MS });
    assert.equal(later.batchAt, 1001 + BATCH_MS);
    const otherWindow = closing({ links: [first], now: 1500, windowId: 10 });
    assert.equal(otherWindow.batchAt, 1500);
});

test('adding a link for a page that already has one replaces the older one', () => {
    const { links, overflow } = addLinks([link({ id: 'old', closedAt: 1, batchAt: 1 })], [link({ id: 'new' })]);
    assert.deepEqual(
        links.map(l => l.id),
        ['new']
    );
    assert.deepEqual(overflow, []);
});

test('Undo keeps a newer link for the same page instead of replacing it', () => {
    const { links } = addLinks([link({ id: 'newer' })], [link({ id: 'restored', closedAt: 1, batchAt: 1 })], {
        keepExisting: true
    });
    assert.deepEqual(
        links.map(l => l.id),
        ['newer']
    );
});

test('past the cap the oldest links come back as overflow, for Archived', () => {
    const many = Array.from({ length: CLOSED_LINKS_LIMIT }, (_, i) =>
        link({ id: `m${i}`, url: `https://a.test/${i}`, batchAt: 1000 + i, closedAt: 1000 + i })
    );
    const fresh = link({ id: 'fresh', url: 'https://a.test/fresh', batchAt: 5000, closedAt: 5000 });
    const { links, overflow } = addLinks(many, [fresh]);
    assert.equal(links.length, CLOSED_LINKS_LIMIT);
    assert.deepEqual(
        overflow.map(l => l.id),
        ['m0']
    );
    assert.equal(links.at(-1).id, 'fresh');
});

test('a window with more tabs than the cap keeps the last ones and archives the first', () => {
    const incoming = Array.from({ length: CLOSED_LINKS_LIMIT + 1 }, (_, i) =>
        link({ id: `n${i}`, url: `https://a.test/${i}`, order: i })
    );
    const { links, overflow } = addLinks([], incoming);
    assert.equal(links.length, CLOSED_LINKS_LIMIT);
    assert.deepEqual(
        overflow.map(l => l.id),
        ['n0']
    );
});

test('a space shows its own links, newest window first, in reverse order when the list is inverted', () => {
    const links = [
        link({ id: 'a', url: 'https://a.test/a', batchAt: 1, order: 0 }),
        link({ id: 'b', url: 'https://a.test/b', batchAt: 1, order: 1 }),
        link({ id: 'c', url: 'https://a.test/c', batchAt: 2, order: 0 }),
        link({ id: 'z', url: 'https://a.test/z', spaceId: 's2' })
    ];
    const ids = rows => rows.map(l => l.id);
    assert.deepEqual(ids(visibleLinks(links, 's1', new Set(), { invertTabOrder: false })), ['a', 'b', 'c']);
    assert.deepEqual(ids(visibleLinks(links, 's1', new Set())), ['c', 'b', 'a']);
});

test('a link whose page is open in any window is hidden', () => {
    const links = [link({ id: 'a' }), link({ id: 'b', url: 'https://a.test/b' })];
    const open = openPagesOf([{ url: 'https://a.test/' }, { url: 'https://other.test/', incognito: true }]);
    assert.deepEqual(
        visibleLinks(links, 's1', open).map(l => l.id),
        ['b']
    );
    // A private window's page does not count: its links are not kept for private tabs anyway.
    assert.equal(open.has('https://other.test/'), false);
});

test('Clear takes the space visible links and leaves hidden ones and other spaces alone', () => {
    const links = [
        link({ id: 'a' }),
        link({ id: 'hidden', url: 'https://a.test/open' }),
        link({ id: 'other', url: 'https://a.test/o', spaceId: 's2' })
    ];
    const result = clearSpace(links, 's1', new Set(['https://a.test/open']));
    assert.deepEqual(
        result.cleared.map(l => l.id),
        ['a']
    );
    assert.deepEqual(
        result.links.map(l => l.id),
        ['hidden', 'other']
    );
});

test('auto-archive moves only links older than the idle time', () => {
    const links = [link({ id: 'old', closedAt: 100 }), link({ id: 'new', url: 'https://a.test/n', closedAt: 900 })];
    const result = splitIdle(links, 1000, 500);
    assert.deepEqual(
        result.idle.map(l => l.id),
        ['old']
    );
    assert.deepEqual(
        result.links.map(l => l.id),
        ['new']
    );
});

test('a deleted space takes its links; an empty list of spaces is a store that has not loaded', () => {
    const links = [link({ id: 'a' }), link({ id: 'b', spaceId: 'gone' })];
    assert.deepEqual(
        withoutDeletedSpaces(links, [{ id: 's1' }]).map(l => l.id),
        ['a']
    );
    assert.equal(withoutDeletedSpaces(links, []), links);
});

test('small helpers: stored list, one link removed, one page used up, archive entry', () => {
    assert.deepEqual(linksFrom({}), []);
    assert.deepEqual(linksFrom({ closedLinks: 'bad' }), []);
    assert.deepEqual(linksFrom({ closedLinks: [link()] }), [link()]);
    assert.deepEqual(withoutLink([link({ id: 'a' }), link({ id: 'b' })], 'a'), [link({ id: 'b' })]);
    assert.deepEqual(withoutPage([link(), link({ id: 'b', url: 'https://a.test/b' })], 'https://a.test/'), [
        link({ id: 'b', url: 'https://a.test/b' })
    ]);
    assert.deepEqual(archiveEntryOf(link({ title: '' })), {
        url: 'https://a.test/',
        name: 'https://a.test/',
        spaceId: 's1'
    });
    assert.deepEqual(archiveEntryOf(link()), { url: 'https://a.test/', name: 'A', spaceId: 's1' });
});

// Window 2 closes. Its tab 20 shows the page "p"; tab 50 in window 1 shows it too.
const page = 'https://a.test/p';
const open = [
    { id: 10, windowId: 1, url: 'https://a.test/mine' },
    { id: 50, windowId: 1, url: page },
    { id: 60, windowId: 1, url: 'https://a.test/after' }
];

test('a page still open in a surviving window takes the place of the closed window tab', () => {
    const next = orderAfterWindowClose({
        order: [10, 20, 30, 40, 50, 60],
        removedId: 20,
        page,
        windowId: 2,
        tabs: open
    });
    assert.deepEqual(next, [10, 50, 30, 40, 60]);
});

test('the page keeps its place when the closed tab is already out of the saved list', () => {
    const next = orderAfterWindowClose({
        order: [10, 30, 40, 50, 60],
        removedId: 20,
        slot: 1,
        page,
        windowId: 2,
        tabs: open
    });
    assert.deepEqual(next, [10, 50, 30, 40, 60]);
});

test('nothing moves when the surviving tab already comes first, or no other window shows the page', () => {
    assert.equal(orderAfterWindowClose({ order: [50, 20, 60], removedId: 20, page, windowId: 2, tabs: open }), null);
    assert.equal(
        orderAfterWindowClose({
            order: [10, 20, 60],
            removedId: 20,
            page: 'https://a.test/q',
            windowId: 2,
            tabs: open
        }),
        null
    );
    assert.equal(orderAfterWindowClose({ order: [10, 60], removedId: 20, page, windowId: 2, tabs: open }), null);
});

test('a pinned tab, a private tab or a tab in the closing window is not the heir', () => {
    const tabs = [
        { id: 50, windowId: 1, url: page, pinned: true },
        { id: 51, windowId: 1, url: page, incognito: true },
        { id: 52, windowId: 2, url: page }
    ];
    assert.equal(orderAfterWindowClose({ order: [20, 50, 51, 52], removedId: 20, page, windowId: 2, tabs }), null);
});
