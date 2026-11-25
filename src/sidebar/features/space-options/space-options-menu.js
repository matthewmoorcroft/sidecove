// The actions in a space's options menu (the ⋯ button): New Folder, Delete Space, Import from
// Arc and Settings. The sidebar passes in what each one needs.

export function countBookmarks(node) {
    if (node.url) return 1;
    return (node.children || []).reduce((sum, child) => sum + countBookmarks(child), 0);
}

export function wireSpaceOptionsMenu(
    spaceElement,
    { space, newFolder, getSpaceBookmarkFolder, deleteSpace, importFromArc }
) {
    spaceElement.querySelector('.new-folder-btn').addEventListener('click', () => newFolder());

    spaceElement.querySelector('.delete-space-btn').addEventListener('click', async () => {
        let message;
        try {
            const folder = await getSpaceBookmarkFolder(space);
            const count = countBookmarks((await chrome.bookmarks.getSubTree(folder.id))[0]);
            message = `Delete "${space.name}"? This deletes its bookmark folder (${count} ${count === 1 ? 'bookmark' : 'bookmarks'}) and closes its tabs.`;
        } catch (error) {
            message = `Delete "${space.name}"? Its bookmark folder could not be read. ${error.message}`;
        }
        if (confirm(message)) {
            try {
                await deleteSpace(space.id);
            } catch (error) {
                alert(error.message);
            }
        }
    });

    spaceElement.querySelector('.import-arc-btn').addEventListener('click', () => importFromArc());

    spaceElement.querySelector('.settings-btn').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
}
