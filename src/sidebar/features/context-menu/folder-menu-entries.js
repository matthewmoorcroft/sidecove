import { moveToSpaceEntries } from './space-menu-entries.js';

// The "Move to Space" entry in a folder's menu. It is left out when there is no other space to
// move to, so the menu never shows an entry that opens nothing.
export function folderMoveEntries({ spaces, currentSpaceId, onMove }) {
    const submenu = moveToSpaceEntries({ spaces, currentSpaceId, onMove });
    return submenu.length ? [{ label: 'Move to Space', submenu }] : [];
}
