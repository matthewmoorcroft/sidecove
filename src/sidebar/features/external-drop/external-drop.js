import { dragKind, dropAction } from './drop-action.js';

// Dragging a link or some text from a page onto the sidebar opens it in a new tab. The service
// worker files the new tab in the selected space, as for the New Tab row. Drags that start in
// the sidebar (reordering tabs, folders, favorites, spaces) are left to their own handlers.
export function wireExternalDrop({ root, doc, chromeApi = chrome, getWindowId = () => undefined }) {
    // dragstart only fires in the document the drag began in, so seeing one means it is ours.
    let internalDrag = false;
    doc.addEventListener('dragstart', () => (internalDrag = true), true);
    doc.addEventListener('dragend', () => (internalDrag = false), true);
    // A drag whose source was removed never reports its end; the next click starts afresh.
    doc.addEventListener('pointerdown', () => (internalDrag = false), true);

    const setActive = kind => {
        root.classList.toggle('external-drop-active', Boolean(kind));
        if (kind) root.dataset.externalDrop = kind;
        else delete root.dataset.externalDrop;
    };
    // Text fields take dropped text themselves.
    const isTextField = target => Boolean(target?.closest?.('input, textarea, [contenteditable]'));
    const claim = event => {
        event.preventDefault();
        event.stopPropagation();
    };

    function onDrag(event) {
        if (internalDrag || isTextField(event.target)) return;
        const kind = dragKind(event.dataTransfer?.types);
        if (!kind) return;
        // A dropped file would otherwise open in place of the sidebar.
        claim(event);
        if (kind === 'files') {
            event.dataTransfer.dropEffect = 'none';
            return setActive(null);
        }
        event.dataTransfer.dropEffect = 'copy';
        setActive(kind);
    }

    function onDragLeave(event) {
        if (!root.contains(event.relatedTarget)) setActive(null);
    }

    function onDrop(event) {
        if (internalDrag || isTextField(event.target)) return;
        setActive(null);
        if (!dragKind(event.dataTransfer?.types)) return;
        claim(event);
        const action = dropAction(event.dataTransfer);
        if (action) chromeApi.tabs.create({ url: action.url, active: true, windowId: getWindowId() });
    }

    root.addEventListener('dragenter', onDrag, true);
    root.addEventListener('dragover', onDrag, true);
    root.addEventListener('dragleave', onDragLeave, true);
    root.addEventListener('drop', onDrop, true);
}
