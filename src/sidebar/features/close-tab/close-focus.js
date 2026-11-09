// After the active tab closes, Chrome shows another tab by its own rule, which can be a tab
// of a different space, or a different tab of this one than the list shows next. As in Arc, a
// close keeps you in your space: show the next tab down its list, or the one above when the
// closed tab was last, or a New Tab when none is left. A tab Clear is hiding is never a landing
// tab. An empty New Tab that closes after the tab Chrome showed was activated is left to Chrome:
// that is how "Switch to this tab" ends, and Chrome's pick is the tab chosen.
import { Logger } from '../../../shared/logger.js';
import { isUntouchedPage } from '../../../shared/new-tab-page.js';

// `order` is the space's tabs as displayed, top to bottom, including the closed one.
export function pickTabAfterClose(order, closedId, isOpen) {
    const index = order.indexOf(closedId);
    if (index < 0) return undefined;
    const after = order.slice(index + 1).find(isOpen);
    if (after !== undefined) return after;
    return order.slice(0, index).reverse().find(isOpen);
}

// Chrome's activation event follows a close within moments; older notes are stale.
const NOTE_LIFETIME_MS = 5000;

export function createCloseFocus({
    getActiveSpaceId,
    getActiveTabId, // the tab the sidebar last saw activated in this window
    setActiveTabId,
    ownerOf, // tab id -> id of the space that owns it
    displayedOrder, // space id -> ids of its tabs as displayed
    tabExists, // is the tab open in any window
    openTabIds, // ids of the tabs open in this window
    activateTab,
    openNewTab, // opens a New Tab in the active space
    restoreAfterPick // undoes what the service worker recorded for a tab Chrome picked in another space
}) {
    // The sidebar drops a closed tab from its list as the close is handled, which can happen
    // before or after Chrome's activation event arrives, so the list is noted first.
    const closed = new Map();
    // The tab the user last visited in each space; the service worker's record can be overwritten.
    const visited = new Map();
    // Tabs showing nothing but the new tab page. Their address is gone once they close, and
    // "Switch to this tab" shows the chosen tab before the New Tab closes, so it is known early.
    const emptyNewTabs = new Set();
    // Closing several tabs fires several activations; handle them one at a time.
    let queue = Promise.resolve();
    // Counts the removals noted, so an activation can tell which of the two came first.
    let removals = 0;

    // `activatedSpaceId` is missing for a tab no space lists, such as one Clear is hiding
    // (`activatedHidden`). `removalMark` is what `mark()` returned when the activation arrived.
    async function handle({ activatedTabId, activatedSpaceId, activatedHidden = false, removalMark }) {
        const spaceId = getActiveSpaceId();
        const previousTabId = getActiveTabId();
        if (previousTabId == null || !spaceId) return false;
        const wasEmptyNewTab = emptyNewTabs.has(previousTabId);
        if (wasEmptyNewTab) {
            // Settled here, so also forget the New Tabs that have closed since.
            const open = new Set(await openTabIds());
            for (const id of emptyNewTabs) if (!open.has(id)) emptyNewTabs.delete(id);
            // Chrome shows the tab chosen before it closes the New Tab ("Switch to this tab", or
            // the New Tab closing itself on leaving). A close shows the next tab after the removal.
            if (!(closed.get(previousTabId)?.removal <= removalMark)) return false;
        }
        const note = closed.get(previousTabId);
        if ((note ? note.spaceId : ownerOf(previousTabId)) !== spaceId) return false;
        // A tab that is still open, such as one moved to another window, was not closed.
        if (!note && (await tabExists(previousTabId))) return false;
        const order = note ? note.order : displayedOrder(spaceId);
        // A favorite is not in the list, but Chrome landing on a hidden tab still needs a way out.
        if (!order.includes(previousTabId) && !activatedHidden) return false;
        const open = new Set(await openTabIds());
        const isLanding = id => open.has(id) && !closed.has(id);
        const target =
            pickTabAfterClose(order, previousTabId, isLanding) ?? (activatedHidden ? order.find(isLanding) : undefined);
        // The space's only tab was an empty New Tab: another one would look like nothing happened.
        if (wasEmptyNewTab && target === undefined) return false;
        const crossedSpaces = activatedHidden || activatedSpaceId !== spaceId;
        // Chrome already picked the tab we would: nothing to change.
        if (!crossedSpaces && target === activatedTabId) return false;
        try {
            if (target === undefined) await openNewTab();
            else await activateTab(target);
        } catch (error) {
            Logger.warn('Could not stay in the space after a tab closed:', error);
            return false;
        }
        setActiveTabId(target ?? null);
        // A hidden tab is nobody's last tab, so Chrome's pick changed no space to put back.
        if (crossedSpaces && activatedSpaceId) {
            await restoreAfterPick(activatedSpaceId, activatedTabId, visited.get(activatedSpaceId));
        }
        return true;
    }

    return {
        // Call for each tab on creation and update, and for the tabs open at start.
        trackTab(tab) {
            if (isUntouchedPage(tab)) emptyNewTabs.add(tab.id);
            else emptyNewTabs.delete(tab.id);
        },

        noteRemoval(tabId) {
            // Only the tab being shown can make Chrome pick another one.
            if (tabId !== getActiveTabId()) return;
            const spaceId = ownerOf(tabId);
            if (!spaceId) return;
            const now = Date.now();
            for (const [id, note] of closed) if (now - note.at > NOTE_LIFETIME_MS) closed.delete(id);
            closed.set(tabId, { spaceId, order: displayedOrder(spaceId), at: now, removal: ++removals });
        },

        // Call as soon as an activation arrives, before anything is awaited, and pass the result
        // to `stayAfterClose`.
        mark() {
            return removals;
        },

        // True when the tab that was active in the shown space closed and Chrome's pick was
        // replaced by ours. The caller then leaves everything as it is.
        stayAfterClose(activation) {
            const run = queue.then(async () => {
                const stayed = await handle(activation);
                // Settled here so the next queued activation sees where the user now is.
                if (!stayed) {
                    setActiveTabId(activation.activatedTabId);
                    if (activation.activatedSpaceId) {
                        visited.set(activation.activatedSpaceId, activation.activatedTabId);
                    }
                }
                return stayed;
            });
            queue = run.catch(() => {});
            return run;
        }
    };
}
