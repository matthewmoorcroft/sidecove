import test from 'node:test';
import assert from 'node:assert/strict';
import { searchEntries } from '../../tab-search.js';

const entries = [
    { key: 'a', title: 'Quarterly planning doc', url: 'https://docs.example.com/q3', spaceId: 'work', kind: 'tab' },
    { key: 'b', title: 'Plan a trip to Lisbon', url: 'https://travel.example.org/lisbon', spaceId: 'home', kind: 'tab' },
    { key: 'c', title: 'Inbox', url: 'https://mail.example.com/', spaceId: 'work', kind: 'favorite' },
    { key: 'd', title: 'Café menu', url: 'https://cafe.example.net/menu', spaceId: 'home', kind: 'favorite' },
    { key: 'e', title: 'Weekly plan', url: 'https://notes.example.com/plan', spaceId: 'home', kind: 'tab' }
];

test('an empty query returns nothing', () => {
    assert.deepEqual(searchEntries('', entries), []);
    assert.deepEqual(searchEntries('   ', entries), []);
});

test('every word must match the title or the URL', () => {
    assert.deepEqual(searchEntries('lisbon trip', entries).map(e => e.key), ['b']);
    assert.deepEqual(searchEntries('mail.example', entries).map(e => e.key), ['c']);
    assert.deepEqual(searchEntries('lisbon inbox', entries), []);
});

test('title prefixes rank above word starts, then inner and URL-only matches', () => {
    // b starts with "plan"; a and e have it at a word start and keep their order.
    assert.deepEqual(searchEntries('plan', entries).map(e => e.key), ['b', 'a', 'e']);
    const mixed = [
        { key: 'url', title: 'Other', url: 'https://box.example/', spaceId: 'home', kind: 'tab' },
        { key: 'inner', title: 'Toolbox', url: 'https://tools.example/', spaceId: 'home', kind: 'tab' },
        { key: 'start', title: 'Box office', url: 'https://cinema.example/', spaceId: 'home', kind: 'tab' }
    ];
    assert.deepEqual(searchEntries('box', mixed).map(e => e.key), ['start', 'inner', 'url']);
});

test('matching ignores case and accents', () => {
    assert.deepEqual(searchEntries('CAFE', entries).map(e => e.key), ['d']);
    assert.deepEqual(searchEntries('café', entries).map(e => e.key), ['d']);
});

test('ties prefer the current space and then open tabs over favorites', () => {
    const tied = [
        { key: 'fav-home', title: 'Notes', url: 'https://x.example/1', spaceId: 'home', kind: 'favorite' },
        { key: 'tab-work', title: 'Notes', url: 'https://x.example/2', spaceId: 'work', kind: 'tab' },
        { key: 'tab-home', title: 'Notes', url: 'https://x.example/3', spaceId: 'home', kind: 'tab' }
    ];
    assert.deepEqual(searchEntries('notes', tied, { currentSpaceId: 'home' }).map(e => e.key), ['tab-home', 'fav-home', 'tab-work']);
});

test('results are capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: String(i), title: `Page ${i}`, url: `https://p.example/${i}`, spaceId: 'home', kind: 'tab' }));
    assert.equal(searchEntries('page', many).length, 20);
    assert.equal(searchEntries('page', many, { limit: 5 }).length, 5);
});
