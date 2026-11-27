import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveWriter, registerArchive } from '../../../src/background/archive-writer.js';
import { ARCHIVE_MESSAGE } from '../../../src/shared/archive-client.js';

let local, tabs, removed, created, dispatched, spaces, holdWrites, listener;
const urls = () => (local.archivedTabs || []).map(t => [t.url, t.spaceId]);

beforeEach(() => {
    local = {};
    removed = [];
    created = [];
    dispatched = [];
    holdWrites = null;
    spaces = [
        { id: 'a', spaceBookmarks: [], temporaryTabs: [1], pinnedTabs: [] },
        { id: 'b', spaceBookmarks: [], temporaryTabs: [2], pinnedTabs: [] }
    ];
    tabs = [
        { id: 1, url: 'https://one.test/', title: 'One' },
        { id: 2, url: 'https://two.test/', title: 'Two' }
    ];
});

const chromeApi = () => ({
    storage: {
        local: {
            get: async key => ({ [key]: structuredClone(local[key]) }),
            // A test can hold every write until it lets them go, to line up two changes.
            set: async values => {
                const snapshot = structuredClone(values);
                if (holdWrites) await holdWrites;
                Object.assign(local, snapshot);
            }
        }
    },
    tabs: {
        get: async id => structuredClone(tabs.find(t => t.id === id)),
        remove: async id => removed.push(id),
        create: async props => {
            const tab = { id: 100 + created.length, ...props };
            created.push(props);
            return tab;
        }
    },
    runtime: { onMessage: { addListener: fn => (listener = fn) } }
});
const spaceStore = () => ({
    run: async operation => operation(),
    dispatch: async message => {
        dispatched.push(message);
        return structuredClone(spaces);
    }
});
const writer = () => createArchiveWriter({ chromeApi: chromeApi(), spaceStore: spaceStore(), now: () => 1000 });
const held = () => {
    let release;
    holdWrites = new Promise(resolve => (release = resolve));
    return release;
};

test('two archives at the same moment both stay in Archived', async () => {
    const archive = writer();
    const release = held();
    const first = archive.add({ url: 'https://one.test/', name: 'One', spaceId: 'a' });
    const second = archive.add({ url: 'https://two.test/', name: 'Two', spaceId: 'b' });
    release();
    assert.deepEqual(
        (await Promise.all([first, second])).map(r => r.stored),
        [true, true]
    );
    assert.deepEqual(urls().sort(), [
        ['https://one.test/', 'a'],
        ['https://two.test/', 'b']
    ]);
});

test('an archive racing a removal neither brings the removed entry back nor loses the new one', async () => {
    local.archivedTabs = [{ url: 'https://old.test/', name: 'Old', spaceId: 'a', archivedAt: 1 }];
    const archive = writer();
    const release = held();
    const removal = archive.remove('https://old.test/', 'a');
    const addition = archive.add({ url: 'https://new.test/', name: 'New', spaceId: 'a' });
    release();
    await Promise.all([removal, addition]);
    assert.deepEqual(urls(), [['https://new.test/', 'a']]);
});

test('each change reads the stored list, so a worker that started again keeps what is there', async () => {
    local.archivedTabs = [{ url: 'https://before.test/', name: 'Before', spaceId: 'a', archivedAt: 1 }];
    await writer().add({ url: 'https://after.test/', name: 'After', spaceId: 'b' });
    assert.deepEqual(urls(), [
        ['https://after.test/', 'b'],
        ['https://before.test/', 'a']
    ]);
});

test('the archive keeps the newest 100 entries', async () => {
    local.archivedTabs = Array.from({ length: 100 }, (_, i) => ({
        url: `https://old${i}.test/`,
        name: 'Old',
        spaceId: 'a',
        archivedAt: 100 - i
    }));
    const { tabs: list } = await writer().add({ url: 'https://new.test/', name: 'New', spaceId: 'a' });
    assert.equal(local.archivedTabs.length, 100);
    assert.equal(local.archivedTabs[0].url, 'https://new.test/');
    assert.equal(local.archivedTabs.at(-1).url, 'https://old98.test/');
    assert.deepEqual(list, local.archivedTabs);
});

test('the same page archived from two spaces gives each space its own entry to restore', async () => {
    const archive = writer();
    const home = await archive.add({ url: 'https://same.test/', name: 'Same', spaceId: 'a' });
    const work = await archive.add({ url: 'https://same.test/', name: 'Same', spaceId: 'b' });
    assert.deepEqual([home.stored, home.archived, work.stored, work.archived], [true, true, true, true]);
    assert.deepEqual(urls().sort(), [
        ['https://same.test/', 'a'],
        ['https://same.test/', 'b']
    ]);
    // Restoring one space's entry leaves the other's.
    await archive.restore({ url: 'https://same.test/', spaceId: 'b' }, 1);
    assert.equal(dispatched.at(-1).spaceId, 'b');
    assert.deepEqual(urls(), [['https://same.test/', 'a']]);
});

test('a page archived again from the same space keeps one entry, which still counts as archived', async () => {
    const archive = writer();
    await archive.add({ url: 'https://same.test/', name: 'Same', spaceId: 'a' });
    const again = await archive.add({ url: 'https://same.test/', name: 'Same', spaceId: 'a' });
    assert.deepEqual([again.stored, again.archived], [false, true]);
    assert.equal(local.archivedTabs.length, 1);
});

test('Archive Tab keeps a page from a second space and closes its tab', async () => {
    local.archivedTabs = [{ url: 'https://same.test/', name: 'Same', spaceId: 'a', archivedAt: 1 }];
    tabs[1].url = 'https://same.test/';
    await writer().archiveTab(2);
    assert.deepEqual(urls().sort(), [
        ['https://same.test/', 'a'],
        ['https://same.test/', 'b']
    ]);
    assert.deepEqual(removed, [2]);
});

test('Archive Tab keeps an untitled tab under its address, and leaves open a tab Archived cannot keep', async () => {
    tabs[0].title = '';
    tabs[1].url = '';
    const archive = writer();
    await archive.archiveTab(1);
    assert.deepEqual(local.archivedTabs[0].name, 'https://one.test/');
    await archive.archiveTab(2);
    assert.deepEqual(urls(), [['https://one.test/', 'a']]);
    assert.deepEqual(removed, [1]);
});

test('manual archive records the stored owner and closes the tab', async () => {
    await writer().archiveTab(2);
    assert.deepEqual(urls(), [['https://two.test/', 'b']]);
    assert.equal(local.archivedTabs[0].name, 'Two');
    assert.deepEqual(removed, [2]);
});

test('a tab no space lists is neither archived nor closed', async () => {
    tabs.push({ id: 3, url: 'https://three.test/', title: 'Three' });
    await writer().archiveTab(3);
    assert.deepEqual(urls(), []);
    assert.deepEqual(removed, []);
});

test('restore opens the page in the given window and space and takes it out of Archived', async () => {
    local.archivedTabs = [
        { url: 'https://one.test/', name: 'One', spaceId: 'a', archivedAt: 2 },
        { url: 'https://two.test/', name: 'Two', spaceId: 'b', archivedAt: 1 }
    ];
    const { tab, tabs: list } = await writer().restore({ url: 'https://one.test/', spaceId: 'a' }, 7);
    assert.deepEqual(created, [{ url: 'https://one.test/', active: true, windowId: 7 }]);
    assert.deepEqual(dispatched.at(-1), { action: 'assign', tabId: tab.id, spaceId: 'a' });
    assert.deepEqual(urls(), [['https://two.test/', 'b']]);
    assert.deepEqual(list, local.archivedTabs);
});

test('the panels change the archive by message, and other messages are left alone', async () => {
    registerArchive({ chromeApi: chromeApi(), spaceStore: spaceStore() });
    const send = message =>
        new Promise(resolve => {
            if (listener(message, {}, resolve) !== true) resolve('not handled');
        });
    assert.equal(await send({ type: 'spaceStore', action: 'get' }), 'not handled');
    assert.equal(await send({ type: ARCHIVE_MESSAGE, action: 'unknown' }), 'not handled');
    const reply = await send({
        type: ARCHIVE_MESSAGE,
        action: 'add',
        entry: { url: 'https://one.test/', name: 'One', spaceId: 'a' }
    });
    assert.equal(reply.success, true);
    assert.equal(reply.stored, true);
    assert.deepEqual(
        reply.tabs.map(t => t.url),
        ['https://one.test/']
    );
    const removal = await send({ type: ARCHIVE_MESSAGE, action: 'remove', url: 'https://one.test/', spaceId: 'a' });
    assert.deepEqual(removal, { success: true, tabs: [] });
});
