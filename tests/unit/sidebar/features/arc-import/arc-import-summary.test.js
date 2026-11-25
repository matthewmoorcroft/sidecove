import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeArcSpace, describeImport } from '../../../../../src/sidebar/features/arc-import/arc-import-summary.js';

const totals = { spaces: 1, tabs: 1, folders: 0, favorites: 0, splitViews: 0, flattenedFolders: 0, iconsLeftOut: 0 };
const skipped = { todayTabs: 0, arcPages: 0, other: 0 };

test('a space is described by its pinned tabs and folders', () => {
    assert.equal(describeArcSpace({ counts: { tabs: 1, folders: 0 } }), '1 pinned tab');
    assert.equal(describeArcSpace({ counts: { tabs: 12, folders: 3 } }), '12 pinned tabs, 3 folders');
});

test('the summary says what was imported, with nothing left out', () => {
    assert.deepEqual(describeImport({ totals, skipped }), {
        imported: 'Imported 1 space with 1 pinned tab.',
        notes: [],
        leftOut: []
    });
});

test('the summary names each kind of thing moved or left out', () => {
    const summary = describeImport({
        totals: {
            ...totals,
            spaces: 2,
            tabs: 9,
            folders: 3,
            favorites: 1,
            splitViews: 2,
            flattenedFolders: 1,
            iconsLeftOut: 1
        },
        skipped: { todayTabs: 4, arcPages: 1, other: 2 }
    });
    assert.equal(
        summary.imported,
        'Imported 2 spaces with 9 pinned tabs and 3 folders. 1 favorite is in the folder “Favorites from Arc”.'
    );
    assert.equal(summary.notes.length, 2);
    assert.match(summary.notes[0], /^2 split views became separate pinned tabs/);
    assert.match(summary.notes[1], /^1 folder more than four levels deep/);
    assert.equal(summary.leftOut.length, 4);
    assert.match(summary.leftOut[0], /^4 today tabs/);
    assert.match(summary.leftOut[1], /^1 page only Arc can open/);
    assert.match(summary.leftOut[2], /^2 items Sidecove has no place for/);
    assert.match(summary.leftOut[3], /^1 space icon with no match/);
});
