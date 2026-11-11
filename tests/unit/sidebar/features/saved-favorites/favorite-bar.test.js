import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    favoriteBarItems,
    favoriteIdBefore
} from '../../../../../src/sidebar/features/saved-favorites/favorite-bar.js';

const pin = (id, windowId, index = id) => ({ id, windowId, index, pinned: true });
const favorites = [
    { id: 'mail', url: 'm', spaceId: 'home' },
    { id: 'docs', url: 'd', spaceId: 'work' },
    { id: 'chat', url: 'c', spaceId: 'home' }
];
const records = [
    { tabId: 1, favoriteId: 'mail', windowId: 1 },
    { tabId: 2, favoriteId: 'docs', windowId: 2 },
    { tabId: 3, favoriteId: 'chat', windowId: 1 }
];
const show = items => items.map(({ favorite, tab }) => `${favorite?.id ?? '-'}:${tab?.id ?? 'dimmed'}`);

test('every saved favorite shows in saved order, live with this window’s tab or dimmed', () => {
    const pins = [pin(3, 1, 0), pin(1, 1, 1), pin(2, 2)];
    assert.deepEqual(show(favoriteBarItems({ favorites, records, pins, windowId: 1 })), [
        'mail:1',
        'docs:dimmed',
        'chat:3'
    ]);
    assert.deepEqual(show(favoriteBarItems({ favorites, records, pins, windowId: 2 })), [
        'mail:dimmed',
        'docs:2',
        'chat:dimmed'
    ]);
});

test('a pin the worker has not saved yet still shows, after the saved ones', () => {
    const pins = [pin(1, 1), pin(9, 1, 0), pin(8, 2)];
    assert.deepEqual(show(favoriteBarItems({ favorites, records, pins, windowId: 1 })).slice(3), ['-:9']);
});

test('with separate favorites per space only the space’s favorites and pins show', () => {
    const pins = [pin(1, 1), pin(3, 1), pin(9, 1), pin(10, 1)];
    const items = favoriteBarItems({
        favorites,
        records,
        pins,
        windowId: 1,
        perSpace: true,
        spaceId: 'work',
        spaceTabIds: new Set([10])
    });
    assert.deepEqual(show(items), ['docs:dimmed', '-:10']);
});

test('nothing saved and nothing pinned shows nothing', () => {
    assert.deepEqual(favoriteBarItems({ windowId: 1 }), []);
});

const element = (favoriteId, classes = ['pinned-favicon']) => ({
    dataset: favoriteId ? { favoriteId } : {},
    classList: { contains: name => classes.includes(name) },
    nextElementSibling: null
});
const row = (...elements) => {
    elements.forEach((el, i) => (el.nextElementSibling = elements[i + 1] || null));
    return elements;
};

test('a drop lands before the favorite on its right, skipping what is being dragged', () => {
    const [a, dragged, b] = row(element('a'), element('x', ['pinned-favicon', 'dragging']), element('b'));
    assert.equal(favoriteIdBefore(a, 'left'), 'a');
    assert.equal(favoriteIdBefore(a, 'right'), 'b');
    assert.equal(favoriteIdBefore(b, 'right'), null);
    assert.equal(favoriteIdBefore(dragged, 'right'), 'b');
    assert.equal(favoriteIdBefore(element(null, ['pinned-placeholder-container']), 'left'), null);
    assert.equal(favoriteIdBefore(null, 'left'), null);
});
