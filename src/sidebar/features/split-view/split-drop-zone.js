/**
 * Where on a tab row a dragged tab offers Split View, and when that offer turns on. Pure: no
 * chrome.* and no DOM.
 *
 * A row's top and bottom bands keep reordering, so a drag that only passes over the list never
 * splits anything. Only a tab held over the middle band of another tab for a moment offers the
 * split, the same gesture that makes a folder of two favorites.
 */

// The middle band of the row, as fractions of its height.
export const SPLIT_BAND = Object.freeze({ from: 0.3, to: 0.7 });
// How long the dragged tab must stay over the same row's middle.
export const SPLIT_DWELL_MS = 500;

// 'split' when the pointer is in the row's middle band, else 'reorder'.
export function splitDropZone(rect, y) {
    if (!rect || !(rect.height > 0)) return 'reorder';
    const at = (y - rect.top) / rect.height;
    return at >= SPLIT_BAND.from && at <= SPLIT_BAND.to ? 'split' : 'reorder';
}

/**
 * Whether a drag may offer splitting, from what the list knows without asking Chrome: one
 * ordinary tab of the open tabs list, dragged on its own, over another ordinary tab of that list,
 * neither of them already in a split view. Favorites live in another list and are never offered.
 */
export function splitDropCandidate({ section, draggedId, targetId, carriedCount, draggedInSplit, targetInSplit }) {
    if (section !== 'temporary' || carriedCount !== 1) return false;
    if (!Number.isInteger(draggedId) || !Number.isInteger(targetId) || draggedId === targetId) return false;
    return !draggedInSplit && !targetInSplit;
}

// Turns the offer on once the same target has been held for `dwellMs`. `next` takes the key of
// the row under the pointer's middle band, or null when there is none, and the current time.
export function createSplitArming({ dwellMs = SPLIT_DWELL_MS } = {}) {
    let hover = null;
    return {
        next(key, now) {
            if (key === null || key === undefined) {
                hover = null;
                return false;
            }
            if (hover?.key !== key) {
                hover = { key, since: now };
                return false;
            }
            return now - hover.since >= dwellMs;
        },
        reset() {
            hover = null;
        }
    };
}
