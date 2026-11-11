import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    bindPin,
    followSpaces,
    pinIndexFor,
    placeFavorite,
    reconcilePins,
    removeFavorite,
    reorderFavorites,
    replaceTab,
    startSession,
    stateFrom,
    tabsOfFavorite,
    unbindTab
} from '../../../src/shared/saved-favorites.js';

const pin = (id, windowId, url, extra = {}) => ({ id, windowId, index: id, pinned: true, url, title: url, ...extra });
const ids = () => {
    let n = 0;
    return () => `f${++n}`;
};
const empty = stateFrom({});
const urls = state => state.favorites.map(f => f.url);

test('today’s favorites become the saved list once each: the same page in two windows is one favorite', () => {
    const pins = [pin(4, 2, 'b'), pin(1, 1, 'a'), pin(2, 1, 'shared'), pin(3, 2, 'shared')];
    const state = reconcilePins(empty, pins, { spaceOf: id => (id === 1 ? 'work' : 'home'), newId: ids() });
    assert.deepEqual(urls(state), ['a', 'shared', 'b']);
    assert.deepEqual(
        state.favorites.map(f => f.spaceId),
        ['work', 'home', 'home']
    );
    assert.deepEqual(tabsOfFavorite(state, state.favorites[1].id).sort(), [2, 3]);
    // Running the migration again changes nothing.
    assert.deepEqual(reconcilePins(state, pins, { newId: ids() }), state);
});

test('two pins of one page in the same window stay two favorites, so nothing is lost', () => {
    const state = reconcilePins(empty, [pin(1, 1, 'a'), pin(2, 1, 'a')], { newId: ids() });
    assert.deepEqual(urls(state), ['a', 'a']);
});

test('a pin that browsed away keeps its favorite; the favorite keeps the page it saved', () => {
    let state = bindPin(empty, pin(1, 1, 'mail', { title: 'Mail' }), { newId: ids() });
    state = bindPin(state, pin(1, 1, 'mail/inbox/42', { title: 'Inbox' }), { newId: ids() });
    assert.deepEqual(urls(state), ['mail']);
    assert.equal(state.favorites[0].title, 'Mail');
    assert.equal(state.tabs[0].url, 'mail/inbox/42');
    state = bindPin(state, pin(1, 1, 'mail', { title: 'Mail and more' }), { newId: ids() });
    assert.equal(state.favorites[0].title, 'Mail and more');
});

test('a favorite saved before its page had a name takes the first name its tab shows', () => {
    let state = bindPin(empty, pin(1, 1, 'http://a/', { title: '' }), { newId: ids() });
    assert.equal(state.favorites[0].title, 'http://a/');
    state = bindPin(state, pin(1, 1, 'https://www.a/', { title: 'A' }), { newId: ids() });
    assert.equal(state.favorites[0].title, 'A');
});

test('closing a favorite’s tab leaves the favorite; a pin of its page elsewhere joins it', () => {
    let state = bindPin(empty, pin(1, 1, 'a'), { newId: ids() });
    state = unbindTab(state, 1);
    assert.deepEqual(urls(state), ['a']);
    assert.deepEqual(state.tabs, []);
    state = bindPin(state, pin(7, 2, 'a'), { newId: ids() });
    assert.deepEqual(urls(state), ['a']);
    assert.deepEqual(tabsOfFavorite(state, state.favorites[0].id), [7]);
});

test('after a restart, or a window reopened, a pin is recognised by the page it last showed', () => {
    let state = bindPin(empty, pin(1, 1, 'mail'), { newId: ids() });
    state = bindPin(state, pin(1, 1, 'mail/inbox'), { newId: ids() });
    const restarted = startSession(state);
    assert.deepEqual(restarted.tabs, []);
    const back = bindPin(restarted, pin(50, 9, 'mail/inbox'), { newId: ids() });
    assert.deepEqual(urls(back), ['mail']);
    assert.deepEqual(back.restore, []);

    // A closed tab, or its window, reopened with Cmd+Shift+T.
    const reopened = bindPin(unbindTab(state, 1), pin(60, 3, 'mail/inbox'), { newId: ids() });
    assert.deepEqual(urls(reopened), ['mail']);
});

test('with separate favorites per space, the same page in two spaces stays two favorites', () => {
    const pins = [pin(1, 1, 'a'), pin(2, 2, 'a')];
    const spaces = { 1: 'work', 2: 'home' };
    const apart = reconcilePins(empty, pins, { spaceOf: id => spaces[id], perSpace: true, newId: ids() });
    assert.deepEqual(
        apart.favorites.map(f => f.spaceId),
        ['work', 'home']
    );
    const shared = reconcilePins(empty, pins, { spaceOf: id => spaces[id], newId: ids() });
    assert.equal(shared.favorites.length, 1);
});

test('without adding, a pin only joins a favorite already saved', () => {
    const state = unbindTab(bindPin(empty, pin(1, 1, 'a'), { newId: ids() }), 1);
    assert.deepEqual(bindPin(state, pin(2, 1, 'b'), { add: false, newId: ids() }), state);
    assert.deepEqual(tabsOfFavorite(bindPin(state, pin(3, 1, 'a'), { add: false, newId: ids() }), 'f1'), [3]);
});

test('a favorite’s tab moved into a window that already has one is a pin of its own there', () => {
    const newId = ids();
    let state = reconcilePins(empty, [pin(1, 1, 'a'), pin(2, 2, 'a')], { newId });
    state = bindPin(state, pin(2, 1, 'a'), { newId });
    assert.deepEqual(urls(state), ['a', 'a']);
    assert.deepEqual(
        state.tabs.map(r => [r.tabId, r.favoriteId]),
        [
            [1, 'f1'],
            [2, 'f2']
        ]
    );
});

test('removing a favorite drops its tabs and anything waiting to restore it', () => {
    let state = reconcilePins(empty, [pin(1, 1, 'a'), pin(2, 2, 'a'), pin(3, 1, 'b')], { newId: ids() });
    state = unbindTab(state, 2);
    state = removeFavorite(state, state.favorites[0].id);
    assert.deepEqual(urls(state), ['b']);
    assert.deepEqual(
        state.tabs.map(r => r.tabId),
        [3]
    );
    assert.deepEqual(state.restore, []);
});

test('a replaced tab keeps its favorite', () => {
    const state = replaceTab(bindPin(empty, pin(1, 1, 'a'), { newId: ids() }), 9, 1);
    assert.equal(state.tabs[0].tabId, 9);
});

test('reordering a window’s shown favorites leaves the others where they are', () => {
    const state = reconcilePins(empty, [pin(1, 1, 'a'), pin(2, 1, 'b'), pin(3, 1, 'c'), pin(4, 1, 'd')], {
        newId: ids()
    });
    // Only f1 and f3 show in this space; swapping them keeps f2 and f4 in place.
    assert.deepEqual(urls(reorderFavorites(state, ['f3', 'f1'])), ['c', 'b', 'a', 'd']);
    assert.deepEqual(urls(reorderFavorites(state, ['f4', 'f3', 'f2', 'f1', 'gone'])), ['d', 'c', 'b', 'a']);
});

test('a favorite dropped into the bar goes before the one it was dropped on, or last', () => {
    const state = reconcilePins(empty, [pin(1, 1, 'a'), pin(2, 1, 'b'), pin(3, 1, 'c')], { newId: ids() });
    assert.deepEqual(urls(placeFavorite(state, 'f3', 'f1')), ['c', 'a', 'b']);
    assert.deepEqual(urls(placeFavorite(state, 'f1', null)), ['b', 'c', 'a']);
    assert.equal(placeFavorite(state, 'nope', 'f1'), state);
});

test('a favorite opened in a window goes after the pins of the favorites saved before it', () => {
    const state = reconcilePins(empty, [pin(1, 1, 'a'), pin(2, 1, 'b'), pin(3, 1, 'c')], { newId: ids() });
    const windowTwo = unbindTab(unbindTab(state, 1), 3);
    assert.equal(pinIndexFor(windowTwo, 'f1', [pin(2, 1, 'b')]), 0);
    assert.equal(pinIndexFor(windowTwo, 'f3', [pin(2, 1, 'b')]), 1);
});

test('a favorite follows its tab into another space, and its other tabs follow too', () => {
    const state = reconcilePins(empty, [pin(1, 1, 'a'), pin(2, 2, 'a')], { spaceOf: () => 'home', newId: ids() });
    const spaces = [{ id: 'home' }, { id: 'work' }];
    const owners = { 1: 'home', 2: 'work' };
    const { state: next, moves } = followSpaces(state, spaces, id => owners[id]);
    assert.equal(next.favorites[0].spaceId, 'work');
    assert.deepEqual(moves, [{ tabId: 1, spaceId: 'work' }]);
    // In agreement, nothing changes.
    const settled = followSpaces(next, spaces, () => 'work');
    assert.deepEqual(settled.moves, []);
    assert.equal(settled.state.favorites[0], next.favorites[0]);
});

test('a favorite with no tab whose space was deleted moves to the first space', () => {
    const state = unbindTab(bindPin(empty, pin(1, 1, 'a'), { spaceId: 'gone', newId: ids() }), 1);
    const { state: next } = followSpaces(state, [{ id: 'home' }], () => null);
    assert.equal(next.favorites[0].spaceId, 'home');
});
