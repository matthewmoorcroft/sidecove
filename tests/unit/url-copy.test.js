import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyCurrentTabUrlWithFallback } from '../../url-copy.js';

function offscreenChrome(calls, { offscreenResult = { success: true } } = {}) {
    return {
        tabs: {
            query: async options => {
                calls.push(['query', options]);
                return [{ id: 7, url: 'https://example.org' }];
            }
        },
        runtime: {
            getURL: path => `chrome-extension://arcify/${path}`,
            getContexts: async () => [],
            sendMessage: async message => {
                calls.push(['message', message]);
                return message.target === 'offscreen' ? offscreenResult : undefined;
            }
        },
        offscreen: {
            createDocument: async details => calls.push(['create', details]),
            closeDocument: async () => calls.push(['close'])
        }
    };
}

test('uses an offscreen document when Chrome provides the clipboard context', async () => {
    const calls = [];
    const chromeApi = offscreenChrome(calls);

    assert.equal(await copyCurrentTabUrlWithFallback({ chromeApi }), true);
    assert.deepEqual(calls[0], ['query', { active: true, lastFocusedWindow: true }]);
    assert.equal(calls[1][0], 'create');
    assert.equal(calls[2][1].target, 'offscreen');
    assert.equal(calls[2][1].text, 'https://example.org');
    assert.deepEqual(calls.find(call => call[0] === 'close'), ['close']);
    assert.ok(calls.some(call => call[1]?.action === 'urlCopySuccess'), 'the sidebar is told to show its toast');
});

test('copies the current URL without the scripting API', async () => {
    const calls = [];
    const chromeApi = offscreenChrome(calls);
    assert.equal(chromeApi.scripting, undefined);

    assert.equal(await copyCurrentTabUrlWithFallback({ chromeApi }), true);
    assert.equal(calls.find(call => call[1]?.target === 'offscreen')[1].text, 'https://example.org');
});

test('the manifest no longer requests the scripting permission', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.permissions, [
        'tabs', 'tabGroups', 'sidePanel', 'storage', 'bookmarks', 'alarms', 'favicon', 'clipboardWrite', 'offscreen'
    ]);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.content_scripts, undefined);
});

test('falls back to the sidebar, never page injection, when the offscreen copy fails', async () => {
    const injected = [];
    const sidebarMessages = [];
    const chromeApi = {
        tabs: { query: async () => [{ id: 42, url: 'https://example.com/article' }] },
        scripting: { executeScript: async details => { injected.push(details); return [{ result: { copied: true } }]; } },
        offscreen: { createDocument: async () => { throw new Error('offscreen unavailable'); } },
        runtime: {
            lastError: null,
            getURL: path => path,
            getContexts: async () => [],
            sendMessage: (message, callback) => {
                sidebarMessages.push(message);
                callback({ success: true });
            }
        }
    };

    assert.equal(await copyCurrentTabUrlWithFallback({ chromeApi }), true);
    assert.deepEqual(injected, []);
    assert.deepEqual(sidebarMessages, [{ command: 'copyCurrentUrl', url: 'https://example.com/article' }]);
});

test('does not report success when neither the offscreen document nor the sidebar can copy', async () => {
    const chromeApi = {
        tabs: { query: async () => [{ id: 42, url: 'https://example.com' }] },
        runtime: {
            lastError: { message: 'No sidebar' },
            sendMessage: (_message, callback) => callback()
        }
    };

    assert.equal(await copyCurrentTabUrlWithFallback({ chromeApi }), false);
});
