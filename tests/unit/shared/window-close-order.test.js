import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderAfterWindowClose } from '../../../src/shared/window-close-order.js';

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
