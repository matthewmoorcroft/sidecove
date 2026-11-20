// Draws a split pair as one joined block: the two rows keep their own favicon, title and close
// button (so selection, dragging and closing work as for any tab) and share a frame, with a
// Separate button on the first row.
import { pairRoles, splitViewIdOf } from './split-logic.js';
import { SPLIT_VIEW_ICON } from '../../icons.js';

export const rowsOf = container =>
    [...container.children].filter(el => el.classList.contains('tab') || el.classList.contains('folder'));

// Marks the row as a member of the split view; no mark for a tab outside any.
export function markSplitMember(tabElement, tab) {
    const id = splitViewIdOf(tab);
    if (id !== null) tabElement.dataset.splitViewId = String(id);
}

// The rows' split view ids in list order, for finding pairs that a reorder tore apart.
export function splitRowsOf(container) {
    return rowsOf(container).map(el => ({
        tabId: Number(el.dataset.tabId),
        splitViewId: Number(el.dataset.splitViewId ?? -1)
    }));
}

export function markSplitRows(container, onSeparate) {
    container.querySelectorAll(':scope > .tab.split-first, :scope > .tab.split-second').forEach(el => {
        el.classList.remove('split-first', 'split-second');
        el.querySelector('.tab-split-separate')?.remove();
    });
    const rows = rowsOf(container);
    const roles = pairRoles(rows.map(el => ({ splitViewId: Number(el.dataset.splitViewId ?? -1) })));
    rows.forEach((row, index) => {
        const role = roles[index];
        if (!role) return;
        row.classList.add(`split-${role}`);
        if (role !== 'first') return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tab-split-separate';
        button.title = 'Separate Split View';
        button.setAttribute('aria-label', 'Separate Split View');
        button.innerHTML = SPLIT_VIEW_ICON;
        button.addEventListener('click', event => {
            event.stopPropagation();
            onSeparate(Number(row.dataset.tabId));
        });
        row.insertBefore(button, row.querySelector('.tab-close'));
    });
}
