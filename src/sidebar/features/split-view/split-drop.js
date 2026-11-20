/**
 * Drag a tab onto another tab to show the two in a split view. While the dragged tab is held over
 * the middle of another tab, that row shows a "Split View" hint on its right half, where the
 * dragged tab will go; dropping then hands the pair to the same split path as the tab menu.
 * Everywhere else on the list the drop reorders as before.
 */
import { createSplitArming, splitDropCandidate, splitDropZone, SPLIT_DWELL_MS } from './split-drop-zone.js';

const TARGET_CLASS = 'split-target';

const tabIdOf = element => (element?.dataset.tabId ? Number(element.dataset.tabId) : null);

/**
 * splitView  from createSplitView: supported and canPair(targetId, draggedId)
 * now        clock, for tests
 */
export function createSplitDrop({ splitView, now = () => Date.now(), dwellMs = SPLIT_DWELL_MS }) {
    const arming = createSplitArming({ dwellMs });
    // Chrome's answer per pair for the drag in progress; undefined while it is still being asked.
    const allowed = new Map();
    let armed = null;

    const ask = (targetId, draggedId) => {
        const key = `${targetId}:${draggedId}`;
        if (!allowed.has(key)) {
            allowed.set(key, undefined);
            splitView
                .canPair(targetId, draggedId)
                .catch(() => false)
                .then(ok => allowed.has(key) && allowed.set(key, ok));
        }
        return allowed.get(key);
    };

    const show = next => {
        if (armed?.element === next?.element) return;
        armed?.element.classList.remove(TARGET_CLASS);
        armed = next;
        armed?.element.classList.add(TARGET_CLASS);
    };

    // The tab row the drag would split with, or null.
    function candidate(event, draggingElement, container, carriedCount) {
        const target = event.target?.closest?.('.tab');
        if (!target || !container.contains(target) || target === draggingElement) return null;
        const draggedId = tabIdOf(draggingElement);
        const targetId = tabIdOf(target);
        const ok = splitDropCandidate({
            section: container.dataset.tabType,
            draggedId,
            targetId,
            carriedCount,
            draggedInSplit: draggingElement.dataset.splitViewId !== undefined,
            targetInSplit: target.dataset.splitViewId !== undefined
        });
        if (!ok || draggingElement.parentElement !== container) return null;
        if (splitDropZone(target.getBoundingClientRect(), event.clientY) !== 'split') return null;
        return { element: target, targetId, draggedId };
    }

    return {
        // On every dragover of a list: the row that now offers Split View, or null.
        over(event, draggingElement, container, carriedCount) {
            if (!splitView.supported || !draggingElement) return this.clear();
            const next = candidate(event, draggingElement, container, carriedCount);
            // Ask Chrome as soon as the hold starts, so the answer is in before the hold ends.
            const ok = next ? ask(next.targetId, next.draggedId) : false;
            const held = arming.next(next ? `${next.targetId}:${next.draggedId}` : null, now());
            show(held && ok === true ? next : null);
            return armed?.element ?? null;
        },

        // On drop into `container`: the armed pair { targetId, draggedId } to split, or null.
        take(container) {
            const pair = armed?.element.isConnected && container.contains(armed.element) ? armed : null;
            this.clear();
            return pair && { targetId: pair.targetId, draggedId: pair.draggedId };
        },

        // When the drag leaves the list or ends.
        clear() {
            show(null);
            arming.reset();
            return null;
        },

        // When the drag ends: forget Chrome's answers too, since tabs may change before the next.
        end() {
            this.clear();
            allowed.clear();
        }
    };
}
