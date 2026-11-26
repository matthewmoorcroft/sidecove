// Turns what arc-sidebar.js read into the spaces to create: Sidecove's names, colours, icons
// and folder depth. Nothing here touches chrome.* or the DOM.
import { MAX_FOLDER_DEPTH } from '../../folder-policy.js';
import { SYMBOL_PREFIX, normalizeSpaceIcon, spaceSymbol } from '../../space-icons.js';
import { customChoice } from '../space-colors/space-palette.js';
import { sidecoveSymbolFor } from './arc-symbols.js';

export const FAVORITES_FOLDER_TITLE = 'Favorites from Arc';

// How an imported space records where it came from, so a second import can leave it out.
export const arcSource = space => `arc:${space?.id}`;
const UNTITLED_SPACE = 'Arc space';
const UNTITLED_FOLDER = 'Untitled folder';

function iconFor(icon) {
    if (icon?.emoji) return normalizeSpaceIcon(icon.emoji);
    if (icon?.symbol) {
        const name = sidecoveSymbolFor(icon.symbol);
        return name && spaceSymbol(SYMBOL_PREFIX + name) ? SYMBOL_PREFIX + name : null;
    }
    return null;
}

// Folders below the deepest level kept hand their tabs and folders to the folder above them.
function fitDepth(nodes, depth, totals, maxDepth) {
    const fitted = [];
    for (const node of nodes) {
        if (node.type === 'tab') {
            fitted.push({ title: node.title, url: node.url });
            totals.tabs++;
        } else if (depth >= maxDepth) {
            totals.flattenedFolders++;
            fitted.push(...fitDepth(node.children, depth, totals, maxDepth));
        } else {
            totals.folders++;
            fitted.push({
                title: node.title || UNTITLED_FOLDER,
                children: fitDepth(node.children, depth + 1, totals, maxDepth)
            });
        }
    }
    return fitted;
}

/**
 * The spaces to send to the service worker's 'importSpaces' action, and what the summary says.
 * `chosen` holds the indexes of the Arc spaces to import. Favorites go in a folder at the top of
 * the first chosen space, as Sidecove's top bar holds open tabs rather than saved pages.
 * `maxDepth` is how many folder levels to keep: one while tab group sync is on, as the sidebar
 * allows no folder inside a folder then. `earlier` is what earlier imports brought in (see
 * earlierImports in shared/import-spaces.js): those spaces, and favorites once imported, are left out.
 */
export function planArcImport(
    arc,
    chosen = arc.spaces.map((_, index) => index),
    { maxDepth = MAX_FOLDER_DEPTH, earlier = { sources: new Set(), favorites: false } } = {}
) {
    const picked = new Set(chosen.filter(index => !earlier.sources.has(arcSource(arc.spaces[index]))));
    const totals = {
        spaces: 0,
        tabs: 0,
        folders: 0,
        favorites: 0,
        splitViews: 0,
        flattenedFolders: 0,
        iconsLeftOut: 0,
        maxDepth
    };
    const skipped = { todayTabs: 0, arcPages: 0, other: 0, unreadable: 0 };
    const spaces = [];
    arc.spaces.forEach((space, index) => {
        if (!picked.has(index)) return;
        const icon = iconFor(space.icon);
        if (space.icon && !icon) totals.iconsLeftOut++;
        const choice = space.color ? customChoice(space.color) : null;
        const items = fitDepth(space.pinned, 0, totals, maxDepth);
        totals.splitViews += space.counts.splitViews;
        skipped.todayTabs += space.todayTabs;
        skipped.arcPages += space.counts.arcPages;
        skipped.other += space.counts.other;
        skipped.unreadable += space.counts.unreadable;
        spaces.push({
            name: space.name || UNTITLED_SPACE,
            color: choice?.color ?? 'grey',
            ...(choice?.shade ? { shade: choice.shade } : {}),
            ...(icon ? { icon } : {}),
            importedFrom: arcSource(space),
            items
        });
        totals.spaces++;
    });
    if (spaces.length && arc.favorites.length && !earlier.favorites) {
        spaces[0].items.unshift({
            favorites: true,
            title: FAVORITES_FOLDER_TITLE,
            children: arc.favorites.map(({ title, url }) => ({ title, url }))
        });
        totals.favorites = arc.favorites.length;
        totals.folders++;
    }
    if (spaces.length) {
        skipped.arcPages += arc.favoriteCounts.arcPages;
        skipped.other += arc.favoriteCounts.other;
        skipped.unreadable += arc.favoriteCounts.unreadable;
    }
    return { plan: { source: 'Arc', spaces }, totals, skipped };
}
