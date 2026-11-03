import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jumpToRecentTab, registerRecentTab, RECENCY_STORAGE_KEY } from '../../../src/background/recent-tab.js';
import { TabRecency } from '../../../src/background/tab-recency.js';

const space = (id, ids) => ({ id, spaceBookmarks: [], temporaryTabs: ids });
const spaces = [space('home', [1, 2, 3]), space('work', [10, 11])];

function fakeChrome({ tabs, activeId, stored = {}, session = {} }) {
    const calls = [];
    const listeners = {};
    const event = name => ({ addListener: fn => (listeners[name] = fn) });
    const chromeApi = {
        windows: { getLastFocused: async () => ({ id: 1 }) },
        tabs: {
            query: async query => (query.active ? tabs.filter(t => t.id === activeId) : tabs),
            update: async (id, props) => calls.push(['update', id, props]),
            onActivated: event('activated'),
            onRemoved: event('removed'),
            onReplaced: event('replaced')
        },
        storage: {
            session: {
                get: async key => (key === 'activeSpaces' ? session : stored),
                set: async value => calls.push(['set', value])
            }
        }
    };
    return { chromeApi, calls, listeners };
}
const tabsOf = (...ids) => ids.map(id => ({ id }));

test('jumps to the previous tab of the active tab’s space', async () => {
    const recency = new TabRecency([3, 10, 2, 1]);
    const { chromeApi, calls } = fakeChrome({ tabs: tabsOf(1, 2, 3, 10, 11), activeId: 3 });
    const target = await jumpToRecentTab({ chromeApi, spaces, recency, now: 0 });
    assert.equal(target, 2, 'tab 10 is more recent but belongs to another space');
    assert.deepEqual(calls, [['update', 2, { active: true }]]);
});

test('ignores tabs of the space that sit in another window', async () => {
    const recency = new TabRecency([3, 2, 1]);
    const { chromeApi } = fakeChrome({ tabs: tabsOf(1, 3), activeId: 3 });
    assert.equal(await jumpToRecentTab({ chromeApi, spaces, recency, now: 0 }), 1);
});

test('a tab outside every space uses the space shown in the window', async () => {
    const recency = new TabRecency([99, 1, 2]);
    const { chromeApi } = fakeChrome({
        tabs: tabsOf(1, 2, 99),
        activeId: 99,
        session: { activeSpaces: { 1: 'home' } }
    });
    assert.equal(await jumpToRecentTab({ chromeApi, spaces, recency, now: 0 }), 1);
});

test('does nothing when the tab belongs to no space and none is shown', async () => {
    const { chromeApi, calls } = fakeChrome({ tabs: tabsOf(99), activeId: 99 });
    assert.equal(await jumpToRecentTab({ chromeApi, spaces, recency: new TabRecency(), now: 0 }), null);
    assert.deepEqual(calls, []);
});

test('a tab that closed during the jump is forgotten', async () => {
    const recency = new TabRecency([3, 2, 1]);
    const { chromeApi } = fakeChrome({ tabs: tabsOf(1, 2, 3), activeId: 3 });
    chromeApi.tabs.update = async () => {
        throw new Error('No tab with id');
    };
    assert.equal(await jumpToRecentTab({ chromeApi, spaces, recency, now: 0 }), null);
    assert.deepEqual(recency.toJSON(), [3, 1]);
});

test('the service worker records activations and answers the shortcut', async () => {
    const { chromeApi, calls, listeners } = fakeChrome({
        tabs: tabsOf(1, 2, 3),
        activeId: 3,
        stored: { [RECENCY_STORAGE_KEY]: [1] }
    });
    const spaceStore = { dispatch: async () => spaces };
    const onCommand = registerRecentTab({ chromeApi, spaceStore, now: () => 0 });
    await listeners.activated({ tabId: 2 });
    await listeners.activated({ tabId: 3 });
    await onCommand();
    assert.deepEqual(calls, [['update', 2, { active: true }]]);
});

test('the manifest declares the command without a suggested key', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../manifest.json', import.meta.url), 'utf8'));
    assert.ok(manifest.commands.RecentTabInSpace.description);
    assert.equal(manifest.commands.RecentTabInSpace.suggested_key, undefined);
    assert.equal(manifest.permissions.length, 9, 'no permission was added');
});
