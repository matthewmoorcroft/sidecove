// Creates spaces brought in from another browser (see sidebar/features/arc-import/): one new
// bookmark folder per space under the Sidecove folder, holding its pinned tabs and folders.
// It never adds to a space that already exists, and if anything fails it removes what it made,
// so an import is all or nothing. Runs in the service worker, the only writer of spaces.

// Pages a pinned tab may hold; anything else in the plan is left out.
const SAVABLE_URL = /^(https?|file):/i;
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

async function addItems(chrome, parentId, items) {
    for (const item of Array.isArray(items) ? items : []) {
        if (Array.isArray(item?.children)) {
            const folder = await chrome.bookmarks.create({ parentId, title: text(item.title) });
            await addItems(chrome, folder.id, item.children);
        } else if (SAVABLE_URL.test(text(item?.url))) {
            await chrome.bookmarks.create({ parentId, title: text(item.title), url: text(item.url) });
        }
    }
}

// Adds plan.spaces ([{ name, color, shade?, icon?, items }]) to the store, after its spaces.
export async function importSpaces(store, plan, { chrome, storage }) {
    const root = await storage.getOrCreateSidecoveFolder();
    const folders = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url);
    const taken = [...store.spaces.map(space => space.name), ...folders.map(folder => folder.title)];
    const source = text(plan?.source) || 'imported';
    const created = [];
    const made = [];
    try {
        for (const entry of Array.isArray(plan?.spaces) ? plan.spaces : []) {
            const name = uniqueSpaceName(text(entry.name) || 'Imported space', taken, source);
            taken.push(name);
            const color = text(entry.color) || 'grey';
            const folder = await chrome.bookmarks.create({ parentId: root.id, title: name });
            created.push(folder.id);
            await addItems(chrome, folder.id, entry.items);
            await storage.getOrCreateSpaceRegistryEntry(folder.id, { name, color, shade: text(entry.shade) || null });
            if (text(entry.icon)) await storage.updateSpaceRegistryEntry(folder.id, { icon: text(entry.icon) });
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
