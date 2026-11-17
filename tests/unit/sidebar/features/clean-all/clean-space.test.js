import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpace } from '../../../../../src/sidebar/features/clean-all/clean-space.js';

let sent, toasts, refreshed, reply;

const deps = (over = {}) => ({
    spaces: () => [{ id: 's1', spaceBookmarks: [], temporaryTabs: [] }],
    ownedTabs: async () => [],
    favoriteUrlKeys: async () => new Set(),
    pinnedStates: async () => ({}),
    incognito: false,
    windowId: 1,
    tempSectionTabIds: () => [],
    displayedTabIds: () => [],
    pendingSaves: async () => {},
    activeTabId: () => 1,
    addArchivedTab: async () => true,
    removeArchivedTab: async () => {},
    openTabIds: () => new Set(),
    activateTab: async () => {},
    openNewTab: async () => {},
    startPendingClean: async () => {
        throw new Error('no tabs to close');
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
    sent = [];
    toasts = [];
    refreshed = 0;
    reply = { success: true, cleared: [{ link: { id: 'a' }, addedToArchive: true }] };
    globalThis.chrome = {
        runtime: {
            sendMessage: async message => {
                sent.push(message.action);
                return reply;
            }
        }
    };
});

test('Clear with only closed links clears them, says so, and Undo brings them back', async () => {
    await cleanSpace('s1', deps());
    assert.deepEqual(sent, ['clear']);
    assert.equal(toasts[0].message, "Closed 1 tab. They're in Archived.");
    await toasts[0].undo();
    assert.deepEqual(sent, ['clear', 'restore']);
    assert.equal(refreshed, 1);
});

test('Clear with nothing to clear shows nothing', async () => {
    reply = { success: true, cleared: [] };
    await cleanSpace('s1', deps());
    assert.deepEqual(toasts, []);
});

test('a private window leaves the links alone', async () => {
    await cleanSpace('s1', deps({ incognito: true }));
    assert.deepEqual(sent, []);
    assert.deepEqual(toasts, []);
});

test('a space that is gone is ignored', async () => {
    await cleanSpace('missing', deps());
    assert.deepEqual(sent, []);
});

test('if clearing the tabs fails, the links are put back and the error is passed on', async () => {
    const tabsToClose = [{ id: 7, url: 'https://a.test/x', title: 'X' }];
    await assert.rejects(
        () =>
            cleanSpace(
                's1',
                deps({
                    ownedTabs: async () => tabsToClose,
                    startPendingClean: async () => {
                        throw new Error('worker busy');
                    }
                })
            ),
        /worker busy/
    );
    assert.deepEqual(sent, ['clear', 'restore']);
    assert.deepEqual(toasts, []);
});
