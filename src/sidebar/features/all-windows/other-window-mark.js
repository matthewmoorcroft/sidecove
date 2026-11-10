// An entry whose tab lives in another window looks like any other; only its behaviour differs, so
// it carries a class for the handlers and nothing visible. Dragging it would act on the other
// window's tab, so it cannot be dragged.
export function markOtherWindowRow(row) {
    row.classList.add('other-window');
    row.classList.remove('active');
    row.draggable = false;
}

export function markOtherWindowFavicon(element) {
    element.classList.add('other-window');
    element.draggable = false;
}
