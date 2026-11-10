import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLinkTab, LinkTails } from '../../../src/shared/link-tab-placement.js';

// Stored lists are in Chrome order. The side panel draws them reversed when inverted.
const onScreen = (ids, inverted) => (inverted ? [...ids].reverse() : ids);

// Opens each of `children` from `opener` in turn, the way successive link clicks would while
// the user stays on the opener: each one is placed after the last link from that opener.
function openLinks(stored, opener, children, inverted, tails = new Map()) {
    for (const id of children) {
        stored = placeLinkTab(stored, opener, id, tails.get(opener), inverted);
        tails.set(opener, id);
    }
    return stored;
}

test('a link opened from a tab in the list lands directly below it on screen, setting on', () => {
    const stored = placeLinkTab([1, 2, 3, 4], 3, 9, undefined, true);
    assert.deepEqual(onScreen(stored, true), [4, 3, 9, 2, 1]);
});

test('a link opened from a tab in the list lands directly below it on screen, setting off', () => {
    const stored = placeLinkTab([1, 2, 3, 4], 2, 9, undefined, false);
    assert.deepEqual(onScreen(stored, false), [1, 2, 9, 3, 4]);
});

test('three links in a row from one tab stack beneath it in opening order, setting on', () => {
    const stored = openLinks([1, 2, 3], 2, [10, 11, 12], true);
    assert.deepEqual(onScreen(stored, true), [3, 2, 10, 11, 12, 1]);
});

test('three links in a row from one tab stack beneath it in opening order, setting off', () => {
    const stored = openLinks([1, 2, 3], 2, [10, 11, 12], false);
    assert.deepEqual(onScreen(stored, false), [1, 2, 10, 11, 12, 3]);
});

test('after the tab is switched back to, the next link goes directly beneath it', () => {
    for (const inverted of [true, false]) {
        const tails = new Map();
        let stored = openLinks([1, 2, 3], 2, [10, 11], inverted, tails);
        // Switching away and back forgets the links opened so far.
        tails.delete(2);
        stored = openLinks(stored, 2, [12], inverted, tails);
        assert.deepEqual(onScreen(stored, inverted), inverted ? [3, 2, 12, 10, 11, 1] : [1, 2, 12, 10, 11, 3]);
    }
});

test('links from two tabs stay with their own tab, whichever is returned to', () => {
    // Links 10, 11 from tab 2; then links 20, 21 from tab 3; back on tab 2 a new link goes under 2.
    const tails = new Map();
    let stored = openLinks([1, 2, 3], 2, [10, 11], false, tails);
    stored = openLinks(stored, 3, [20, 21], false, tails);
    tails.delete(2);
    stored = openLinks(stored, 2, [12], false, tails);
    assert.deepEqual(stored, [1, 2, 12, 10, 11, 3, 20, 21]);
});

test('a link opened from a link goes directly below that link', () => {
    const tails = new Map();
    let stored = openLinks([1, 2, 3], 2, [10], false, tails);
    stored = openLinks(stored, 10, [11], false, tails);
    // The store moves the group's last link to 11, so the next link from tab 2 follows it.
    tails.set(2, 11);
    stored = openLinks(stored, 2, [12], false, tails);
    assert.deepEqual(stored, [1, 2, 10, 11, 12, 3]);
});

test('a last link that left the list is replaced by the opener as the place to start', () => {
    const stored = placeLinkTab([1, 2, 3], 2, 11, 10, false);
    assert.deepEqual(stored, [1, 2, 11, 3]);
});

test('an opener outside the list puts links at the top of the list in opening order, setting on', () => {
    const stored = openLinks([1, 2, 3], 99, [10, 11], true);
    assert.deepEqual(onScreen(stored, true), [10, 11, 3, 2, 1]);
});

test('an opener outside the list puts links at the top of the list in opening order, setting off', () => {
    const stored = openLinks([1, 2, 3], 99, [10, 11], false);
    assert.deepEqual(onScreen(stored, false), [10, 11, 1, 2, 3]);
});

test('the list given is not changed', () => {
    const ids = [1, 2, 3];
    placeLinkTab(ids, 2, 9, undefined, true);
    assert.deepEqual(ids, [1, 2, 3]);
});

// The stored list is in Chrome order; these use setting off, so it is also the screen order.
test('LinkTails: links from one tab stack beneath it, and a link from a link joins the group', () => {
    const tails = new LinkTails();
    let stored = tails.place([1, 2, 3], 2, 10, false);
    stored = tails.place(stored, 10, 11, false);
    stored = tails.place(stored, 2, 12, false);
    assert.deepEqual(stored, [1, 2, 10, 11, 12, 3]);
});

test('LinkTails: switching to the tab starts its links again directly beneath it', () => {
    const tails = new LinkTails();
    let stored = tails.place([1, 2, 3], 2, 10, false);
    tails.switchedTo(2);
    stored = tails.place(stored, 2, 11, false);
    assert.deepEqual(stored, [1, 2, 11, 10, 3]);
});

test('LinkTails: a last link dragged away from the tab no longer decides where the next goes', () => {
    for (const inverted of [true, false]) {
        const tails = new LinkTails();
        tails.place([1, 2, 3], 2, 10, inverted);
        // Link 10 was dragged to the end of the screen.
        const dragged = onScreen(inverted ? [3, 2, 1, 10] : [1, 2, 3, 10], inverted);
        const stored = tails.place(dragged, 2, 11, inverted);
        assert.deepEqual(onScreen(stored, inverted), inverted ? [3, 2, 11, 1, 10] : [1, 2, 11, 3, 10]);
    }
});

test('LinkTails: a last link dragged away and then closed leaves the next one under the tab', () => {
    const tails = new LinkTails();
    tails.place([1, 2, 3], 2, 10, false);
    // Link 10 is dragged to the end, then closed.
    tails.closed(10);
    assert.deepEqual(tails.place([1, 2, 3], 2, 11, false), [1, 2, 11, 3]);
});

test('LinkTails: closing the last of several links puts the next one after those still beneath the tab', () => {
    const tails = new LinkTails();
    let stored = tails.place([1, 2, 3], 2, 10, false);
    stored = tails.place(stored, 2, 11, false);
    tails.closed(11);
    stored = tails.place(
        stored.filter(id => id !== 11),
        2,
        12,
        false
    );
    assert.deepEqual(stored, [1, 2, 10, 12, 3]);
});

test('LinkTails: a link kept beneath the tab still counts after the one before it is dragged away', () => {
    const tails = new LinkTails();
    const stored = tails.place([1, 2, 3], 2, 10, false);
    tails.place(stored, 2, 11, false);
    // Link 10 is dragged to the end; 11 is now directly beneath the tab.
    assert.deepEqual(tails.place([1, 2, 11, 3, 10], 2, 12, false), [1, 2, 11, 12, 3, 10]);
});

test('LinkTails: links from an opener outside the list go to the top in opening order', () => {
    const tails = new LinkTails();
    let stored = tails.place([1, 2, 3], 99, 10, false);
    stored = tails.place(stored, 99, 11, false);
    assert.deepEqual(stored, [10, 11, 1, 2, 3]);
});

test('LinkTails: entries survive being saved and loaded, and the older one-tail form is read', () => {
    const tails = new LinkTails();
    let stored = tails.place([1, 2, 3], 2, 10, false);
    stored = tails.place(stored, 2, 11, false);
    const reloaded = new LinkTails(tails.entries());
    assert.deepEqual(reloaded.place(stored, 2, 12, false), [1, 2, 10, 11, 12, 3]);
    const older = new LinkTails([[2, 10]]);
    assert.deepEqual(older.place([1, 2, 10, 3], 2, 12, false), [1, 2, 10, 12, 3]);
});
