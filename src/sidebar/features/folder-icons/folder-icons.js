/**
 * Folder icons in the sidebar: drawing a folder's icon, the Change Folder Icon picker, and
 * keeping other open sidebars in step when an icon changes.
 */

import { FOLDER_CLOSED_ICON, FOLDER_CLOSED_DOTS_ICON, FOLDER_OPEN_ICON } from '../../icons.js';
import { showIconPicker } from '../icon-picker/icon-picker.js';
import { drawSpaceIcon } from '../space-icons/draw-space-icon.js';
import { folderIconChanges, loadFolderIcon, saveFolderIcon } from './folder-icon-store.js';

const folderElementsFor = folderId => document.querySelectorAll(`.folder[data-bookmark-id="${CSS.escape(folderId)}"]`);

function setFolderIconData(folderElement, icon) {
    if (icon) folderElement.dataset.folderIcon = icon;
    else delete folderElement.dataset.folderIcon;
}

// A custom icon replaces the folder glyph whether the folder is open or closed; a closed
// folder with open tabs shows a dot beside it instead of the glyph's dots (see styles.css).
export function updateFolderIcon(folderElement) {
    if (!folderElement) return;
    const iconElement = folderElement.querySelector(':scope > .folder-header > .folder-icon');
    if (!iconElement) return;
    const custom = folderElement.dataset.folderIcon;
    folderElement.classList.toggle('has-custom-icon', Boolean(custom));
    if (custom) {
        if (iconElement.dataset.drawn !== custom) {
            drawSpaceIcon(iconElement, custom);
            iconElement.dataset.drawn = custom;
        }
        return;
    }
    delete iconElement.dataset.drawn;
    const isCollapsed = folderElement.classList.contains('collapsed');
    const hasOpenTabs = folderElement.classList.contains('has-open-tabs');
    iconElement.innerHTML = isCollapsed
        ? hasOpenTabs
            ? FOLDER_CLOSED_DOTS_ICON
            : FOLDER_CLOSED_ICON
        : FOLDER_OPEN_ICON;
}

// Reads the folder's stored icon onto its element; call before the folder is first drawn.
export async function restoreFolderIcon(folderElement, storage = chrome.storage.local) {
    setFolderIconData(folderElement, await loadFolderIcon(storage, folderElement.dataset.bookmarkId));
}

export function showFolderIconPicker(folderElement, storage = chrome.storage.local) {
    const folderId = folderElement.dataset.bookmarkId;
    if (!folderId) return;
    const name = folderElement.querySelector(':scope > .folder-header .folder-title')?.textContent || 'folder';
    showIconPicker({
        label: `Icon for ${name}`,
        current: folderElement.dataset.folderIcon || null,
        anchor: folderElement.querySelector(':scope > .folder-header') || folderElement,
        onChoose: async icon => {
            const saved = await saveFolderIcon(storage, folderId, icon);
            for (const element of folderElementsFor(folderId)) {
                setFolderIconData(element, saved);
                updateFolderIcon(element);
            }
        }
    });
}

// Another window's sidebar can change a folder's icon; redraw it here too.
export function watchFolderIcons(storageEvents = chrome.storage.onChanged) {
    storageEvents.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        for (const [folderId, icon] of folderIconChanges(changes)) {
            for (const element of folderElementsFor(folderId)) {
                setFolderIconData(element, icon);
                updateFolderIcon(element);
            }
        }
    });
}
