import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    locationSteps,
    MAC_PATH,
    WINDOWS_PATH
} from '../../../../../src/sidebar/features/arc-import/arc-file-location.js';

test('a Mac sees only the Mac steps', () => {
    const steps = locationSteps('mac');
    assert.deepEqual(
        steps.map(step => step.system),
        ['mac']
    );
    assert.equal(steps[0].path, MAC_PATH);
});

test('Windows sees only the Windows steps', () => {
    const steps = locationSteps('win');
    assert.deepEqual(
        steps.map(step => step.system),
        ['win']
    );
    assert.equal(steps[0].path, WINDOWS_PATH);
});

test('Linux, ChromeOS and an unknown system see both, Mac first', () => {
    for (const os of ['linux', 'cros', 'openbsd', undefined]) {
        assert.deepEqual(
            locationSteps(os).map(step => step.system),
            ['mac', 'win']
        );
    }
});
