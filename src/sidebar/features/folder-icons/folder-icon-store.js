/**
 * Folder icons - a folder's own symbol or emoji, chosen with the space icon picker.
 *
 * Folders are Chrome bookmark folders, which have no field for an icon, so the icon is kept
 * in chrome.storage.local under one key per folder, as the collapsed state is. Like space
 * icons, it stays on this device.
 */

import { normalizeSpaceIcon } from '../../space-icons.js';

export const FOLDER_ICON_KEY_PREFIX = 'folderIcon:';
export const folderIconKey = folderId => `${FOLDER_ICON_KEY_PREFIX}${folderId}`;

// The folder's stored icon, or null when it has none or what is stored is not a valid icon.
export async function loadFolderIcon(storage, folderId) {
    if (!folderId) return null;
    const key = folderIconKey(folderId);
    const saved = await storage.get(key);
    return normalizeSpaceIcon(saved?.[key]);
}

// Stores icon for the folder; null, or anything that is not a valid icon, removes it.
export async function saveFolderIcon(storage, folderId, icon) {
    if (!folderId) return null;
    const value = normalizeSpaceIcon(icon);
    if (value) await storage.set({ [folderIconKey(folderId)]: value });
    else await storage.remove(folderIconKey(folderId));
    return value;
}

// Removes the icons of deleted folders.
export async function removeFolderIcons(storage, folderIds) {
    const keys = folderIds.filter(Boolean).map(folderIconKey);
    if (keys.length) await storage.remove(keys);
}

// The folder icons a chrome.storage.onChanged event sets or removes, as [folderId, icon|null].
export function folderIconChanges(changes) {
    return Object.entries(changes || {})
        .filter(([key]) => key.startsWith(FOLDER_ICON_KEY_PREFIX))
        .map(([key, change]) => [key.slice(FOLDER_ICON_KEY_PREFIX.length), normalizeSpaceIcon(change?.newValue)]);
}
