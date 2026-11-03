import test from 'node:test';
import assert from 'node:assert/strict';
import { TabRecency, CYCLE_WINDOW_MS, MAX_RECENT_TABS } from '../../../src/background/tab-recency.js';

// Use order as tabs get activated: 1, 2, 3, so 3 is current and 2 is the one before.
function usedInOrder(...ids) {
    const recency = new TabRecency();
    for (const id of ids) recency.record(id);
    return recency;
}

test('the most recently activated tab comes first, once', () => {
    const recency = usedInOrder(1, 2, 3, 2);
    assert.deepEqual(recency.toJSON(), [2, 3, 1]);
});

test('a press goes to the tab used before the current one', () => {
    const recency = usedInOrder(1, 2, 3);
    assert.equal(recency.press({ candidates: [1, 2, 3], activeId: 3, now: 0 }), 2);
});

test('a press never leaves the candidates, so it stays inside the space', () => {
    const recency = usedInOrder(9, 1, 8, 2); // 8 and 9 belong to another space.
    assert.equal(recency.press({ candidates: [1, 2], activeId: 2, now: 0 }), 1);
});

test('presses at a normal pace toggle between the two latest tabs', () => {
    const recency = usedInOrder(1, 2, 3);
    const candidates = [1, 2, 3];
    assert.equal(recency.press({ candidates, activeId: 3, now: 0 }), 2);
    // The tab was activated by the press itself, which must not reorder anything on its own.
    recency.record(2);
    const later = CYCLE_WINDOW_MS + 1;
    assert.equal(recency.press({ candidates, activeId: 2, now: later }), 3);
    recency.record(3);
    assert.equal(recency.press({ candidates, activeId: 3, now: 2 * later }), 2);
});

test('quick repeated presses go further back, then wrap round', () => {
    const recency = usedInOrder(1, 2, 3, 4);
    const candidates = [1, 2, 3, 4];
    const press = (activeId, now) => recency.press({ candidates, activeId, now });
    assert.equal(press(4, 0), 3);
    recency.record(3);
    assert.equal(press(3, 100), 2);
    recency.record(2);
    assert.equal(press(2, 200), 1);
    recency.record(1);
    assert.equal(press(1, 300), 4);
});

test('the tab a cycle stops on becomes the most recent', () => {
    const recency = usedInOrder(1, 2, 3, 4);
    const candidates = [1, 2, 3, 4];
    recency.press({ candidates, activeId: 4, now: 0 });
    recency.record(3);
    recency.press({ candidates, activeId: 3, now: 100 });
    recency.record(2);
    assert.deepEqual(recency.toJSON(), [2, 4, 3, 1], 'saving mid-cycle already counts the tab it is on');
    recency.record(1); // The user clicks another tab: the cycle ends on 2, which was used.
    assert.deepEqual(recency.toJSON(), [1, 2, 4, 3]);
});

test('saving does not interrupt a cycle in progress', () => {
    const recency = usedInOrder(1, 2, 3);
    const candidates = [1, 2, 3];
    recency.press({ candidates, activeId: 3, now: 0 });
    recency.record(2);
    recency.toJSON();
    assert.equal(recency.press({ candidates, activeId: 2, now: 100 }), 1);
});

test('tabs not used since the order began follow the used ones, in tab-strip order', () => {
    const recency = usedInOrder(5, 6);
    const candidates = [4, 5, 6, 7];
    assert.equal(recency.press({ candidates, activeId: 6, now: 0 }), 5);
    recency.record(5);
    assert.equal(recency.press({ candidates, activeId: 5, now: 100 }), 4);
    recency.record(4);
    assert.equal(recency.press({ candidates, activeId: 4, now: 200 }), 7);
});

test('there is nowhere to go from a space with one tab', () => {
    const recency = usedInOrder(1);
    assert.equal(recency.press({ candidates: [1], activeId: 1, now: 0 }), null);
});

test('closed tabs drop out of the order and of a running cycle', () => {
    const recency = usedInOrder(1, 2, 3, 4);
    const candidates = [1, 2, 3, 4];
    assert.equal(recency.press({ candidates, activeId: 4, now: 0 }), 3);
    recency.record(3);
    recency.remove(2);
    assert.equal(recency.press({ candidates, activeId: 3, now: 100 }), 1);
    assert.ok(!recency.toJSON().includes(2));
});

test('a replaced tab keeps its place', () => {
    const recency = usedInOrder(1, 2, 3);
    recency.replace(2, 20);
    assert.deepEqual(recency.toJSON(), [3, 20, 1]);
});

test('the order is capped', () => {
    const recency = new TabRecency();
    for (let id = 0; id < MAX_RECENT_TABS + 50; id++) recency.record(id);
    assert.equal(recency.toJSON().length, MAX_RECENT_TABS);
    assert.equal(recency.toJSON()[0], MAX_RECENT_TABS + 49);
});

test('a saved order restores', () => {
    const restored = new TabRecency(JSON.parse(JSON.stringify(usedInOrder(1, 2, 3))));
    assert.equal(restored.press({ candidates: [1, 2, 3], activeId: 3, now: 0 }), 2);
});

test('late activation events from earlier presses do not end the cycle', () => {
    const recency = usedInOrder(1, 2, 3, 4);
    const candidates = [1, 2, 3, 4];
    assert.equal(recency.press({ candidates, activeId: 4, now: 0 }), 3);
    // The second press is handled before the first press's event arrives.
    assert.equal(recency.press({ candidates, activeId: 3, now: 50 }), 2);
    recency.record(3);
    recency.record(2);
    assert.equal(recency.press({ candidates, activeId: 2, now: 100 }), 1);
});

test('tab changes in other windows leave a cycle alone', () => {
    const recency = usedInOrder(1, 2, 3, 4);
    const candidates = [1, 2, 3, 4];
    assert.equal(recency.press({ candidates, activeId: 4, now: 0, windowId: 1 }), 3);
    recency.record(3, 1);
    recency.record(77, 2); // A page raises a tab in another window.
    assert.equal(recency.press({ candidates, activeId: 3, now: 100, windowId: 1 }), 2);
    assert.ok(!recency.toJSON().includes(77));
});

test('a tab swapped while a cycle is on it still counts as used', () => {
    const recency = usedInOrder(1, 3, 2, 5);
    const candidates = [1, 2, 3, 5];
    recency.press({ candidates, activeId: 5, now: 0 });
    recency.record(2);
    recency.replace(2, 20);
    recency.record(9);
    assert.deepEqual(recency.toJSON(), [9, 20, 5, 3, 1]);
});

test('a press never returns the tab the user is already on', () => {
    const recency = usedInOrder(1, 2, 3);
    const candidates = [1, 2, 3];
    recency.press({ candidates, activeId: 3, now: 0 });
    // The user clicked tab 1 before the next press landed: the cycle restarts from there.
    recency.record(1);
    assert.equal(recency.press({ candidates, activeId: 1, now: 100 }), 2);
});

test('a swapped tab that was already recorded appears once', () => {
    const recency = usedInOrder(1, 2);
    recency.record(20);
    recency.replace(2, 20);
    assert.deepEqual(recency.toJSON(), [20, 1]);
});

test('a press that could not switch leaves the cycle where it was', () => {
    const recency = usedInOrder(1, 2, 3);
    const candidates = [1, 2, 3];
    const target = recency.press({ candidates, activeId: 3, now: 0 });
    recency.abandonPress(target);
    assert.deepEqual(recency.toJSON(), [3, 2, 1]);
    assert.equal(recency.press({ candidates, activeId: 3, now: 100 }), 2);
});
