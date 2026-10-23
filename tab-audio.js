// Arc shows a speaker on tabs that play sound; a muted tab keeps a crossed-out speaker so
// it can be unmuted from the sidebar.
export function audioState(tab) {
    if (tab?.mutedInfo?.muted) return 'muted';
    if (tab?.audible) return 'playing';
    return null;
}
