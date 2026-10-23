import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveAndCloseTabs, reopenClosedTabs } from '../../clean-all.js';

function fakes() {
    const calls = [];
    const archive = new Set(['https://already.example/']);
    let nextId = 100;
    return {
        calls,
        archive,
        api: {
            addArchivedTab: async entry => {
                calls.push(['archive', entry.url, entry.name, entry.spaceId]);
                if (archive.has(entry.url)) return false;
                archive.add(entry.url);
                return true;
            },
            removeTabs: async ids => calls.push(['remove', ids]),
            createTab: async props => { calls.push(['create', props]); return { id: nextId++ }; },
            assignTab: async (tabId, spaceId) => calls.push(['assign', tabId, spaceId]),
            removeArchivedTab: async (url, spaceId) => { calls.push(['unarchive', url, spaceId]); archive.delete(url); }
        }
    };
}

const tabs = [
    { id: 1, url: 'https://a.example/', title: 'A' },
    { id: 2, url: 'https://already.example/', title: '' },
    { id: 3, url: 'https://c.example/', title: 'C' }
];

test('Clean All archives every closed tab before closing them together', async () => {
    const { calls, api } = fakes();
    const records = await archiveAndCloseTabs(tabs, 'home', api);
    assert.deepEqual(calls, [
        ['archive', 'https://a.example/', 'A', 'home'],
        ['archive', 'https://already.example/', 'https://already.example/', 'home'],
        ['archive', 'https://c.example/', 'C', 'home'],
        ['remove', [1, 2, 3]]
    ]);
    assert.deepEqual(records.map(r => [r.url, r.addedToArchive]), [
        ['https://a.example/', true], ['https://already.example/', false], ['https://c.example/', true]
    ]);
});

test('Clean All with nothing to close does nothing', async () => {
    const { calls, api } = fakes();
    assert.deepEqual(await archiveAndCloseTabs([], 'home', api), []);
    assert.deepEqual(calls, []);
});

test('Undo reopens the tabs in order in their space and clears only the archive entries Clean All added', async () => {
    const { calls, api, archive } = fakes();
    const records = await archiveAndCloseTabs(tabs, 'home', api);
    calls.length = 0;
    const reopened = await reopenClosedTabs(records, 7, api);
    assert.deepEqual(reopened, [100, 101, 102]);
    assert.deepEqual(calls, [
        ['create', { url: 'https://a.example/', active: false, windowId: 7 }],
        ['assign', 100, 'home'],
        ['unarchive', 'https://a.example/', 'home'],
        ['create', { url: 'https://already.example/', active: false, windowId: 7 }],
        ['assign', 101, 'home'],
        ['create', { url: 'https://c.example/', active: false, windowId: 7 }],
        ['assign', 102, 'home'],
        ['unarchive', 'https://c.example/', 'home']
    ]);
    // An entry archived before Clean All stays in the archive.
    assert.deepEqual([...archive], ['https://already.example/']);
});
