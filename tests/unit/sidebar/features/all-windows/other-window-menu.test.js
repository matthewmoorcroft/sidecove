import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    otherWindowMenuActions,
    otherWindowMenuEntries
} from '../../../../../src/sidebar/features/all-windows/other-window-menu.js';

const spaces = [
    { id: 'a', name: 'Home' },
    { id: 'b', name: 'Work' },
    { id: 'c', name: 'Play' }
];

function entriesFor(options = {}) {
    const calls = [];
    const actions = {
        setMuted: value => calls.push(['setMuted', value]),
        rename: () => calls.push(['rename']),
        copyLink: () => calls.push(['copyLink']),
        moveToSpace: id => calls.push(['moveToSpace', id]),
        close: () => calls.push(['close'])
    };
    const entries = otherWindowMenuEntries({
        muted: false,
        spaces,
        currentSpaceId: 'a',
        canRename: true,
        actions,
        ...options
    });
    return { entries, calls };
}

const labels = entries => entries.map(entry => (entry === 'separator' ? '-' : entry.label));

test('another window’s tab offers only actions that work the same from this window', () => {
    const { entries } = entriesFor();
    assert.deepEqual(labels(entries), ['Mute Tab', 'Rename Tab', 'Copy Link', '-', 'Move to Space', 'Close Tab']);
    for (const missing of ['Add to Favorites', 'Pin Tab', 'Duplicate Tab'])
        assert.equal(labels(entries).includes(missing), false);
});

test('mute follows the tab’s state and rename can be left out', () => {
    const { entries, calls } = entriesFor({ muted: true, canRename: false });
    assert.deepEqual(labels(entries).slice(0, 2), ['Unmute Tab', 'Copy Link']);
    entries[0].action();
    assert.deepEqual(calls, [['setMuted', false]]);
});

test('Move to Space lists the other spaces and moves the tab there', () => {
    const { entries, calls } = entriesFor();
    const move = entries.find(entry => entry.label === 'Move to Space');
    assert.deepEqual(
        move.submenu.map(entry => entry.label),
        ['Work', 'Play']
    );
    move.submenu[1].action();
    entries.at(-1).action();
    assert.deepEqual(calls, [['moveToSpace', 'c'], ['close']]);
});

test('Copy Link uses the live address, or the drawn one once the tab has closed in its window', async () => {
    const copied = [];
    const shown = [];
    const deps = live => ({
        chrome: { tabs: { get: async () => (live ? { url: live } : Promise.reject(new Error('No tab'))) } },
        copyText: async url => copied.push(url) > 0,
        showCopied: () => shown.push(true)
    });
    const tab = { id: 7, url: 'https://drawn.test/' };
    await otherWindowMenuActions(tab, deps('https://live.test/')).copyLink();
    await otherWindowMenuActions(tab, deps(null)).copyLink();
    assert.deepEqual(copied, ['https://live.test/', 'https://drawn.test/']);
    assert.equal(shown.length, 2);
});
