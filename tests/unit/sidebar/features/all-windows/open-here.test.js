import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenHere } from '../../../../../src/sidebar/features/all-windows/open-here.js';

function fakeTabs() {
    const calls = [];
    return {
        calls,
        update: async (id, props) => calls.push(['update', id, props]),
        create: async props => {
            calls.push(['create', props]);
            return { id: 100, ...props };
        }
    };
}

test('this window’s tab is switched to; another window’s page opens here once', async () => {
    const tabs = fakeTabs();
    const timers = [];
    const openHere = createOpenHere(tabs, { schedule: fn => timers.push(fn) });
    await openHere({ id: 1, windowId: 1, url: 'https://a.test/' }, 1);
    const other = { id: 2, windowId: 2, url: 'https://b.test/', pinned: true };
    await Promise.all([openHere(other, 1), openHere(other, 1)]);
    assert.deepEqual(tabs.calls, [
        ['update', 1, { active: true }],
        ['create', { windowId: 1, url: 'https://b.test/', pinned: true, active: true }]
    ]);
    // After the guard time the page can be opened again.
    timers.forEach(fn => fn());
    await openHere(other, 1);
    assert.equal(tabs.calls.length, 3);
});

test('a tab with no address yet opens nothing', async () => {
    const tabs = fakeTabs();
    const openHere = createOpenHere(tabs, { schedule: () => {} });
    assert.equal(await openHere({ id: 2, windowId: 2 }, 1), null);
    assert.deepEqual(tabs.calls, []);
});
