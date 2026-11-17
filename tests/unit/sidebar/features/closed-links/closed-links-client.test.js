import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clearClosedLinks,
    clearedMessage,
    openClosedLink,
    readClosedLinks
} from '../../../../../src/sidebar/features/closed-links/closed-links-client.js';

const runtimeReplying = (reply, sent = []) => ({
    sendMessage: async message => {
        sent.push(message);
        return reply;
    }
});

test('Clear asks the worker, and Undo hands back exactly what Clear archived', async () => {
    const sent = [];
    const cleared = [{ link: { id: 'a' }, addedToArchive: true }];
    const result = await clearClosedLinks('s1', runtimeReplying({ success: true, cleared }, sent));
    assert.equal(result.count, 1);
    await result.undo();
    assert.deepEqual(sent, [
        { type: 'closedLinks', action: 'clear', spaceId: 's1' },
        { type: 'closedLinks', action: 'restore', cleared }
    ]);
});

test('Undo with nothing cleared sends nothing', async () => {
    const sent = [];
    const result = await clearClosedLinks('s1', runtimeReplying({ success: true, cleared: [] }, sent));
    assert.equal(result.count, 0);
    await result.undo();
    assert.equal(sent.length, 1);
});

test('a refusal from the worker is an error the panel can show', async () => {
    globalThis.chrome = { runtime: runtimeReplying({ success: false, error: 'no window' }) };
    await assert.rejects(() => openClosedLink('l', 1), /no window/);
    globalThis.chrome = { runtime: runtimeReplying(undefined) };
    await assert.rejects(() => openClosedLink('l', 1), /unavailable/);
});

test('the panel reads links from storage and treats a missing list as empty', async () => {
    assert.deepEqual(await readClosedLinks({ get: async () => ({}) }), []);
    assert.deepEqual(await readClosedLinks({ get: async () => ({ closedLinks: [{ id: 'a' }] }) }), [{ id: 'a' }]);
});

test('the Undo message counts tabs and links together', () => {
    assert.equal(clearedMessage(2, 1), "Closed 3 tabs. They're in Archived.");
    assert.equal(clearedMessage(0, 1), "Closed 1 tab. They're in Archived.");
});
