import test from 'node:test';
import assert from 'node:assert/strict';
import { stepTabInSpace } from '../../../src/background/tab-step.js';

const home = { id: 'home', spaceBookmarks: [], temporaryTabs: [1, 2, 3], pinnedTabs: [8] };
const work = { id: 'work', spaceBookmarks: [], temporaryTabs: [10, 11], pinnedTabs: [9] };

// One window with the pinned tabs 8 and 9 first, then the tabs of both spaces.
function setup({ activeId, state = {} }) {
    const updates = [];
    const tabs = [8, 9, 1, 2, 3, 10, 11].map((id, index) => ({ id, index, pinned: id >= 8 && id <= 9 }));
    const chromeApi = {
        windows: { getLastFocused: async () => ({ id: 5 }) },
        tabs: {
            query: async () => tabs.map(tab => ({ ...tab, active: tab.id === activeId })),
            update: async id => updates.push(id)
        }
    };
    const readState = async () => ({
        spaces: [home, work],
        activeSpaces: { 5: 'work' },
        perSpaceFavorites: false,
        invertTabOrder: false,
        ...state
    });
    return { chromeApi, readState, updates };
}
const press = (context, direction) => stepTabInSpace({ ...context, direction });

test('from a shared pinned tab, steps through the pinned tabs and into the space shown', async () => {
    const context = setup({ activeId: 8 });
    assert.equal(await press(context, 'next'), 9);
    assert.equal(await press(context, 'prev'), 11, 'wraps back to the end of the space shown');
});

test('from the last tab of a space, next wraps to the first pinned tab', async () => {
    const context = setup({ activeId: 11 });
    assert.equal(await press(context, 'next'), 8);
});

test('from a space’s first tab, previous goes to the last pinned tab', async () => {
    const context = setup({ activeId: 10 });
    assert.equal(await press(context, 'prev'), 9);
});

test('with favorites per space, a pinned tab selects its own space and only its pins are walked', async () => {
    const context = setup({ activeId: 8, state: { perSpaceFavorites: true } });
    assert.equal(await press(context, 'next'), 1, 'tab 9 belongs to the other space');
    assert.equal(await press(context, 'prev'), 3);
});

test('does nothing when the active tab has no space or the window has no active tab', async () => {
    const context = setup({ activeId: 8, state: { activeSpaces: {} } });
    assert.equal(await press(context, 'next'), null);
    assert.deepEqual(context.updates, []);
    const none = setup({ activeId: 99 });
    assert.equal(await press(none, 'next'), null);
});
