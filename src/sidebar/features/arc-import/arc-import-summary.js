// What the Arc import panel says about a space and about the finished import. Plain text only.
import { FAVORITES_FOLDER_TITLE } from './arc-import-plan.js';

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "12 pinned tabs, 3 folders" for one space as read from Arc.
export function describeArcSpace(space) {
    const parts = [count(space.counts.tabs, 'pinned tab')];
    if (space.counts.folders) parts.push(count(space.counts.folders, 'folder'));
    return parts.join(', ');
}

// The sentence saying what was imported, and one line for each kind of thing that was not.
export function describeImport({ totals, skipped }) {
    let imported = `Imported ${count(totals.spaces, 'space')} with ${count(totals.tabs, 'pinned tab')}`;
    imported += totals.folders ? ` and ${count(totals.folders, 'folder')}.` : '.';
    if (totals.favorites)
        imported += ` ${count(totals.favorites, 'favorite')} ${totals.favorites === 1 ? 'is' : 'are'} in the folder “${FAVORITES_FOLDER_TITLE}”.`;
    const notes = [];
    if (totals.splitViews)
        notes.push(`${count(totals.splitViews, 'split view')} became separate pinned tabs, side by side in the list.`);
    if (totals.flattenedFolders)
        notes.push(
            `${count(totals.flattenedFolders, 'folder')} more than four levels deep went into the folder above, with everything in them.`
        );
    const leftOut = [];
    if (skipped.todayTabs)
        leftOut.push(`${count(skipped.todayTabs, 'today tab')}, which Arc keeps open rather than saved`);
    if (skipped.arcPages)
        leftOut.push(`${count(skipped.arcPages, 'page')} only Arc can open, such as its own arc:// pages`);
    if (skipped.other)
        leftOut.push(`${count(skipped.other, 'item')} Sidecove has no place for, such as notes and easels`);
    if (totals.iconsLeftOut)
        leftOut.push(
            `${count(totals.iconsLeftOut, 'space icon')} with no match in Sidecove; you can choose one with Change Icon`
        );
    return { imported, notes, leftOut };
}
