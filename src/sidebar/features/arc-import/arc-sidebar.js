/**
 * Reads Arc's sidebar file, StorableSidebar.json, into plain spaces, pinned tabs and folders.
 *
 * Arc does not document this file. This follows the shape Arc 1.x writes and skips, and counts,
 * anything it does not recognise, so an unfamiliar record never stops the rest from importing.
 * Nothing here touches chrome.* or the DOM.
 */
import { isSavableUrl } from '../../../shared/import-spaces.js';

export class NotArcFileError extends Error {
    constructor() {
        super("This file is not Arc's sidebar file.");
        this.name = 'NotArcFileError';
    }
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value.trim() : '');

// Arc writes its lists as [id, record, id, record, ...]; each record also carries its own id.
function records(list, unwrap = record => record) {
    const byId = new Map();
    const order = [];
    for (const entry of Array.isArray(list) ? list : []) {
        const record = unwrap(entry);
        if (!isObject(record) || typeof record.id !== 'string') continue;
        if (!byId.has(record.id)) order.push(record.id);
        byId.set(record.id, record);
    }
    return { byId, order };
}

// The sidebar's own copy first; the sync copy, which wraps each record in { value }, otherwise.
function findSource(file) {
    const containers = file?.sidebar?.containers;
    const container = Array.isArray(containers)
        ? containers.find(c => isObject(c) && Array.isArray(c.spaces) && Array.isArray(c.items))
        : null;
    if (container) return { spaces: records(container.spaces), items: records(container.items) };
    const sync = file?.firebaseSyncState?.syncData;
    if (!isObject(sync) || !Array.isArray(sync.spaceModels) || !Array.isArray(sync.items)) return null;
    const unwrap = entry => (isObject(entry?.value) ? entry.value : null);
    const spaces = records(sync.spaceModels, unwrap);
    const ordered = Array.isArray(sync.orderedSpaceIDs?.value) ? sync.orderedSpaceIDs.value : [];
    spaces.order = [...ordered.filter(id => spaces.byId.has(id)), ...spaces.order.filter(id => !ordered.includes(id))];
    return { spaces, items: records(sync.items, unwrap) };
}

// A container list is [kind, id, kind, id]; the kind is a string ("pinned") or a one-key object
// ({ pinned: {} }).
function containerIds(space) {
    const found = {};
    for (const list of [space.containerIDs, space.newContainerIDs]) {
        if (!Array.isArray(list)) continue;
        for (let i = 0; i + 1 < list.length; i += 2) {
            const kind = typeof list[i] === 'string' ? list[i] : isObject(list[i]) ? Object.keys(list[i])[0] : null;
            if ((kind === 'pinned' || kind === 'unpinned') && typeof list[i + 1] === 'string')
                found[kind] ||= list[i + 1];
        }
    }
    return found;
}

function spaceIcon(space) {
    const icon = space.customInfo?.iconType;
    if (!isObject(icon)) return null;
    if (text(icon.emoji_v2)) return { emoji: text(icon.emoji_v2) };
    if (Number.isInteger(icon.emoji) && icon.emoji > 0 && icon.emoji <= 0x10ffff)
        return { emoji: String.fromCodePoint(icon.emoji) };
    if (text(icon.emoji)) return { emoji: text(icon.emoji) };
    if (text(icon.icon)) return { symbol: text(icon.icon) };
    return null;
}

const channel = value => Math.round(Math.min(1, Math.max(0, Number(value))) * 255);

// The theme's mid tone, the colour Arc tints the space with, as #rrggbb.
function spaceColor(space) {
    const tone = space.customInfo?.windowTheme?.primaryColorPalette?.midTone;
    if (!isObject(tone) || ![tone.red, tone.green, tone.blue].every(Number.isFinite)) return null;
    return '#' + [tone.red, tone.green, tone.blue].map(v => channel(v).toString(16).padStart(2, '0')).join('');
}

function newCounts() {
    return { tabs: 0, folders: 0, splitViews: 0, arcPages: 0, other: 0, unreadable: 0 };
}

// The pinned tabs and folders under a container, in Arc's order. Split views become their tabs.
function readChildren(items, ids, counts, seen) {
    const nodes = [];
    for (const id of Array.isArray(ids) ? ids : []) {
        if (seen.has(id)) continue;
        const item = items.byId.get(id);
        if (!item || !isObject(item.data)) {
            counts.unreadable++;
            continue;
        }
        seen.add(id);
        const { tab, list, splitView } = item.data;
        if (isObject(tab)) {
            const url = text(tab.savedURL);
            if (isSavableUrl(url)) {
                nodes.push({ type: 'tab', title: text(item.title) || text(tab.savedTitle) || url, url });
                counts.tabs++;
            } else counts.arcPages++;
            // Arc can hang tabs under a tab; they follow it, as Sidecove has no tabs inside tabs.
            nodes.push(...readChildren(items, item.childrenIds, counts, seen));
        } else if (isObject(list)) {
            counts.folders++;
            nodes.push({
                type: 'folder',
                title: text(item.title),
                children: readChildren(items, item.childrenIds, counts, seen)
            });
        } else if (isObject(splitView)) {
            counts.splitViews++;
            nodes.push(...readChildren(items, item.childrenIds, counts, seen));
        } else counts.other++;
    }
    return nodes;
}

// Favorites live in "top apps" containers, one per Arc profile; a page in two of them is kept once.
function readFavorites(items, counts) {
    const favorites = [];
    const urls = new Set();
    for (const id of items.order) {
        const item = items.byId.get(id);
        if (!isObject(item.data?.itemContainer?.containerType?.topApps)) continue;
        for (const node of readChildren(items, item.childrenIds, counts, new Set())) {
            const tabs = node.type === 'tab' ? [node] : flattenTabs(node.children);
            for (const tab of tabs)
                if (!urls.has(tab.url)) {
                    urls.add(tab.url);
                    favorites.push(tab);
                }
        }
    }
    return favorites;
}

const flattenTabs = nodes => nodes.flatMap(node => (node.type === 'tab' ? [node] : flattenTabs(node.children)));

/**
 * Parses the text of StorableSidebar.json. Returns
 *   { spaces: [{ id, name, icon, color, pinned, counts, todayTabs }], favorites: [{ title, url }],
 *     favoriteCounts }
 * where `pinned` is a tree of { type: 'tab', title, url } and { type: 'folder', title, children },
 * `icon` is { emoji } or { symbol } (Arc's symbol name) or null, and `color` is #rrggbb or null.
 * Throws NotArcFileError for anything that is not Arc's sidebar file, before reading any of it.
 */
export function readArcSidebar(json) {
    let file;
    try {
        file = JSON.parse(json);
    } catch {
        throw new NotArcFileError();
    }
    const source = findSource(file);
    if (!source || !source.spaces.order.length) throw new NotArcFileError();
    const { items } = source;
    const spaces = source.spaces.order.map(id => {
        const space = source.spaces.byId.get(id);
        const { pinned, unpinned } = containerIds(space);
        const counts = newCounts();
        const seen = new Set();
        const tree = readChildren(items, items.byId.get(pinned)?.childrenIds, counts, seen);
        // Today tabs are open pages in Arc, not saved ones; they are counted, not imported.
        const today = newCounts();
        readChildren(items, items.byId.get(unpinned)?.childrenIds, today, seen);
        return {
            id,
            name: text(space.title),
            icon: spaceIcon(space),
            color: spaceColor(space),
            pinned: tree,
            counts,
            todayTabs: today.tabs
        };
    });
    const favoriteCounts = newCounts();
    return { spaces, favorites: readFavorites(items, favoriteCounts), favoriteCounts };
}
