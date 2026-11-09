import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabActivationHandler } from '../../../../../src/sidebar/features/tab-activation/tab-activation.js';

globalThis.chrome = {
    windows: { getCurrent: async () => ({ id: 1 }) },
    storage: { sync: { get: async () => ({}) } }
};
globalThis.document = { querySelector: () => null };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

// Tab 1 is listed in space A; tab 11 is hidden by Clear.
function setUp({
    restore = async () => [{ id: 'A', temporaryTabs: [1, 11], spaceBookmarks: [], pinnedTabs: [] }]
} = {}) {
    const calls = [];
    let spaces = [{ id: 'A', temporaryTabs: [1], spaceBookmarks: [], pinnedTabs: [] }];
    const handler = createTabActivationHandler({
        isCreatingSpace: () => false,
        getSpaces: () => spaces,
        getActiveSpaceId: () => 'A',
        setActiveSpaceId: () => calls.push('switch space'),
        setActiveTabId: id => calls.push(['active', id]),
        closeFocus: { mark: () => 0, stayAfterClose: async () => false },
        clearedTabs: { isHidden: async id => id === 11, restore: async id => restore(id) },
        adoptSpaces: async next => {
            spaces = next;
            calls.push('adopt');
        },
        saveSpaces: () => calls.push('save'),
        clearSelection: () => {},
        activateSpaceInDOM: async () => {},
        updateSpaceSwitcher: () => {},
        refreshActiveSpaceUI: async () => calls.push('refresh'),
        activateTabInDOM: id => calls.push(['row', id]),
        showAllOpenTabsInCollapsedFolders: () => true,
        collapsedFolderShownTabs: new WeakMap(),
        syncCollapsedFoldersInActiveSpace: () => {},
        scrollToTab: () => {}
    });
    return { handler, calls, spaces: () => spaces };
}

test('a hidden tab picked on purpose is brought back before its row is marked', async () => {
    const { handler, calls, spaces } = setUp();
    handler({ tabId: 11, windowId: 1 });
    await settle();
    assert.deepEqual(calls, [['active', 11], 'adopt', 'refresh', 'save', ['row', 11]]);
    assert.equal(spaces()[0].lastTab, 11);
});

test('a hidden tab that cannot be brought back is still followed', async () => {
    const { handler, calls } = setUp({
        restore: async () => {
            throw new Error('Clean All is unavailable');
        }
    });
    handler({ tabId: 11, windowId: 1 });
    await settle();
    assert.deepEqual(calls, [
        ['active', 11],
        ['row', 11]
    ]);
});

test('a listed tab is followed without asking the service worker for anything', async () => {
    const { handler, calls } = setUp({
        restore: async () => assert.fail('only a hidden tab is restored')
    });
    handler({ tabId: 1, windowId: 1 });
    await settle();
    assert.deepEqual(calls, [['active', 1], 'save', ['row', 1]]);
});

test('an activation in another window is ignored', async () => {
    const { handler, calls } = setUp();
    handler({ tabId: 1, windowId: 2 });
    await settle();
    assert.deepEqual(calls, []);
});
