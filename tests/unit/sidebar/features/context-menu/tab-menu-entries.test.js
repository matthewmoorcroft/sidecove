import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MENU_GROUPS,
    MENU_ITEMS,
    MENU_KINDS,
    tabMenuEntries,
    tabMenuGroups
} from '../../../../../src/sidebar/features/context-menu/tab-menu-entries.js';

const noop = () => {};
const everyAction = {
    copyLink: noop,
    rename: noop,
    setMuted: noop,
    replaceUrl: noop,
    addToFavorites: noop,
    togglePin: noop,
    duplicate: noop,
    close: noop,
    archive: noop,
    removeBookmark: noop
};
const splitEntries = [{ label: 'Split View with…', submenu: [{ label: 'New Tab', action: noop }] }];
const moveEntries = [{ label: 'Work', action: noop }];

const menu = (kind, options = {}) =>
    tabMenuGroups({ kind, splitEntries, moveEntries, actions: everyAction, ...options });
const ids = groups => groups.flatMap(({ entries }) => entries.map(entry => entry.id));

test('every kind of menu lists its groups in the one standard order', () => {
    for (const kind of Object.keys(MENU_KINDS)) {
        const groups = menu(kind).map(({ group }) => group);
        const expected = MENU_GROUPS.filter(group => groups.includes(group));
        assert.deepEqual(groups, expected, kind);
    }
});

test('every kind of menu lists its items in the standard order, none out of place', () => {
    const standard = MENU_GROUPS.flatMap(group => MENU_ITEMS[group]);
    for (const kind of Object.keys(MENU_KINDS)) {
        const listed = [...new Set(ids(menu(kind)))];
        assert.deepEqual(
            listed,
            standard.filter(id => listed.includes(id)),
            kind
        );
        assert.deepEqual(
            listed,
            standard.filter(id => MENU_KINDS[kind].includes(id)),
            `${kind} offers every item it can`
        );
    }
});

test('an item has the same label in every menu that offers it', () => {
    const labelsById = new Map();
    for (const kind of Object.keys(MENU_KINDS)) {
        for (const { entries } of menu(kind)) {
            for (const entry of entries) {
                if (labelsById.has(entry.id)) assert.equal(entry.label, labelsById.get(entry.id), entry.id);
                labelsById.set(entry.id, entry.label);
            }
        }
    }
});

test('the three row types read the same, apart from what a type cannot do', () => {
    const labels = kind => tabMenuEntries({ kind, splitEntries, moveEntries, actions: everyAction });
    const text = kind => labels(kind).map(entry => (entry === 'separator' ? '-' : entry.label));
    assert.deepEqual(text('tab'), [
        'Copy Link',
        '-',
        'Rename Tab',
        'Mute Tab',
        '-',
        'Add to Favorites',
        'Pin Tab',
        'Split View with…',
        'Duplicate Tab',
        'Move to Space',
        '-',
        'Close Tab',
        'Archive Tab'
    ]);
    assert.deepEqual(text('pinned'), [
        'Copy Link',
        '-',
        'Rename Tab',
        'Mute Tab',
        'Replace Bookmark URL with Current URL',
        '-',
        'Add to Favorites',
        'Duplicate Tab',
        'Move to Space',
        '-',
        'Close Tab',
        'Archive Tab',
        'Unpin Tab'
    ]);
    assert.deepEqual(text('saved'), ['Copy Link', '-', 'Move to Space', '-', 'Remove Bookmark']);
    assert.deepEqual(text('otherWindow'), [
        'Copy Link',
        '-',
        'Rename Tab',
        'Mute Tab',
        '-',
        'Move to Space',
        '-',
        'Close Tab'
    ]);
});

test('Close Tab is offered wherever there is an open tab, pinned tabs included', () => {
    for (const kind of ['tab', 'pinned', 'otherWindow']) assert.ok(ids(menu(kind)).includes('close'), kind);
    assert.equal(ids(menu('saved')).includes('close'), false);
});

test('a pinned tab closes through the same Close Tab as any other and does not unpin it', () => {
    const calls = [];
    const actions = { ...everyAction, close: () => calls.push('close'), togglePin: () => calls.push('togglePin') };
    const entries = tabMenuEntries({ kind: 'pinned', moveEntries, actions });
    entries.find(entry => entry.label === 'Close Tab').action();
    assert.deepEqual(calls, ['close']);
});

test('Mute Tab follows the live state', () => {
    const entry = muted =>
        menu('tab', { muted })
            .flatMap(({ entries }) => entries)
            .find(item => item.id === 'mute');
    assert.equal(entry(false).label, 'Mute Tab');
    assert.equal(entry(true).label, 'Unmute Tab');
    const calls = [];
    menu('tab', { muted: true, actions: { ...everyAction, setMuted: value => calls.push(value) } })
        .flatMap(({ entries }) => entries)
        .find(item => item.id === 'mute')
        .action();
    assert.deepEqual(calls, [false]);
});

test('an item with nothing to do is left out, and so is a group left empty', () => {
    const actions = { copyLink: noop, close: noop };
    const groups = tabMenuGroups({ kind: 'tab', actions });
    assert.deepEqual(
        groups.map(({ group }) => group),
        ['link', 'close']
    );
    assert.deepEqual(tabMenuEntries({ kind: 'tab', actions }).length, 3);
});

test('split view is only offered to ordinary tabs', () => {
    assert.ok(ids(menu('tab')).includes('split'));
    for (const kind of ['pinned', 'saved', 'otherWindow']) assert.equal(ids(menu(kind)).includes('split'), false, kind);
});
