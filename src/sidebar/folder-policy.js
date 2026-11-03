// The space's bookmark root is level zero; user folders may occupy levels 1 to MAX_FOLDER_DEPTH.
export const MAX_FOLDER_DEPTH = 4;

export async function canCreateFolder(spaceFolderId, parentId) {
    if (parentId === spaceFolderId) return true;
    const { syncTabGroups = false } = await chrome.storage.sync.get('syncTabGroups');
    if (syncTabGroups) return false;
    // A new folder sits one level below its parent, so the parent may be at most MAX_FOLDER_DEPTH - 1.
    let id = parentId;
    for (let depth = 1; depth < MAX_FOLDER_DEPTH; depth++) {
        const [node] = await chrome.bookmarks.get(id);
        if (!node || node.url) return false;
        if (node.parentId === spaceFolderId) return true;
        id = node.parentId;
    }
    return false;
}

export async function createFolder(spaceFolderId, parentId, title) {
    if (!await canCreateFolder(spaceFolderId, parentId)) {
        throw new Error(`Nested folders require tab group sync to be off and support up to ${MAX_FOLDER_DEPTH} folder levels.`);
    }
    return chrome.bookmarks.create({ parentId, title });
}

// True when targetId is the folder node itself or anywhere inside it.
export function isDescendant(folderNode, targetId) {
    return String(folderNode.id) === String(targetId)
        || (folderNode.children || []).some(child => isDescendant(child, targetId));
}

// Moving a folder must keep it out of its own subtree, and moving it into a new parent
// must stay within MAX_FOLDER_DEPTH; a folder with subfolders may only move to the space root.
export async function canMoveFolder(spaceFolderId, folderId, parentId) {
    const [folder] = await chrome.bookmarks.getSubTree(folderId);
    if (!folder || folder.url || isDescendant(folder, parentId)) return false;
    if (folder.parentId === parentId || parentId === spaceFolderId) return true;
    if ((folder.children || []).some(child => !child.url)) return false;
    return canCreateFolder(spaceFolderId, parentId);
}
