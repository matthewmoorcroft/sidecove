// Marks an item that lives in another window: dimmed, as Arc shows an inactive window's tabs,
// plus a window icon and a spoken label, so the mark does not rely on colour alone.
export const OTHER_WINDOW_LABEL = 'In another window';

const ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<rect x="5" y="1.75" width="9.25" height="7.75" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M2.5 5.5v6.75a2 2 0 0 0 2 2h6.75" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    '</svg>';

export function createOtherWindowBadge(doc = document) {
    const badge = doc.createElement('span');
    badge.className = 'other-window-badge';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', OTHER_WINDOW_LABEL);
    badge.title = OTHER_WINDOW_LABEL;
    badge.innerHTML = ICON;
    return badge;
}

// Dragging it into this window's list needs the tab moved here first, which comes later.
export function markOtherWindowRow(row) {
    row.classList.add('other-window');
    row.classList.remove('active');
    row.draggable = false;
    row.querySelector('.tab-details')?.after(createOtherWindowBadge(row.ownerDocument));
}

export function markOtherWindowFavicon(element, title) {
    const label = `${title || 'Favorite'} (${OTHER_WINDOW_LABEL.toLowerCase()})`;
    element.classList.add('other-window');
    element.draggable = false;
    element.title = label;
    const img = element.querySelector('img');
    if (img) img.alt = label;
    element.append(createOtherWindowBadge(element.ownerDocument));
}
