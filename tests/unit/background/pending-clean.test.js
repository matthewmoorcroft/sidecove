import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerPendingClean, PENDING_CLEAN_KEY } from '../../../src/background/pending-clean.js';
import { PENDING_CLEAN_MESSAGE, UNDO_WINDOW_MS, CLOSE_GRACE_MS } from '../../../src/shared/pending-clean.js';

let tabs, session, dispatched, clock, timers, listener, removeError, hideError;
const DUE = UNDO_WINDOW_MS + CLOSE_GRACE_MS;

const chromeApi = () => ({
    tabs: {
        query: async () => tabs.map(t => ({ ...t, mutedInfo: { ...t.mutedInfo } })),
        update: async (id, props) => {
            const tab = tabs.find(t => t.id === id);
            if (!tab) throw new Error(`No tab with id: ${id}.`);
            tab.mutedInfo = { muted: props.muted };
        },
        remove: async ids => {
            if (removeError) throw removeError;
            tabs = tabs.filter(t => !ids.includes(t.id));
        }
    },
    storage: {
        session: {
            get: async key => ({ [key]: structuredClone(session[key]) }),
            set: async values => Object.assign(session, structuredClone(values))
        }
    },
    runtime: { onMessage: { addListener: fn => (listener = fn) } }
});
const spaceStore = () => ({
    dispatch: async message => {
        if (hideError && message.action === 'hide') throw hideError;
        dispatched.push(structuredClone(message));
        return [];
    }
});
const setTimer = (fn, ms) => {
    timers.push({ fn, at: clock + ms });
    return timers.length - 1;
};
const clearTimer = id => {
    if (timers[id]) timers[id].cancelled = true;
};
// Moves the fake clock and runs the timers that came due.
const advance = async ms => {
    clock += ms;
    for (const timer of timers) {
        if (!timer.cancelled && !timer.done && timer.at <= clock) {
            timer.done = true;
            await timer.fn();
        }
    }
    await new Promise(resolve => setImmediate(resolve));
};
const start = async () => {
    const api = registerPendingClean({
        chromeApi: chromeApi(),
        spaceStore: spaceStore(),
        now: () => clock,
        setTimer,
        clearTimer
    });
    await api.ready;
    return api;
};
const send = message =>
    new Promise(resolve => {
        const handled = listener({ type: PENDING_CLEAN_MESSAGE, ...message }, {}, resolve);
        if (!handled) resolve(undefined);
    });
const clear = ids => send({ action: 'start', spaceId: 'home', tabIds: ids, order: [1, 2, 3, 4] });

beforeEach(() => {
    tabs = [1, 2, 3, 4].map(id => ({ id, mutedInfo: { muted: false } }));
    session = {};
    dispatched = [];
    clock = 1_000_000;
    timers = [];
    removeError = undefined;
    hideError = undefined;
});

test('Clean All hides the tabs, mutes them, and keeps them open', async () => {
    await start();
    const reply = await clear([1, 2, 3]);
    assert.equal(reply.success, true);
    assert.deepEqual(dispatched, [{ action: 'hide', tabIds: [1, 2, 3] }]);
    assert.deepEqual(
        tabs.map(t => [t.id, t.mutedInfo.muted]),
        [
            [1, true],
            [2, true],
            [3, true],
            [4, false]
        ]
    );
    await advance(UNDO_WINDOW_MS - 1);
    assert.deepEqual(
        tabs.map(t => t.id),
        [1, 2, 3, 4]
    );
});

test('the hidden tabs are closed when the Undo window ends', async () => {
    await start();
    await clear([1, 2]);
    await advance(DUE);
    assert.deepEqual(
        tabs.map(t => t.id),
        [3, 4]
    );
    assert.deepEqual(session[PENDING_CLEAN_KEY], []);
});

test('Undo shows the same tabs again with their sound as it was, and nothing closes later', async () => {
    await start();
    tabs[1].mutedInfo.muted = true; // muted by the user before Clean All
    const { batchId } = await clear([1, 2, 3]);
    const reply = await send({ action: 'undo', batchId });
    assert.deepEqual(reply.restored, [1, 2, 3]);
    assert.deepEqual(dispatched[1], { action: 'unhide', tabIds: [1, 2, 3], spaceId: 'home', order: [1, 2, 3, 4] });
    assert.deepEqual(
        tabs.map(t => t.mutedInfo.muted),
        [false, true, false, false]
    );
    await advance(DUE * 2);
    assert.equal(tabs.length, 4);
});

test('Undo after the tabs closed reports nothing restored, so the sidebar can reopen them', async () => {
    await start();
    const { batchId } = await clear([1, 2]);
    await advance(DUE);
    assert.deepEqual((await send({ action: 'undo', batchId })).restored, []);
});

test('a tab Chrome closed on its own is skipped by Undo and by the final close', async () => {
    await start();
    const { batchId } = await clear([1, 2, 3]);
    tabs = tabs.filter(t => t.id !== 2);
    assert.deepEqual((await send({ action: 'undo', batchId })).restored, [1, 3]);

    const second = await clear([1, 4]);
    tabs = tabs.filter(t => t.id !== 4);
    await advance(DUE);
    assert.deepEqual(
        tabs.map(t => t.id),
        [3]
    );
    assert.ok(second.batchId);
});

test('a second Clean All keeps the first one closing on its own schedule, and Undo answers only its own', async () => {
    await start();
    const first = await clear([1]);
    await advance(3000);
    const second = await clear([2, 3]);
    await advance(DUE - 3000);
    assert.deepEqual(
        tabs.map(t => t.id),
        [2, 3, 4]
    );
    const reply = await send({ action: 'undo', batchId: second.batchId });
    assert.deepEqual(reply.restored, [2, 3]);
    assert.deepEqual((await send({ action: 'undo', batchId: first.batchId })).restored, []);
    await advance(DUE);
    assert.deepEqual(
        tabs.map(t => t.id),
        [2, 3, 4]
    );
});

test('a worker that starts after the sidebar closed finishes the closes that are due and resumes the rest', async () => {
    await start();
    await clear([1]);
    await advance(2000);
    await clear([2]);
    const saved = structuredClone(session);

    // The worker stops; the next one starts once the first batch is due but the second is not.
    timers = [];
    session = saved;
    clock += DUE - 2000;
    await start();
    assert.deepEqual(
        tabs.map(t => t.id),
        [2, 3, 4]
    );
    await advance(2000);
    assert.deepEqual(
        tabs.map(t => t.id),
        [3, 4]
    );
});

test('a tab that cannot be closed comes back to the list instead of staying hidden', async () => {
    await start();
    await clear([1, 2]);
    removeError = new Error('Tabs cannot be edited right now (user may be dragging a tab).');
    await advance(DUE);
    assert.deepEqual(dispatched.at(-1), { action: 'unhide', tabIds: [1, 2], spaceId: 'home', order: [1, 2, 3, 4] });
    assert.equal(tabs.length, 4);
    // Their sound is back too: they are not left muted by Clean All.
    assert.deepEqual(
        tabs.map(t => t.mutedInfo.muted),
        [false, false, false, false]
    );
});

test('Clean All reports when the tabs will close, and a failed hide leaves nothing pending', async () => {
    await start();
    const { closeAt } = await clear([1]);
    assert.equal(closeAt, clock + DUE);

    hideError = new Error('storage is full');
    const reply = await send({ action: 'start', spaceId: 'home', tabIds: [2], order: [1, 2] });
    assert.equal(reply.success, false);
    assert.deepEqual(
        session[PENDING_CLEAN_KEY].map(batch => batch.tabs.map(tab => tab.tabId)),
        [[1]]
    );
});

test('messages for other features are left alone', async () => {
    await start();
    assert.equal(
        listener({ type: 'spaceStore', action: 'get' }, {}, () => {}),
        undefined
    );
    assert.equal(
        listener({ type: PENDING_CLEAN_MESSAGE, action: 'unknown' }, {}, () => {}),
        undefined
    );
});

test('a hidden tab pinned in the meantime is shown again with its sound, and only the others are closed', async () => {
    await start();
    await clear([1, 2, 3]);
    tabs[1].pinned = true;
    await advance(DUE);
    assert.deepEqual(
        tabs.map(t => t.id),
        [2, 4]
    );
    assert.deepEqual(dispatched.at(-1), { action: 'unhide', tabIds: [2], spaceId: 'home', order: [1, 2, 3, 4] });
    assert.equal(tabs[0].mutedInfo.muted, false);
});
