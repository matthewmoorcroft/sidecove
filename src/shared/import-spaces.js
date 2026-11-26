// Creates spaces brought in from another browser (see sidebar/features/arc-import/): one new
// bookmark folder per space under the Sidecove folder, holding its pinned tabs and folders.
// It never adds to a space that already exists, and if anything fails it removes what it made,
// so an import is all or nothing. Runs in the service worker, the only writer of spaces.
//
// Each imported space's registry entry records where it came from (`importedFrom`, such as
// "arc:<Arc's space id>") and whether it holds the imported favorites, so importing the same
// file again skips what is already here. Deleting the space removes its entry, and a space
// whose bookmark folder is gone no longer counts, so either makes it importable again.

// Whether a pinned tab may hold this address: a web page or a file that Chrome can parse.
// Anything else in a plan is left out, so one bad address never stops an import.
export const isSavableUrl = url => /^(https?|file):/i.test(url) && URL.canParse(url);
const text = value => (typeof value === 'string' ? value.trim() : '');

// A name no space has yet, compared without case as the sidebar does: "Work", then
// "Work (Arc)", "Work (Arc 2)" and so on.
export function uniqueSpaceName(name, takenNames, source) {
    const taken = new Set(takenNames.map(n => String(n).toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 1; ; i++) {
        const candidate = `${name} (${source}${i > 1 ? ` ${i}` : ''})`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

// What earlier imports brought in that is still here: the sources of spaces whose bookmark
// folder still exists, and whether one of them holds imported favorites.
export function earlierImports(registry, folderIds) {
    const live = new Set(folderIds.map(String));
    const entries = Object.values(registry || {}).filter(
        entry => entry?.importedFrom && live.has(String(entry.bookmarkFolderId))
    );
    return {
        sources: new Set(entries.map(entry => entry.importedFrom)),
        favorites: entries.some(entry => entry.importedFavorites)
    };
}

// Creates the items; returns whether they included the favorites folder.
async function addItems(chrome, parentId, items, { skipFavorites }) {
    let favorites = false;
    for (const item of Array.isArray(items) ? items : []) {
        if (item?.favorites && skipFavorites) continue;
        if (Array.isArray(item?.children)) {
            favorites ||= Boolean(item.favorites);
            const folder = await chrome.bookmarks.create({ parentId, title: text(item.title) });
            await addItems(chrome, folder.id, item.children, { skipFavorites });
        } else if (isSavableUrl(text(item?.url))) {
            await chrome.bookmarks.create({ parentId, title: text(item.title), url: text(item.url) });
        }
    }
    return favorites;
}

// Adds plan.spaces ([{ name, color, shade?, icon?, importedFrom?, items }]) to the store, after
// its spaces. A space whose importedFrom an earlier import already brought in is skipped, and
// so is a favorites folder ({ favorites: true }) once one has been imported.
export async function importSpaces(store, plan, { chrome, storage }) {
    const root = await storage.getOrCreateSidecoveFolder();
    const folders = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url);
    const earlier = earlierImports(
        await storage.getSpaceRegistry(),
        folders.map(folder => folder.id)
    );
    const taken = [...store.spaces.map(space => space.name), ...folders.map(folder => folder.title)];
    const source = text(plan?.source) || 'imported';
    const created = [];
    const made = [];
    try {
        for (const entry of Array.isArray(plan?.spaces) ? plan.spaces : []) {
            const importedFrom = text(entry.importedFrom);
            if (importedFrom && earlier.sources.has(importedFrom)) continue;
            if (importedFrom) earlier.sources.add(importedFrom);
            const name = uniqueSpaceName(text(entry.name) || 'Imported space', taken, source);
            taken.push(name);
            const color = text(entry.color) || 'grey';
            const folder = await chrome.bookmarks.create({ parentId: root.id, title: name });
            created.push(folder.id);
            const favorites = await addItems(chrome, folder.id, entry.items, { skipFavorites: earlier.favorites });
            earlier.favorites ||= favorites;
            await storage.getOrCreateSpaceRegistryEntry(folder.id, { name, color, shade: text(entry.shade) || null });
            const extra = {
                ...(text(entry.icon) ? { icon: text(entry.icon) } : {}),
                ...(importedFrom ? { importedFrom } : {}),
                ...(favorites ? { importedFavorites: true } : {})
            };
            if (Object.keys(extra).length) await storage.updateSpaceRegistryEntry(folder.id, extra);
            made.push(await store.makeSpace(name, color, folder));
        }
    } catch (error) {
        for (const id of created) {
            await chrome.bookmarks.removeTree(id).catch(() => {});
            await storage.removeSpaceRegistryEntry(id);
        }
        throw error;
    }
    store.spaces.push(...made);
}
