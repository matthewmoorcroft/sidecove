import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackAllWindowsSetting } from '../../../../../src/sidebar/features/all-windows/all-windows-setting.js';

function fakeStorage(stored) {
    const listeners = [];
    return {
        sync: { get: async defaults => ({ ...defaults, ...stored }) },
        onChanged: { addListener: listener => listeners.push(listener) },
        emit: (changes, area) => listeners.forEach(listener => listener(changes, area))
    };
}

test('the setting is off until storage says otherwise', async () => {
    const setting = trackAllWindowsSetting(fakeStorage({}));
    assert.equal(setting.enabled, false);
    await setting.ready;
    assert.equal(setting.enabled, false);
});

test('the saved value is read, and later changes in sync storage are followed', async () => {
    const storage = fakeStorage({ showTabsFromAllWindows: true });
    const seen = [];
    const setting = trackAllWindowsSetting(storage, value => seen.push(value));
    await setting.ready;
    assert.equal(setting.enabled, true);
    storage.emit({ showTabsFromAllWindows: { newValue: false } }, 'sync');
    assert.equal(setting.enabled, false);
    storage.emit({ showTabsFromAllWindows: { newValue: true } }, 'local');
    storage.emit({ invertTabOrder: { newValue: true } }, 'sync');
    assert.equal(setting.enabled, false);
    assert.deepEqual(seen, [false]);
});
