import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openOnboardingIfDue } from '../../../src/background/onboarding-lifecycle.js';

// The whole service worker, loaded once with a stub chrome, for the listeners it registers.
// The import is cached, so the worker loads once for this file.
const loaded = (async () => {
    const messages = [],
        installed = [];
    const event = { addListener() {} };
    const area = data => ({
        async get(keys) {
            const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || data);
            return Object.fromEntries(names.map(k => [k, structuredClone(data[k] ?? keys?.[k])]));
        },
        async set(values) {
            Object.assign(data, structuredClone(values));
        },
        async remove(key) {
            delete data[key];
        }
    });
    const home = {
        id: 'home',
        spaceUuid: 'home',
        name: 'Home',
        color: 'grey',
        bookmarkFolderId: 'home',
        spaceBookmarks: [],
        temporaryTabs: []
    };
    globalThis.chrome = {
        runtime: {
            onInstalled: { addListener: listener => installed.push(listener) },
            onStartup: event,
            onMessage: { addListener: listener => messages.push(listener) },
            getManifest: () => ({ version: '5.1.0' }),
            getURL: path => `chrome-extension://sidecove/${path}`
        },
        sidePanel: { setPanelBehavior: async () => {} },
        commands: { onCommand: event },
        alarms: { onAlarm: event, clear: async () => {}, create: async () => {} },
        storage: {
            onChanged: event,
            local: area({ spaceModelVersion: 2, spaces: [home] }),
            session: area({ spaceSession: true }),
            sync: area({})
        },
        tabs: {
            onCreated: event,
            onUpdated: event,
            onRemoved: event,
            onReplaced: event,
            onActivated: event,
            onMoved: event,
            onAttached: event,
            onDetached: event,
            query: async () => [],
            get: async () => undefined,
            create: async () => ({})
        },
        tabGroups: { onRemoved: event, onUpdated: event, query: async () => [] },
        windows: {
            onCreated: event,
            onFocusChanged: event,
            onRemoved: event,
            get: async id => ({ id, focused: true }),
            getAll: async () => []
        },
        bookmarks: {
            onCreated: event,
            onRemoved: event,
            onChanged: event,
            onMoved: event,
            onChildrenReordered: event,
            onImportEnded: event,
            search: async () => [{ id: 'root' }],
            get: async () => [],
            getChildren: async () => [],
            getSubTree: async () => [{ id: 'root', children: [] }]
        }
    };
    await import('../../../src/background/background.js');
    return { messages, installed };
})();

test('space-store replies are not intercepted by unrelated Promise listeners', async () => {
    const app = await loaded;
    const replies = [];
    const claims = app.messages.map(listener =>
        listener({ type: 'spaceStore', action: 'get' }, {}, reply => replies.push(reply))
    );
    assert.equal(claims.filter(claim => claim === true).length, 1);
    assert.equal(
        claims.some(claim => typeof claim?.then === 'function'),
        false
    );
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.length, 1);
    assert.equal(replies[0].success, true);
    assert.equal(replies[0].spaces[0].id, 'home');
});

test('the service worker opens the onboarding check when Chrome installs or updates it', async () => {
    const app = await loaded;
    assert.ok(app.installed.includes(openOnboardingIfDue));
});
