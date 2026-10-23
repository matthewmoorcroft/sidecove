/**
 * Selection - which sidebar tabs are selected for a bulk action.
 *
 * Cmd or Ctrl click toggles one item; Shift click selects the run between the anchor and
 * the clicked item, as in Finder and Arc. Items are identified by stable string keys, and
 * order always comes from the caller's current display order.
 */

export function selectionGesture(event) {
    if (event?.metaKey || event?.ctrlKey) return 'toggle';
    if (event?.shiftKey) return 'range';
    return null;
}

export class Selection {
    constructor() {
        this.keys = new Set();
        this.anchor = null;
    }

    get size() {
        return this.keys.size;
    }

    has(key) {
        return this.keys.has(key);
    }

    toggle(key) {
        if (this.keys.has(key)) this.keys.delete(key);
        else this.keys.add(key);
        this.anchor = key;
    }

    // fallbackAnchor is the item the run starts from when nothing was clicked yet.
    extendTo(key, orderedKeys, fallbackAnchor = null) {
        const anchor = this.anchor ?? fallbackAnchor ?? key;
        let from = orderedKeys.indexOf(anchor);
        const to = orderedKeys.indexOf(key);
        if (to === -1) return;
        if (from === -1) from = to;
        const [start, end] = from <= to ? [from, to] : [to, from];
        this.keys = new Set(orderedKeys.slice(start, end + 1));
        this.anchor = anchor;
    }

    clear() {
        this.keys.clear();
        this.anchor = null;
    }

    prune(existingKeys) {
        const existing = new Set(existingKeys);
        for (const key of this.keys) if (!existing.has(key)) this.keys.delete(key);
        if (!existing.has(this.anchor)) this.anchor = null;
    }

    ordered(orderedKeys) {
        return orderedKeys.filter(key => this.keys.has(key));
    }
}
