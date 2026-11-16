import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    navActionFromClick,
    navActionFromKey,
    runNavAction
} from '../../../../../src/sidebar/features/nav-buttons/nav-actions.js';

const key = (code, flags = {}) => ({ code, ...flags });

test('on a Mac, Command-[ and Command-] go back and forward, and Command-R reloads', () => {
    assert.deepEqual(navActionFromKey(key('BracketLeft', { metaKey: true }), true), { name: 'back' });
    assert.deepEqual(navActionFromKey(key('BracketRight', { metaKey: true }), true), { name: 'forward' });
    assert.deepEqual(navActionFromKey(key('KeyR', { metaKey: true }), true), { name: 'reload', bypassCache: false });
    assert.deepEqual(navActionFromKey(key('KeyR', { metaKey: true, shiftKey: true }), true), {
        name: 'reload',
        bypassCache: true
    });
});

test('on a Mac, other chords are left alone', () => {
    assert.equal(navActionFromKey(key('BracketLeft', { metaKey: true, shiftKey: true }), true), null); // Chrome's tab switch
    assert.equal(navActionFromKey(key('KeyR', { ctrlKey: true }), true), null);
    assert.equal(navActionFromKey(key('KeyR', { metaKey: true, ctrlKey: true }), true), null);
    assert.equal(navActionFromKey(key('BracketLeft', { metaKey: true, altKey: true }), true), null);
    assert.equal(navActionFromKey(key('ArrowLeft', { altKey: true }), true), null);
    assert.equal(navActionFromKey(key('BracketLeft'), true), null);
    assert.equal(navActionFromKey(key('KeyR'), true), null);
});

test('on Windows and Linux, Alt+Left and Alt+Right go back and forward, and Ctrl+R reloads', () => {
    assert.deepEqual(navActionFromKey(key('ArrowLeft', { altKey: true }), false), { name: 'back' });
    assert.deepEqual(navActionFromKey(key('ArrowRight', { altKey: true }), false), { name: 'forward' });
    assert.deepEqual(navActionFromKey(key('KeyR', { ctrlKey: true }), false), { name: 'reload', bypassCache: false });
    assert.deepEqual(navActionFromKey(key('KeyR', { ctrlKey: true, shiftKey: true }), false), {
        name: 'reload',
        bypassCache: true
    });
});

test('on Windows and Linux, other chords are left alone', () => {
    assert.equal(navActionFromKey(key('ArrowLeft'), false), null);
    assert.equal(navActionFromKey(key('ArrowLeft', { altKey: true, shiftKey: true }), false), null);
    assert.equal(navActionFromKey(key('ArrowLeft', { altKey: true, ctrlKey: true }), false), null);
    assert.equal(navActionFromKey(key('KeyR', { altKey: true }), false), null);
    assert.equal(navActionFromKey(key('KeyR', { metaKey: true }), false), null);
    assert.equal(navActionFromKey(key('BracketLeft', { ctrlKey: true }), false), null);
    assert.equal(navActionFromKey(key('KeyR'), false), null);
});

test('a held key does not repeat, and nothing breaks without an event', () => {
    assert.equal(navActionFromKey(key('KeyR', { metaKey: true, repeat: true }), true), null);
    assert.equal(navActionFromKey(null, true), null);
});

test('a click on the buttons, with Shift on reload skipping the cache', () => {
    assert.deepEqual(navActionFromClick('back', {}), { name: 'back' });
    assert.deepEqual(navActionFromClick('forward', { shiftKey: true }), { name: 'forward' });
    assert.deepEqual(navActionFromClick('reload', {}), { name: 'reload', bypassCache: false });
    assert.deepEqual(navActionFromClick('reload', { shiftKey: true }), { name: 'reload', bypassCache: true });
    assert.equal(navActionFromClick('other', {}), null);
});

function fakeTabs({ active = [{ id: 7 }], fail = false } = {}) {
    const calls = [];
    const act =
        name =>
        async (...args) => {
            calls.push([name, ...args]);
            if (fail) throw new Error('Cannot find a next page in history.');
        };
    return {
        calls,
        query: async query => {
            calls.push(['query', query]);
            return active;
        },
        goBack: act('goBack'),
        goForward: act('goForward'),
        reload: act('reload')
    };
}

test('the action runs on the active tab of this window', async () => {
    const tabs = fakeTabs();
    assert.equal(await runNavAction(tabs, { name: 'back' }), true);
    assert.equal(await runNavAction(tabs, { name: 'forward' }), true);
    assert.equal(await runNavAction(tabs, { name: 'reload', bypassCache: true }), true);
    assert.deepEqual(tabs.calls, [
        ['query', { active: true, currentWindow: true }],
        ['goBack', 7],
        ['query', { active: true, currentWindow: true }],
        ['goForward', 7],
        ['query', { active: true, currentWindow: true }],
        ['reload', 7, { bypassCache: true }]
    ]);
});

test('with nowhere to go, or no active tab, nothing happens and nothing throws', async () => {
    assert.equal(await runNavAction(fakeTabs({ fail: true }), { name: 'back' }), false);
    assert.equal(await runNavAction(fakeTabs({ active: [] }), { name: 'reload' }), false);
    assert.equal(await runNavAction(fakeTabs(), null), false);
    assert.equal(await runNavAction(fakeTabs(), { name: 'sideways' }), false);
});
