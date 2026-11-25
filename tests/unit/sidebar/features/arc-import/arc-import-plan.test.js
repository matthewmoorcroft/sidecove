import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readArcSidebar } from '../../../../../src/sidebar/features/arc-import/arc-sidebar.js';
import {
    FAVORITES_FOLDER_TITLE,
    planArcImport
} from '../../../../../src/sidebar/features/arc-import/arc-import-plan.js';
import { MAX_FOLDER_DEPTH } from '../../../../../src/sidebar/folder-policy.js';

const arc = () =>
    readArcSidebar(readFileSync(new URL('../../../../e2e/fixtures/arc/StorableSidebar.json', import.meta.url), 'utf8'));

const depthOf = items => Math.max(0, ...items.filter(item => item.children).map(item => 1 + depthOf(item.children)));

test('every space becomes a new space with its colour and icon', () => {
    const { plan, totals } = planArcImport(arc());
    assert.equal(plan.source, 'Arc');
    assert.deepEqual(
        plan.spaces.map(s => [s.name, s.icon ?? null]),
        [
            ['Work', 'symbol:briefcase'],
            ['Personal', '🏠'],
            ['Ideas', null]
        ]
    );
    // Arc's tint, as a custom colour with the nearest Chrome colour for tab groups.
    assert.deepEqual([plan.spaces[0].color, plan.spaces[0].shade], ['blue', '#5c8ce6']);
    assert.equal(plan.spaces[1].shade, undefined);
    assert.equal(totals.iconsLeftOut, 1);
});

test('folders deeper than Sidecove allows hand their tabs to the folder above', () => {
    const { plan, totals } = planArcImport(arc());
    const work = plan.spaces[0].items;
    assert.equal(depthOf(work), MAX_FOLDER_DEPTH);
    assert.equal(totals.flattenedFolders, 1);
    let folder = work.find(item => item.title === 'Projects');
    while (folder.children.some(item => item.children)) folder = folder.children.find(item => item.children);
    assert.deepEqual(folder.children, [{ title: 'Deep page', url: 'https://example.com/deep' }]);
});

test('favorites go in a folder at the top of the first chosen space', () => {
    const { plan, totals } = planArcImport(arc(), [1, 2]);
    assert.deepEqual(
        plan.spaces.map(s => s.name),
        ['Personal', 'Ideas']
    );
    const [first] = plan.spaces[0].items;
    assert.equal(first.title, FAVORITES_FOLDER_TITLE);
    assert.deepEqual(
        first.children.map(c => c.url),
        ['https://example.net/mail', 'https://example.net/calendar']
    );
    assert.equal(totals.favorites, 2);
});

test('counts what is imported and what is left out for the chosen spaces only', () => {
    const all = planArcImport(arc());
    assert.deepEqual(all.totals, {
        spaces: 3,
        tabs: 6,
        folders: 6,
        favorites: 2,
        splitViews: 1,
        flattenedFolders: 1,
        iconsLeftOut: 1,
        maxDepth: MAX_FOLDER_DEPTH
    });
    assert.deepEqual(all.skipped, { todayTabs: 2, arcPages: 1, other: 1, unreadable: 0 });
    const personal = planArcImport(arc(), [1]);
    assert.deepEqual(personal.skipped, { todayTabs: 0, arcPages: 0, other: 0, unreadable: 0 });
    assert.equal(personal.totals.tabs, 1);
});

test('choosing no spaces plans nothing', () => {
    const { plan, totals } = planArcImport(arc(), []);
    assert.deepEqual(plan.spaces, []);
    assert.equal(totals.favorites, 0);
});

test('with one folder level kept, as with tab group sync on, nested folders join their top folder', () => {
    const { plan, totals } = planArcImport(arc(), [0], { maxDepth: 1 });
    const work = plan.spaces[0].items;
    assert.equal(depthOf(work), 1);
    assert.equal(totals.flattenedFolders, 4);
    const projects = work.find(item => item.title === 'Projects');
    assert.deepEqual(
        projects.children.map(c => c.title),
        ['My project', 'Deep page']
    );
});
