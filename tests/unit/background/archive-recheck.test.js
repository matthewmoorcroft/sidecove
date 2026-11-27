import test from 'node:test';
import assert from 'node:assert/strict';
import { stillIdle } from '../../../src/background/archive-recheck.js';

const now = 1_000_000;
const state = (extra = {}) => ({
    memberIds: new Set(),
    bindings: {},
    urlKeys: new Set(),
    lastActivity: now - 5000,
    now,
    idleMillis: 1000,
    ...extra
});
const tab = (extra = {}) => ({ id: 1, url: 'https://idle.test/', ...extra });

test('an idle ordinary tab is still archivable', () => {
    assert.equal(stillIdle(tab(), state()), true);
});

test('a tab that is now active, audible, pinned or gone is kept', () => {
    assert.equal(stillIdle(tab({ active: true }), state()), false);
    assert.equal(stillIdle(tab({ audible: true }), state()), false);
    assert.equal(stillIdle(tab({ pinned: true }), state()), false);
    assert.equal(stillIdle(null, state()), false);
});

test('a tab that became a protected favourite is kept', () => {
    assert.equal(stillIdle(tab(), state({ memberIds: new Set([1]) })), false);
    assert.equal(stillIdle(tab(), state({ bindings: { 1: { bookmarkId: 'b' } } })), false);
});

test('a tab used recently, or with no activity record, is kept', () => {
    assert.equal(stillIdle(tab(), state({ lastActivity: now - 10 })), false);
    assert.equal(stillIdle(tab(), state({ lastActivity: undefined })), false);
});
