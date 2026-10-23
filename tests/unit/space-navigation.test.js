import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    parseSpaceCommand, spaceRequestFromKey, resolveSpaceTarget, scrollLeftToReveal, switchSpaceWithoutSidebar
} from '../../space-navigation.js';

const spaces = ['home', 'work', 'music', 'read'].map(id => ({ id, spaceBookmarks: [], temporaryTabs: [] }));

test('manifest commands map to space requests', () => {
    assert.deepEqual(parseSpaceCommand('NextSpace'), { delta: 1 });
    assert.deepEqual(parseSpaceCommand('PrevSpace'), { delta: -1 });
    assert.deepEqual(parseSpaceCommand('SwitchToSpace3'), { slot: 3 });
    assert.equal(parseSpaceCommand('SwitchToSpace0'), null);
    assert.equal(parseSpaceCommand('quickPinToggle'), null);
});

test('the manifest declares every space command without suggested keys', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
    const names = ['NextSpace', 'PrevSpace', ...Array.from({ length: 9 }, (_, i) => `SwitchToSpace${i + 1}`)];
    for (const name of names) {
        assert.ok(manifest.commands[name], `${name} missing`);
        assert.equal(manifest.commands[name].suggested_key, undefined, `${name} must not claim a key`);
        assert.deepEqual(parseSpaceCommand(name) !== null, true);
    }
    const suggested = Object.values(manifest.commands).filter(command => command.suggested_key);
    assert.ok(suggested.length <= 4, 'Chrome allows at most four suggested keys');
});

test('Ctrl+digit picks a space and Ctrl+9 the last one', () => {
    assert.deepEqual(spaceRequestFromKey({ ctrlKey: true, code: 'Digit2' }), { slot: 2 });
    assert.deepEqual(spaceRequestFromKey({ ctrlKey: true, code: 'Numpad1' }), { slot: 1 });
    assert.deepEqual(spaceRequestFromKey({ ctrlKey: true, shiftKey: true, code: 'BracketRight' }), { delta: 1 });
    assert.deepEqual(spaceRequestFromKey({ ctrlKey: true, shiftKey: true, code: 'BracketLeft' }), { delta: -1 });
    assert.equal(spaceRequestFromKey({ metaKey: true, ctrlKey: true, code: 'Digit2' }), null);
    assert.equal(spaceRequestFromKey({ altKey: true, ctrlKey: true, code: 'Digit2' }), null);
    assert.equal(spaceRequestFromKey({ ctrlKey: false, code: 'Digit2' }), null);
    assert.equal(spaceRequestFromKey({ ctrlKey: true, code: 'KeyA' }), null);
});

test('requests resolve to a different space or nothing', () => {
    assert.equal(resolveSpaceTarget(spaces, 'home', { delta: 1 }), 'work');
    assert.equal(resolveSpaceTarget(spaces, 'home', { delta: -1 }), 'read');
    assert.equal(resolveSpaceTarget(spaces, 'read', { delta: 1 }), 'home');
    assert.equal(resolveSpaceTarget(spaces, 'home', { slot: 3 }), 'music');
    assert.equal(resolveSpaceTarget(spaces, 'home', { slot: 9 }), 'read');
    assert.equal(resolveSpaceTarget(spaces, 'home', { slot: 6 }), null);
    assert.equal(resolveSpaceTarget(spaces, 'home', { slot: 1 }), null);
    assert.equal(resolveSpaceTarget([spaces[0]], 'home', { delta: 1 }), null);
    assert.equal(resolveSpaceTarget([], 'home', { delta: 1 }), null);
    assert.equal(resolveSpaceTarget(spaces, 'missing', { delta: 1 }), 'home');
});

test('the active chip is scrolled clear of both edges', () => {
    const view = { viewWidth: 300, startInset: 8, endInset: 48 };
    // Already visible: unchanged.
    assert.equal(scrollLeftToReveal({ ...view, scrollLeft: 0, itemLeft: 100, itemWidth: 60 }), 0);
    // Hidden under the add button on the right.
    assert.equal(scrollLeftToReveal({ ...view, scrollLeft: 0, itemLeft: 230, itemWidth: 60 }), 38);
    // Scrolled past on the left.
    assert.equal(scrollLeftToReveal({ ...view, scrollLeft: 200, itemLeft: 120, itemWidth: 60 }), 112);
    assert.equal(scrollLeftToReveal({ ...view, scrollLeft: 50, itemLeft: 4, itemWidth: 60 }), 0);
});

test('without a sidebar the command activates the target space and its last tab', async () => {
    const stored = [
        { id: 'home', spaceBookmarks: [], temporaryTabs: [1, 2], lastTab: 2 },
        { id: 'work', spaceBookmarks: [5], temporaryTabs: [3, 4], lastTab: 3 },
        { id: 'empty', spaceBookmarks: [], temporaryTabs: [] }
    ];
    const calls = [];
    const chromeApi = {
        tabs: {
            query: async ({ active }) => active ? [{ id: 2, windowId: 9 }] : [1, 2, 3, 4, 5].map(id => ({ id, windowId: 9 })),
            update: async (id, props) => calls.push(['update', id, props])
        },
        storage: { session: { get: async () => ({ activeSpaces: {} }) } }
    };
    const dispatch = async message => { calls.push([message.action, message.spaceId]); return stored; };
    assert.equal(await switchSpaceWithoutSidebar({ chromeApi, dispatch, windowId: 9, request: { delta: 1 } }), 'work');
    assert.deepEqual(calls.filter(c => c[0] !== 'get'), [['activate', 'work'], ['update', 3, { active: true }]]);

    calls.length = 0;
    assert.equal(await switchSpaceWithoutSidebar({ chromeApi, dispatch, windowId: 9, request: { slot: 3 } }), 'empty');
    assert.deepEqual(calls.filter(c => c[0] !== 'get'), [['activate', 'empty']]);
});
