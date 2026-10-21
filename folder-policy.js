// The space's bookmark root is level zero; user folders may occupy levels 1–2.
export async function canCreateFolder(spaceFolderId, parentId) {
    if (parentId === spaceFolderId) return true;
    const { syncTabGroups = false } = await chrome.storage.sync.get('syncTabGroups');
    if (syncTabGroups) return false;
    const [parent] = await chrome.bookmarks.get(parentId);
    return Boolean(parent && !parent.url && parent.parentId === spaceFolderId);
}

export async function createFolder(spaceFolderId, parentId, title) {
    if (!await canCreateFolder(spaceFolderId, parentId)) {
        throw new Error('Nested folders require tab group sync to be off and support two folder levels.');
    }
    return chrome.bookmarks.create({ parentId, title });
}

// True when targetId is the folder node itself or anywhere inside it.
export function isDescendant(folderNode, targetId) {
    return String(folderNode.id) === String(targetId)
        || (folderNode.children || []).some(child => isDescendant(child, targetId));
}

// Moving a folder must keep it out of its own subtree, and moving it into a new parent
// must stay within the two folder levels.
export async function canMoveFolder(spaceFolderId, folderId, parentId) {
    const [folder] = await chrome.bookmarks.getSubTree(folderId);
    if (!folder || folder.url || isDescendant(folder, parentId)) return false;
    if (folder.parentId === parentId || parentId === spaceFolderId) return true;
    if ((folder.children || []).some(child => !child.url)) return false;
    return canCreateFolder(spaceFolderId, parentId);
}
