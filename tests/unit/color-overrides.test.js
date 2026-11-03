import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_NAMES, DEFAULT_LIGHT_COLORS, DEFAULT_DARK_COLORS, overrideProperties, applyOverrideProperties, changedColors } from '../../color-overrides.js';

test('light and dark overrides map to separate CSS properties', () => {
    const properties = overrideProperties({ blue: '#ff8800' }, { blue: '#112233', red: '#440000' });
    assert.equal(properties['--user-chrome-blue-color'], '#ff8800');
    assert.equal(properties['--user-chrome-blue-dark-mode-color'], '#112233');
    assert.equal(properties['--user-chrome-red-color'], null);
    assert.equal(properties['--user-chrome-red-dark-mode-color'], '#440000');
    assert.equal(Object.keys(properties).length, COLOR_NAMES.length * 2);
});

test('a light override alone leaves dark mode on its default', () => {
    const properties = overrideProperties({ blue: '#ff8800' }, null);
    assert.equal(properties['--user-chrome-blue-dark-mode-color'], null);
});

test('applying sets overrides and clears colours that have none', () => {
    const set = new Map();
    const element = { style: { setProperty: (k, v) => set.set(k, v), removeProperty: k => set.delete(k) } };
    set.set('--user-chrome-green-dark-mode-color', '#000000');
    applyOverrideProperties(element, null, { blue: '#112233' });
    assert.deepEqual([...set], [['--user-chrome-blue-dark-mode-color', '#112233']]);
});

test('only colours that differ from the default are stored', () => {
    assert.equal(changedColors({ ...DEFAULT_LIGHT_COLORS }, DEFAULT_LIGHT_COLORS), null);
    assert.deepEqual(changedColors({ ...DEFAULT_DARK_COLORS, blue: '#112233' }, DEFAULT_DARK_COLORS), { blue: '#112233' });
    assert.equal(changedColors({ blue: DEFAULT_DARK_COLORS.blue.toUpperCase() }, DEFAULT_DARK_COLORS), null);
});
