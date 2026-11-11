// The tab strip index for a tab dropped into the top bar: how many of this window's pins show
// before the drop point. Dimmed saved favorites and other windows' pins have no tab here to count.
export function pinnedTabIndexAt(afterElement, position, pinnedFavicons) {
    const shown = [...pinnedFavicons.querySelectorAll('.pinned-favicon')];
    const at = afterElement ? shown.indexOf(afterElement) : -1;
    const end = at < 0 ? shown.length : position === 'left' ? at : at + 1;
    return shown.slice(0, end).filter(el => el.dataset.tabId && !el.classList.contains('other-window')).length;
}
