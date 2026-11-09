import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloseFocus, pickTabAfterClose } from '../../../../../src/sidebar/features/close-tab/close-focus.js';

const always = () => true;

test('the next tab down the list is chosen, skipping tabs that are not open', () => {
    assert.equal(pickTabAfterClose([1, 2, 3, 4], 2, always), 3);
    assert.equal(
        pickTabAfterClose([1, 2, 3, 4], 2, id => id !== 3),
        4
    );
});

test('the tab above is chosen when the closed tab was last', () => {
    assert.equal(pickTabAfterClose([1, 2, 3], 3, always), 2);
    assert.equal(
        pickTabAfterClose([1, 2, 3], 3, id => id !== 2),
        1
    );
});

test('nothing is chosen when no other tab is open, or the closed tab is not in the list', () => {
    assert.equal(
        pickTabAfterClose([5], 5, id => id !== 5),
        undefined
    );
    assert.equal(pickTabAfterClose([1, 2], 9, always), undefined);
});

// Space A is shown and holds tabs 1, 2, 3 (top to bottom); space B holds 10. Tab 2 is active.
function setUp({ open = [1, 2, 3, 10], activeTab = 2, owners = { 1: 'A', 2: 'A', 3: 'A', 10: 'B' }, listed } = {}) {
    const calls = [];
    let active = activeTab;
    const focus = createCloseFocus({
        getActiveSpaceId: () => 'A',
        getActiveTabId: () => active,
        setActiveTabId: id => {
            active = id;
        },
        ownerOf: id => owners[id],
        displayedOrder: spaceId =>
            listed ??
            Object.keys(owners)
                .map(Number)
                .filter(id => owners[id] === spaceId),
        tabExists: async id => open.includes(id),
        openTabIds: async () => open,
        activateTab: async id => calls.push(['activate', id]),
        openNewTab: async () => calls.push(['new tab']),
        restoreAfterPick: async (spaceId, pickedId, visitedId) => calls.push(['restore', spaceId, pickedId, visitedId])
    });
    return { focus, calls, owners, active: () => active };
}

test('a close that made Chrome pick a tab of another space keeps the current space', async () => {
    const { focus, calls, active } = setUp({ open: [1, 3, 10] });
    // The activation event arrives before the close is handled.
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), true);
    assert.deepEqual(calls, [
        ['activate', 3],
        ['restore', 'B', 10, undefined]
    ]);
    assert.equal(active(), 3);
});

test('the tab the user last visited in the other space is passed on to be restored', async () => {
    const open = [1, 2, 3, 10, 11];
    const { focus, calls } = setUp({ open, owners: { 1: 'A', 2: 'A', 3: 'A', 10: 'B', 11: 'B' } });
    // Tab 10 of space B is visited on purpose, then the user returns to tab 2 of space A.
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), false);
    assert.equal(await focus.stayAfterClose({ activatedTabId: 2, activatedSpaceId: 'A' }), false);
    // Closing tab 2 makes Chrome pick tab 11 of space B, which the user never visited.
    open.splice(open.indexOf(2), 1);
    assert.equal(await focus.stayAfterClose({ activatedTabId: 11, activatedSpaceId: 'B' }), true);
    assert.deepEqual(calls, [
        ['activate', 3],
        ['restore', 'B', 11, 10]
    ]);
});

test('the close handled first gives the same result, with the order the list had before the close', async () => {
    const { focus, calls, owners } = setUp({ open: [1, 2, 10], activeTab: 3 });
    focus.noteRemoval(3);
    delete owners[3]; // the sidebar drops the closed tab from its list
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), true);
    assert.deepEqual(calls[0], ['activate', 2]);
});

test('Chrome picking another tab of the same space is replaced by the next tab down the list', async () => {
    const { focus, calls } = setUp({ open: [1, 3, 10] });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 1, activatedSpaceId: 'A' }), true);
    assert.deepEqual(calls, [['activate', 3]]);
});

test('Chrome already picking the tab we would choose changes nothing', async () => {
    const { focus, calls, active } = setUp({ open: [1, 3, 10] });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 3, activatedSpaceId: 'A' }), false);
    assert.deepEqual(calls, []);
    assert.equal(active(), 3);
});

test('closing the only tab of the space opens a New Tab there', async () => {
    const { focus, calls } = setUp({ open: [10], activeTab: 1, owners: { 1: 'A', 10: 'B' } });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), true);
    assert.deepEqual(calls, [['new tab'], ['restore', 'B', 10, undefined]]);
});

test('a tab of another space opened on purpose still switches to that space', async () => {
    // The tab that was active is still open.
    const { focus, calls, active } = setUp({ open: [1, 2, 3, 10] });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), false);
    assert.deepEqual(calls, []);
    assert.equal(active(), 10);
});

test('a tab moved to another window is not a close', async () => {
    const calls = [];
    const moved = createCloseFocus({
        getActiveSpaceId: () => 'A',
        getActiveTabId: () => 2,
        setActiveTabId: () => {},
        ownerOf: id => ({ 1: 'A', 2: 'A', 3: 'A', 10: 'B' })[id],
        displayedOrder: () => [1, 2, 3],
        tabExists: async () => true, // still open, in the other window
        openTabIds: async () => [1, 3, 10],
        activateTab: async () => calls.push(['activate']),
        openNewTab: async () => calls.push(['new tab']),
        restoreAfterPick: async () => calls.push(['restore'])
    });
    assert.equal(await moved.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), false);
    assert.deepEqual(calls, []);
});

test('a close in a space that is not shown, or with no tab active before, is left alone', async () => {
    const { focus, calls } = setUp({ open: [1, 2, 3], activeTab: 10 });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 1, activatedSpaceId: 'A' }), false);
    const none = setUp({ activeTab: null });
    assert.equal(await none.focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), false);
    assert.deepEqual(calls, []);
});

test("if the chosen tab cannot be shown, the usual switch to Chrome's pick goes ahead", async () => {
    const failing = createCloseFocus({
        getActiveSpaceId: () => 'A',
        getActiveTabId: () => 2,
        setActiveTabId: () => {},
        ownerOf: id => ({ 2: 'A', 3: 'A', 10: 'B' })[id],
        displayedOrder: () => [2, 3],
        tabExists: async () => false,
        openTabIds: async () => [3, 10],
        activateTab: async () => {
            throw new Error('No tab with id');
        },
        openNewTab: async () => {},
        restoreAfterPick: async () => assert.fail('nothing was undone, so nothing is restored')
    });
    assert.equal(await failing.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), false);
});

test('tabs closed together are handled one after another and each lands on an open tab', async () => {
    const open = [1, 3, 10];
    const { focus, calls } = setUp({ open });
    focus.noteRemoval(2);
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), true);
    // Tab 3 was shown, and now closes as well.
    open.splice(open.indexOf(3), 1);
    focus.noteRemoval(3);
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B' }), true);
    assert.deepEqual(
        calls.filter(([what]) => what === 'activate'),
        [
            ['activate', 3],
            ['activate', 1]
        ]
    );
});

// "Switch to this tab" from a New Tab: Chrome shows the chosen tab, then closes the New Tab.
test('an empty New Tab that closes leaves the tab Chrome picked alone', async () => {
    const { focus, calls, active } = setUp({ open: [1, 3, 10], activeTab: 2 });
    focus.trackTab({ id: 2, url: '', pendingUrl: 'chrome://newtab/' });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 1, activatedSpaceId: 'A' }), false);
    assert.deepEqual(calls, []);
    assert.equal(active(), 1);
});

test('a tab that was a New Tab and has been navigated away still keeps the space on close', async () => {
    const { focus, calls } = setUp({ open: [1, 3, 10], activeTab: 2 });
    focus.trackTab({ id: 2, url: 'chrome://newtab/' });
    focus.trackTab({ id: 2, url: 'http://example.com/' });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 1, activatedSpaceId: 'A' }), true);
    assert.deepEqual(calls, [['activate', 3]]);
});

test('a New Tab with a page loading in it is an ordinary tab', async () => {
    const { focus } = setUp({ open: [1, 3, 10], activeTab: 2 });
    focus.trackTab({ id: 2, url: '', pendingUrl: 'http://example.com/' });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 1, activatedSpaceId: 'A' }), true);
});

// Cmd+W on an empty New Tab: Chrome shows a tab to the right, which the removal was noted before.
test('an empty New Tab that closes with other tabs left keeps the space, like any other tab', async () => {
    const { focus, calls } = setUp({ open: [1, 3, 10], activeTab: 2 });
    focus.trackTab({ id: 2, url: '', pendingUrl: 'chrome://newtab/' });
    focus.noteRemoval(2);
    const removalMark = focus.mark();
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B', removalMark }), true);
    assert.deepEqual(calls, [
        ['activate', 3],
        ['restore', 'B', 10, undefined]
    ]);
});

test('an empty New Tab that closes after the tab Chrome showed was activated is left to Chrome', async () => {
    const { focus, calls, active } = setUp({ open: [1, 3, 10], activeTab: 2 });
    focus.trackTab({ id: 2, url: '', pendingUrl: 'chrome://newtab/' });
    // "Switch to this tab": the activation arrives, and the New Tab is removed after it.
    const removalMark = focus.mark();
    focus.noteRemoval(2);
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B', removalMark }), false);
    assert.deepEqual(calls, []);
    assert.equal(active(), 10);
});

test('the only tab of a space, an empty New Tab, closes: Chrome’s pick stands', async () => {
    const { focus, calls } = setUp({ open: [10], activeTab: 1, owners: { 1: 'A', 10: 'B' } });
    focus.trackTab({ id: 1, url: '', pendingUrl: 'chrome://newtab/' });
    focus.noteRemoval(1);
    const removalMark = focus.mark();
    assert.equal(await focus.stayAfterClose({ activatedTabId: 10, activatedSpaceId: 'B', removalMark }), false);
    assert.deepEqual(calls, []);
});

// A favorite (5) is on the tab bar, not in the list; tabs 11 and 12 are hidden by Clear.
test('Chrome landing on a hidden tab after a close shows the first tab of the list instead', async () => {
    const { focus, calls, active } = setUp({
        open: [1, 3, 11, 12],
        activeTab: 5,
        owners: { 1: 'A', 3: 'A', 5: 'A' },
        listed: [1, 3]
    });
    focus.noteRemoval(5);
    const stayed = await focus.stayAfterClose({ activatedTabId: 11, activatedHidden: true });
    assert.equal(stayed, true);
    // Nothing was picked for a space, so no space's last tab is put back.
    assert.deepEqual(calls, [['activate', 1]]);
    assert.equal(active(), 1);
});

test('Chrome landing on a hidden tab with nothing listed opens a New Tab in the space', async () => {
    const { focus, calls } = setUp({ open: [11], activeTab: 5, owners: { 5: 'A' }, listed: [] });
    focus.noteRemoval(5);
    assert.equal(await focus.stayAfterClose({ activatedTabId: 11, activatedHidden: true }), true);
    assert.deepEqual(calls, [['new tab']]);
});

test('a hidden tab picked while the tab you were on stays open is left for the caller', async () => {
    const { focus, calls, active } = setUp({
        open: [1, 3, 5, 11],
        activeTab: 5,
        owners: { 1: 'A', 3: 'A', 5: 'A' },
        listed: [1, 3]
    });
    assert.equal(await focus.stayAfterClose({ activatedTabId: 11, activatedHidden: true }), false);
    assert.deepEqual(calls, []);
    assert.equal(active(), 11);
});
