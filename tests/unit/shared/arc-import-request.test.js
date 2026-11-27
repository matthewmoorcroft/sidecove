import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ARC_IMPORT_REQUEST_KEY,
    requestArcImport,
    watchArcImportRequests
} from '../../../src/shared/arc-import-request.js';

// A chrome with just local storage and its change events.
function fakeChrome() {
    const data = {};
    const listeners = [];
    return {
        storage: {
            local: {
                get: async key => (key in data ? { [key]: data[key] } : {}),
                set: async values => {
                    for (const [key, newValue] of Object.entries(values)) {
                        data[key] = newValue;
                        listeners.forEach(listener => listener({ [key]: { newValue } }, 'local'));
                    }
                },
                remove: async key => {
                    delete data[key];
                }
            },
            onChanged: { addListener: listener => listeners.push(listener) }
        },
        data
    };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('a request made before the sidebar opens is taken when it starts watching', async () => {
    globalThis.chrome = fakeChrome();
    await requestArcImport();
    let opened = 0;
    await watchArcImportRequests(() => opened++);
    assert.equal(opened, 1);
    assert.equal(ARC_IMPORT_REQUEST_KEY in globalThis.chrome.data, false);
});

test('a request made while the sidebar is open opens the import once', async () => {
    globalThis.chrome = fakeChrome();
    let opened = 0;
    await watchArcImportRequests(() => opened++);
    assert.equal(opened, 0);
    await requestArcImport();
    await settle();
    assert.equal(opened, 1);
});
