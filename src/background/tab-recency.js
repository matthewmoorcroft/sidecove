/**
 * Tab recency - the order tabs were last used in, and the "jump to the last used tab" cycle.
 *
 * Pure logic with no chrome.* so it can be tested directly. One list of tab ids, most recent
 * first, serves every space: a space's order is that list filtered to the space's tabs.
 */

// Presses closer together than this keep going back through the order. Chrome tells an
// extension only when a shortcut is pressed, never when its modifier key is released, so
// this stands in for Arc's "keep Ctrl held down". Slower presses start over from the tab
// you are on, so tapping the shortcut twice at a normal pace returns to where you began.
export const CYCLE_WINDOW_MS = 800;

// Older entries are dropped; far fewer tabs than this are ever cycled through in one go.
export const MAX_RECENT_TABS = 200;

export class TabRecency {
    constructor(ids = []) {
        this.ids = [...new Set(ids)].slice(0, MAX_RECENT_TABS);
        // While repeated presses are going back: { order, index, at, pending, windowId }. `pending` holds
        // tabs a press activated whose onActivated event has not arrived yet.
        this.cycle = null;
    }

    // A tab became active. Tabs a press activated while cycling are not "use": the tab you
    // stop on counts once the cycle ends (see #finishCycle).
    record(tabId, windowId) {
        // Another window changing tabs says nothing about the cycle in this one.
        if (this.cycle && windowId !== undefined && windowId !== this.cycle.windowId) return;
        if (this.cycle?.pending.delete(tabId)) return;
        this.#finishCycle();
        this.#promote(tabId);
    }

    remove(tabId) {
        this.ids = this.ids.filter(id => id !== tabId);
        if (!this.cycle) return;
        const stoppedOn = this.cycle.order[this.cycle.index];
        this.cycle.order = this.cycle.order.filter(id => id !== tabId);
        this.cycle.index = this.cycle.order.indexOf(stoppedOn);
        if (this.cycle.index === -1 || this.cycle.order.length < 2) this.cycle = null;
    }

    // Restore a saved order behind anything recorded since startup.
    load(saved) {
        this.ids = [...new Set([...this.ids, ...saved])].slice(0, MAX_RECENT_TABS);
    }

    replace(oldId, newId) {
        this.#finishCycle(); // The tab a cycle stopped on still counts as used.
        // Chrome can report the new tab as active before it reports the swap.
        this.ids = [...new Set(this.ids.map(id => (id === oldId ? newId : id)))];
        this.cycle = null;
    }

    /**
     * The tab a press should activate, or null when there is nowhere to go.
     * `candidates` are the ids of the active tab's space in tab-strip order, `activeId` the
     * tab being left, `now` a millisecond timestamp.
     */
    press({ candidates, activeId, now, windowId }) {
        const inCycle =
            this.cycle && now - this.cycle.at <= CYCLE_WINDOW_MS && this.cycle.order[this.cycle.index] === activeId;
        if (!inCycle) {
            this.#finishCycle();
            // Tabs not used since the extension started are reachable too, after the used ones.
            const known = new Set(candidates);
            const used = this.ids.filter(id => known.has(id) && id !== activeId);
            const usedSet = new Set(used);
            const unused = candidates.filter(id => id !== activeId && !usedSet.has(id));
            const order = [activeId, ...used, ...unused];
            if (order.length < 2) return null;
            this.cycle = { order, index: 0, at: now, pending: new Set(), windowId };
        }
        this.cycle.previous = this.cycle.index;
        this.cycle.index = (this.cycle.index + 1) % this.cycle.order.length;
        this.cycle.at = now;
        const target = this.cycle.order[this.cycle.index];
        this.cycle.pending.add(target);
        return target;
    }

    // The tab press() returned could not be activated: stay where the cycle was.
    abandonPress(targetId) {
        if (!this.cycle || this.cycle.order[this.cycle.index] !== targetId) return;
        this.cycle.pending.delete(targetId);
        this.cycle.index = this.cycle.previous;
    }

    #finishCycle() {
        if (!this.cycle) return;
        const stoppedOn = this.cycle.order[this.cycle.index];
        this.cycle = null;
        this.#promote(stoppedOn);
    }

    #promote(tabId) {
        this.ids = [tabId, ...this.ids.filter(id => id !== tabId)].slice(0, MAX_RECENT_TABS);
    }

    // The saved order, with the tab a cycle is on counted as used. Leaves a running cycle alone.
    toJSON() {
        const stoppedOn = this.cycle?.order[this.cycle.index];
        return stoppedOn === undefined ? this.ids : [stoppedOn, ...this.ids.filter(id => id !== stoppedOn)];
    }
}
