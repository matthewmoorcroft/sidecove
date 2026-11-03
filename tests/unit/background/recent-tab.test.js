import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jumpToRecentTab, registerRecentTab, RECENCY_STORAGE_KEY } from '../../../src/background/recent-tab.js';
import { TabRecency } from '../../../src/background/tab-recency.js';

const space = (id, ids) => ({ id, spaceBookmarks: [], temporaryTabs: ids });
const spaces = [space('home', [1, 2, 3, 4]), space('work', [10, 11])];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A tiny browser: tabs.update switches the active tab after `updateDelay`, then reports it.
function fakeChrome({ tabIds, activeId, stored = {}, session = {}, updateDelay = 0 }) {
    const state = { activeId };
    const updates = [];
    const listeners = {};
    const event = name => ({ addListener: fn => (listeners[name] = fn) });
    const chromeApi = {
        windows: { getLastFocused: async () => ({ id: 1 }) },
        tabs: {
            query: async () => tabIds.map(id => ({ id, active: id === state.activeId })),
            update: async id => {
                updates.push(id);
                await wait(updateDelay);
                state.activeId = id;
                setTimeout(() => listeners.activated?.({ tabId: id, windowId: 1 }), 0);
            },
            onActivated: event('activated'),
            onRemoved: event('removed'),
            onReplaced: event('replaced')
        },
        storage: {
            session: {
                get: async key => (key === 'activeSpaces' ? session : stored),
                set: async () => {}
            }
        }
    };
    return { chromeApi, updates, listeners, state };
}
const readSpaces = async () => spaces;

test('jumps to the previous tab of the active tab’s space', async () => {
    const recency = new TabRecency([3, 10, 2, 1]);
    const { chromeApi, updates } = fakeChrome({ tabIds: [1, 2, 3, 10, 11], activeId: 3 });
    const target = await jumpToRecentTab({ chromeApi, readSpaces, recency, now: 0 });
    assert.equal(target, 2, 'tab 10 is more recent but belongs to another space');
    assert.deepEqual(updates, [2]);
});

test('ignores tabs of the space that sit in another window', async () => {
    const recency = new TabRecency([3, 2, 1]);
    const { chromeApi } = fakeChrome({ tabIds: [1, 3], activeId: 3 });
    assert.equal(await jumpToRecentTab({ chromeApi, readSpaces, recency, now: 0 }), 1);
});

test('a tab outside every space uses the space shown in the window', async () => {
    const recency = new TabRecency([99, 1, 2]);
    const { chromeApi } = fakeChrome({
        tabIds: [1, 2, 99],
        activeId: 99,
        session: { activeSpaces: { 1: 'home' } }
    });
    assert.equal(await jumpToRecentTab({ chromeApi, readSpaces, recency, now: 0 }), 1);
});

test('does nothing when the tab belongs to no space and none is shown', async () => {
    const { chromeApi, updates } = fakeChrome({ tabIds: [99], activeId: 99 });
    assert.equal(await jumpToRecentTab({ chromeApi, readSpaces, recency: new TabRecency(), now: 0 }), null);
    assert.deepEqual(updates, []);
});

test('a tab that closed during the jump is forgotten', async () => {
    const recency = new TabRecency([3, 2, 1]);
    const { chromeApi } = fakeChrome({ tabIds: [1, 2, 3], activeId: 3 });
    chromeApi.tabs.update = async () => {
        throw new Error('No tab with id: 2.');
    };
    assert.equal(await jumpToRecentTab({ chromeApi, readSpaces, recency, now: 0 }), null);
    assert.deepEqual(recency.toJSON(), [3, 1]);
});

test('a passing error keeps the tab in the order', async () => {
    const recency = new TabRecency([3, 2, 1]);
    const { chromeApi } = fakeChrome({ tabIds: [1, 2, 3], activeId: 3 });
    chromeApi.tabs.update = async () => {
        throw new Error('Tabs cannot be edited right now (user may be dragging a tab).');
    };
    assert.equal(await jumpToRecentTab({ chromeApi, readSpaces, recency, now: 0 }), null);
    assert.deepEqual(recency.toJSON(), [3, 2, 1]);
});

function registered(options) {
    const fake = fakeChrome(options);
    const clock = { now: 0 };
    const spaceStore = {
        spaces,
        // Reading the spaces waits behind other store work, as it does in the real store.
        run: async operation => {
            await wait(30);
            return operation();
        }
    };
    const onCommand = registerRecentTab({ chromeApi: fake.chromeApi, spaceStore, now: () => clock.now });
    return { ...fake, clock, onCommand };
}

test('the service worker records activations and answers the shortcut', async () => {
    const { onCommand, updates, listeners } = registered({
        tabIds: [1, 2, 3],
        activeId: 3,
        stored: { [RECENCY_STORAGE_KEY]: [1] }
    });
    await listeners.activated({ tabId: 2, windowId: 1 });
    await listeners.activated({ tabId: 3, windowId: 1 });
    await onCommand();
    assert.deepEqual(updates, [2]);
});

test('two quick presses go two tabs back, even when the tab switch is slow', async () => {
    const { onCommand, updates, listeners, state } = registered({
        tabIds: [1, 2, 3],
        activeId: 3,
        updateDelay: 20
    });
    for (const tabId of [1, 2, 3]) await listeners.activated({ tabId, windowId: 1 });
    const first = onCommand();
    const second = onCommand(); // Pressed before the first switch has taken effect.
    await Promise.all([first, second]);
    assert.deepEqual(updates, [2, 1]);
    assert.equal(state.activeId, 1);
});

test('a press is timed when it arrives, not when it gets its turn', async () => {
    const { onCommand, updates, listeners, clock } = registered({ tabIds: [1, 2, 3, 4], activeId: 4 });
    for (const tabId of [1, 2, 3, 4]) await listeners.activated({ tabId, windowId: 1 });
    const first = onCommand();
    clock.now = 500; // Reading the spaces takes 30 ms each time, but the key presses were 500 ms apart.
    const second = onCommand();
    clock.now = 1000;
    const third = onCommand();
    await Promise.all([first, second, third]);
    assert.deepEqual(updates, [3, 2, 1]);
});

test('the manifest declares the command without a suggested key', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../manifest.json', import.meta.url), 'utf8'));
    assert.ok(manifest.commands.RecentTabInSpace.description);
    assert.equal(manifest.commands.RecentTabInSpace.suggested_key, undefined);
    assert.equal(manifest.permissions.length, 9, 'no permission was added');
});
