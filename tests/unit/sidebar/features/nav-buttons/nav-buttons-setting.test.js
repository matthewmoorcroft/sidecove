import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackNavButtonsSetting } from '../../../../../src/sidebar/features/nav-buttons/nav-buttons-setting.js';

function fakeStorage(stored) {
    const listeners = [];
    return {
        sync: { get: async defaults => ({ ...defaults, ...stored }) },
        onChanged: { addListener: listener => listeners.push(listener) },
        emit: (changes, area) => listeners.forEach(listener => listener(changes, area))
    };
}

test('the row is shown unless the setting was turned off, also when it was never saved', async () => {
    const seen = [];
    await trackNavButtonsSetting(fakeStorage({}), value => seen.push(value));
    await trackNavButtonsSetting(fakeStorage({ showNavButtons: false }), value => seen.push(value));
    assert.deepEqual(seen, [true, false]);
});

test('later changes in sync storage are followed, and other storage is ignored', async () => {
    const storage = fakeStorage({});
    const seen = [];
    await trackNavButtonsSetting(storage, value => seen.push(value));
    storage.emit({ showNavButtons: { newValue: false } }, 'sync');
    storage.emit({ showNavButtons: { newValue: true } }, 'local');
    storage.emit({ invertTabOrder: { newValue: false } }, 'sync');
    storage.emit({ showNavButtons: { newValue: true } }, 'sync');
    assert.deepEqual(seen, [true, false, true]);
});
