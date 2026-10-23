import test from 'node:test';
import assert from 'node:assert/strict';
import { audioState } from '../../tab-audio.js';

test('a muted tab shows as muted whether or not it is playing', () => {
    assert.equal(audioState({ audible: true, mutedInfo: { muted: true } }), 'muted');
    assert.equal(audioState({ audible: false, mutedInfo: { muted: true } }), 'muted');
});

test('an audible tab shows as playing and a silent one shows nothing', () => {
    assert.equal(audioState({ audible: true, mutedInfo: { muted: false } }), 'playing');
    assert.equal(audioState({ audible: false, mutedInfo: { muted: false } }), null);
    assert.equal(audioState({}), null);
    assert.equal(audioState(null), null);
});
