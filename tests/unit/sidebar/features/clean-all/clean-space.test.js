import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpace } from '../../../../../src/sidebar/features/clean-all/clean-space.js';

let toasts, refreshed, archived, undone;

const tabsToClose = [
    { id: 7, url: 'https://a.test/x', title: 'X' },
    { id: 8, url: 'https://a.test/y', title: 'Y' }
];

const deps = (over = {}) => ({
    spaces: () => [{ id: 's1', spaceBookmarks: [], temporaryTabs: [7, 8] }],
    ownedTabs: async () => tabsToClose,
    favoriteUrlKeys: async () => new Set(),
    pinnedStates: async () => ({}),
    windowId: 1,
    tempSectionTabIds: () => [8, 7],
    displayedTabIds: () => [8, 7],
    pendingSaves: async () => {},
    activeTabId: () => 1,
    addArchivedTab: async entry => archived.push(entry.url) && { stored: true, archived: true },
    removeArchivedTab: async () => {},
    openTabIds: async () => [1, 7, 8],
    activateTab: async () => {},
    openNewTab: async () => {},
    startPendingClean: async () => ({ batchId: 'b', closeAt: Date.now() + 10000, spaces: [] }),
    undoPendingClean: async () => {
        undone++;
        return { restored: [7, 8] };
    },
    clearedTabs: { remember: () => {} },
    adoptStoredSpaces: async () => {},
    showUndoToast: (message, undo) => toasts.push({ message, undo }),
    invertTabOrder: async () => true,
    createTab: async () => ({}),
    assignTab: async () => {},
    fetchSpaces: async () => [],
    refresh: async () => refreshed++,
    ...over
});

beforeEach(() => {
    toasts = [];
    refreshed = 0;
    archived = [];
    undone = 0;
});

test('Clear archives the open tabs in list order, says so, and Undo brings them back', async () => {
    await cleanSpace('s1', deps());
    assert.deepEqual(archived, ['https://a.test/y', 'https://a.test/x']);
    assert.equal(toasts[0].message, "Closed 2 tabs. They're in Archived.");
    await toasts[0].undo();
    assert.equal(undone, 1);
    assert.equal(refreshed, 1);
});

test('Clear with nothing to close shows nothing', async () => {
    await cleanSpace('s1', deps({ ownedTabs: async () => [] }));
    assert.deepEqual(toasts, []);
    assert.deepEqual(archived, []);
});

test('a space that is gone is ignored', async () => {
    await cleanSpace('missing', deps());
    assert.deepEqual(toasts, []);
    assert.deepEqual(archived, []);
});

test('if clearing the tabs fails, the error is passed on and no toast is shown', async () => {
    await assert.rejects(
        () =>
            cleanSpace(
                's1',
                deps({
                    startPendingClean: async () => {
                        throw new Error('worker busy');
                    }
                })
            ),
        /worker busy/
    );
    assert.deepEqual(toasts, []);
});
