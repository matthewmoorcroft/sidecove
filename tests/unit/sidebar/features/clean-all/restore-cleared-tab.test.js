import test from 'node:test';
import assert from 'node:assert/strict';
import { createClearedTabs } from '../../../../../src/sidebar/features/clean-all/restore-cleared-tab.js';

function setUp({ restored = [1] } = {}) {
    const cleared = {
        closeAt: 10_000,
        records: [
            { tabId: 1, url: 'http://a/', spaceId: 'home', addedToArchive: true },
            { tabId: 2, url: 'http://b/', spaceId: 'home', addedToArchive: false }
        ]
    };
    const removed = [];
    let clock = 0;
    const clearedTabs = createClearedTabs({
        restoreTab: async tabId => ({ restored: restored.includes(tabId) ? [tabId] : [], spaces: ['spaces'] }),
        removeArchivedTab: async (url, spaceId) => removed.push([url, spaceId]),
        readHiddenIds: async () => [2],
        now: () => clock
    });
    clearedTabs.remember(cleared);
    return { clearedTabs, cleared, removed, setClock: value => (clock = value) };
}

test('a tab that comes back leaves Archived when Clear is what archived it', async () => {
    const { clearedTabs, removed } = setUp();
    assert.deepEqual(await clearedTabs.restore(1), ['spaces']);
    assert.deepEqual(removed, [['http://a/', 'home']]);
});

test('an entry that was archived before Clear stays in Archived', async () => {
    const { clearedTabs, removed } = setUp({ restored: [2] });
    assert.deepEqual(await clearedTabs.restore(2), ['spaces']);
    assert.deepEqual(removed, []);
});

test('a tab that was not waiting to close is left alone', async () => {
    const { clearedTabs, removed } = setUp({ restored: [] });
    assert.equal(await clearedTabs.restore(1), null);
    assert.deepEqual(removed, []);
});

test('a tab comes back once: Archived is not touched a second time', async () => {
    const { clearedTabs, removed } = setUp({ restored: [1] });
    await clearedTabs.restore(1);
    await clearedTabs.restore(1);
    assert.equal(removed.length, 1);
});

test('records of a Clear past its Undo window are dropped when the next one is remembered', async () => {
    const { clearedTabs, removed, setClock } = setUp({ restored: [1, 2, 3] });
    setClock(20_000);
    clearedTabs.remember({
        closeAt: 30_000,
        records: [{ tabId: 3, url: 'http://c/', spaceId: 'home', addedToArchive: true }]
    });
    await clearedTabs.restore(1);
    assert.deepEqual(removed, []);
    await clearedTabs.restore(3);
    assert.deepEqual(removed, [['http://c/', 'home']]);
});

test('a tab that came back is no longer listed for the toast’s Undo to reopen', async () => {
    const { clearedTabs, cleared } = setUp();
    await clearedTabs.restore(1);
    assert.deepEqual(
        cleared.records.map(record => record.tabId),
        [2]
    );
});

test('hidden tabs are the ones the service worker holds as hidden', async () => {
    const { clearedTabs } = setUp();
    assert.equal(await clearedTabs.isHidden(2), true);
    assert.equal(await clearedTabs.isHidden(1), false);
});
