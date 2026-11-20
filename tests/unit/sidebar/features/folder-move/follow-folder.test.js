import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followFolderMove } from '../../../../../src/sidebar/features/folder-move/follow-folder.js';

test('after the folder has moved, the window switches to the destination space', async () => {
    const calls = [];
    const onMove = followFolderMove({
        move: async spaceId => {
            calls.push(`move ${spaceId}`);
            return true;
        },
        switchTo: async spaceId => calls.push(`switch ${spaceId}`)
    });
    await onMove({ id: 'work' });
    assert.deepEqual(calls, ['move work', 'switch work']);
});

test('a failed move leaves the window where it was', async () => {
    const switched = [];
    const onMove = followFolderMove({ move: async () => false, switchTo: async id => switched.push(id) });
    await onMove({ id: 'work' });
    assert.deepEqual(switched, []);
});

test('the switch waits for the move to finish', async () => {
    const calls = [];
    let finish;
    const onMove = followFolderMove({
        move: () =>
            new Promise(resolve => {
                finish = () => resolve(true);
            }),
        switchTo: async id => calls.push(id)
    });
    const running = onMove({ id: 'work' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, []);
    finish();
    await running;
    assert.deepEqual(calls, ['work']);
});
