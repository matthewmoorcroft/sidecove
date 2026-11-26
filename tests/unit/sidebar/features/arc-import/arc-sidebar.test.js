import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NotArcFileError, readArcSidebar } from '../../../../../src/sidebar/features/arc-import/arc-sidebar.js';

// A made-up file with the structure Arc writes (see tests/e2e/fixtures/arc/).
const fixtureText = readFileSync(new URL('../../../../e2e/fixtures/arc/StorableSidebar.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(fixtureText);

test('reads spaces in Arc order with names, icons and colours', () => {
    const arc = readArcSidebar(fixtureText);
    assert.deepEqual(
        arc.spaces.map(s => s.name),
        ['Work', 'Personal', 'Ideas']
    );
    assert.deepEqual(arc.spaces[0].icon, { symbol: 'briefcase.fill' });
    // Arc's own space ids, so a later import can tell what it brought in before.
    const ids = fixture().sidebar.containers[1].spaces.filter(entry => typeof entry === 'string');
    assert.deepEqual(
        arc.spaces.map(s => s.id),
        ids
    );
    assert.deepEqual(arc.spaces[1].icon, { emoji: '🏠' });
    assert.equal(arc.spaces[0].color, '#5c8ce6');
    assert.equal(arc.spaces[1].color, null);
});

test('keeps pinned tabs and nested folders in order, with custom titles first', () => {
    const [work] = readArcSidebar(fixtureText).spaces;
    assert.deepEqual(work.pinned[0], { type: 'tab', title: 'Example docs', url: 'https://example.com/docs' });
    const projects = work.pinned[1];
    assert.equal(projects.type, 'folder');
    assert.equal(projects.title, 'Projects');
    assert.equal(projects.children[0].title, 'My project');
    let depth = 1;
    for (let node = projects; node.children.some(c => c.type === 'folder'); depth++)
        node = node.children.find(c => c.type === 'folder');
    assert.equal(depth, 5);
});

test('a split view becomes its tabs; Arc pages, unknown items and today tabs are counted', () => {
    const [work] = readArcSidebar(fixtureText).spaces;
    assert.deepEqual(
        work.pinned.slice(2).map(n => n.url),
        ['https://example.com/left', 'https://example.com/right']
    );
    assert.deepEqual(work.counts, { tabs: 5, folders: 5, splitViews: 1, arcPages: 1, other: 1, unreadable: 0 });
    assert.equal(work.todayTabs, 2);
});

test('reads favorites from the top apps container', () => {
    const arc = readArcSidebar(fixtureText);
    assert.deepEqual(
        arc.favorites.map(f => f.url),
        ['https://example.net/mail', 'https://example.net/calendar']
    );
});

test('a numeric emoji code is read as the emoji', () => {
    const file = fixture();
    const personal = file.sidebar.containers[1].spaces[3];
    personal.customInfo.iconType = { emoji: 0x1f680 };
    assert.deepEqual(readArcSidebar(JSON.stringify(file)).spaces[1].icon, { emoji: '🚀' });
});

test('falls back to the sync copy when the sidebar copy is missing', () => {
    const file = fixture();
    const { items, spaces } = file.sidebar.containers[1];
    const wrap = list => list.map(entry => (typeof entry === 'string' ? entry : { value: entry }));
    const ids = spaces.filter(s => typeof s === 'string');
    delete file.sidebar;
    file.firebaseSyncState = {
        syncData: {
            items: wrap(items),
            spaceModels: wrap(spaces),
            orderedSpaceIDs: { value: [ids[2], ids[0], ids[1]] }
        }
    };
    assert.deepEqual(
        readArcSidebar(JSON.stringify(file)).spaces.map(s => s.name),
        ['Ideas', 'Work', 'Personal']
    );
});

test('a missing child is counted as unreadable, and a loop is not followed', () => {
    const file = fixture();
    const { items } = file.sidebar.containers[1];
    const projects = items.find(i => i?.title === 'Projects');
    projects.childrenIds.push('no-such-item', projects.id);
    const [work] = readArcSidebar(JSON.stringify(file)).spaces;
    assert.equal(work.counts.unreadable, 1);
    assert.equal(work.counts.other, 1);
    assert.equal(work.counts.folders, 5);
});

test('anything that is not Arc sidebar file is refused before reading any of it', () => {
    for (const text of ['', 'not json', '[]', '{}', JSON.stringify({ sidebar: { containers: [{ global: {} }] } })])
        assert.throws(() => readArcSidebar(text), NotArcFileError);
    const empty = fixture();
    empty.sidebar.containers[1].spaces = [];
    assert.throws(() => readArcSidebar(JSON.stringify(empty)), NotArcFileError);
});

test('scripts and other non-web addresses are never kept', () => {
    const file = fixture();
    const docs = file.sidebar.containers[1].items.find(i => i?.data?.tab?.savedURL === 'https://example.com/docs');
    docs.data.tab.savedURL = 'javascript:alert(1)';
    const project = file.sidebar.containers[1].items.find(i => i?.title === 'My project');
    project.data.tab.savedURL = 'https://[not-an-address';
    const [work] = readArcSidebar(JSON.stringify(file)).spaces;
    assert.equal(work.pinned[0].title, 'Projects');
    assert.equal(work.pinned[0].children[0].title, 'Level 2');
    assert.equal(work.counts.arcPages, 3);
});

test('tabs Arc hangs under a tab follow it', () => {
    const file = fixture();
    const { items } = file.sidebar.containers[1];
    const home = items.find(i => i?.data?.tab?.savedURL === 'https://example.org/');
    const child = { ...home, id: 'child-tab', parentID: home.id, title: null, childrenIds: [] };
    child.data = { tab: { savedURL: 'https://example.org/child', savedTitle: 'Child' } };
    items.push(child.id, child);
    home.childrenIds = [child.id];
    const personal = readArcSidebar(JSON.stringify(file)).spaces[1];
    assert.deepEqual(
        personal.pinned.map(n => n.url),
        ['https://example.org/', 'https://example.org/child']
    );
});
