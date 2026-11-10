// Where a tab opened from a link goes in a space's stored tab list.
//
// The list is stored in Chrome order (left to right), but the side panel draws it reversed
// when "Show new tabs at the top" is on. A link tab belongs below its opener on screen, so
// the position is worked out on screen and converted back.
//
// This follows Chrome's own model: while you stay on a tab, the links you open from it stack
// beneath it in the order opened, each under the one before (`tailId`). Switching to another
// tab and coming back resets that, and the next link goes directly beneath the tab again.

/**
 * @param {number[]} ids stored list the tab is added to (not changed)
 * @param {number} openerId tab the link was opened from
 * @param {number} newId the new tab
 * @param {number|undefined} tailId the last link opened from the opener since it was last
 *   switched to, if it is still in the list
 * @param {boolean} inverted whether the list is drawn reversed
 * @returns {number[]} the new stored list
 */
export function placeLinkTab(ids, openerId, newId, tailId, inverted) {
    const screen = inverted ? [...ids].reverse() : [...ids];
    // An opener outside the list (a pinned tab or favourite) puts its links at the top of the
    // list: indexOf gives -1, so the first link goes before the first row.
    const after = screen.includes(tailId) ? tailId : openerId;
    screen.splice(screen.indexOf(after) + 1, 0, newId);
    return inverted ? screen.reverse() : screen;
}

/**
 * Remembers, for each opener, the links opened from it since it was last switched to, and works
 * out where the next one goes. A link only counts as "the last one" while the links sit in an
 * unbroken run directly beneath their opener: drag one away, or close it, and the next link goes
 * under the opener again (or after the links still under it).
 */
export class LinkTails {
    /** @param {Array<[number, number|number[]]>} [entries] as given by `entries()` */
    constructor(entries = []) {
        this.links = new Map(entries.map(([opener, ids]) => [opener, [].concat(ids)]));
    }

    entries() {
        return [...this.links];
    }

    /**
     * @param {number[]} ids stored list the link is added to (not changed)
     * @param {boolean} inverted whether the list is drawn reversed
     * @returns {number[]} the new stored list
     */
    place(ids, openerId, newId, inverted) {
        const stored = placeLinkTab(ids, openerId, newId, this.#lastBeneath(ids, openerId, inverted), inverted);
        // A link from a link stays with the group of the tab that opened the first one.
        for (const links of this.links.values()) if (links.includes(openerId)) links.push(newId);
        if (!this.links.has(openerId)) this.links.set(openerId, []);
        this.links.get(openerId).push(newId);
        return stored;
    }

    /** The user came back to this tab: its next link goes directly beneath it. */
    switchedTo(openerId) {
        this.links.delete(openerId);
    }

    /** A tab closed. */
    closed(id) {
        this.links.delete(id);
        for (const [opener, links] of this.links) {
            const rest = links.filter(link => link !== id);
            if (rest.length) this.links.set(opener, rest);
            else this.links.delete(opener);
        }
    }

    #lastBeneath(ids, openerId, inverted) {
        const links = new Set(this.links.get(openerId));
        const screen = inverted ? [...ids].reverse() : ids;
        // An opener outside the list (indexOf -1) has its links from the top of the list.
        let at = screen.indexOf(openerId);
        let last;
        while (links.has(screen[at + 1])) last = screen[++at];
        return last;
    }
}
