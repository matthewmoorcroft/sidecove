// The menu of a tab that lives in another window. Pinning, duplicating or dragging it would act
// in that window, so only what works the same from here is offered until tabs can be brought
// into this window. Moving it to a space leaves this window on its current space.
export function otherWindowMenuEntries({ muted, spaces, currentSpaceId, canRename, actions }) {
    const entries = [{ label: muted ? 'Unmute Tab' : 'Mute Tab', action: () => actions.setMuted(!muted) }];
    if (canRename) entries.push({ label: 'Rename Tab', action: actions.rename });
    entries.push({ label: 'Copy Link', action: actions.copyLink }, 'separator');
    entries.push({
        label: 'Move to Space',
        submenu: spaces
            .filter(space => space.id !== currentSpaceId)
            .map(space => ({ label: space.name, action: () => actions.moveToSpace(space.id) }))
    });
    entries.push({ label: 'Close Tab', action: actions.close });
    return entries;
}

// What each entry does. The tab can close in its window while the menu is open, so Copy Link
// falls back to the address the row was drawn with.
export function otherWindowMenuActions(tab, { chrome, rename, copyText, showCopied, moveTabToSpace, closeTab }) {
    return {
        setMuted: value => chrome.tabs.update(tab.id, { muted: value }),
        rename,
        copyLink: async () => {
            const url = await chrome.tabs.get(tab.id).then(
                live => live.url || tab.url,
                () => tab.url
            );
            if (url && (await copyText(url))) showCopied();
        },
        moveToSpace: spaceId => moveTabToSpace(tab.id, spaceId, false),
        close: () => closeTab()
    };
}
