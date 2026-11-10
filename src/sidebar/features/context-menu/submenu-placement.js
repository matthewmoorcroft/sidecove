// Where a submenu opens so that it stays fully inside the panel. Pure: callers pass
// measured rectangles and apply the returned inline styles. Offsets are relative to the
// parent item, which is the submenu's containing block.
//
const SUBMENU_RISE = 4; // px the stylesheet lifts the submenu above its item

// Right of the item when there is room, else left of it, else in place under the item
// (or over it when the panel has no room below), shifted to sit inside the panel.
export function placeSubmenu(parent, size, viewport) {
    const fitsRight = parent.right + size.width <= viewport.width;
    const fitsLeft = parent.left - size.width >= 0;

    if (fitsRight || fitsLeft) {
        const style = fitsRight ? { left: '', right: '' } : { left: 'auto', right: '100%' };
        // Keep the stylesheet's offset unless the submenu runs off the bottom.
        const runsOffBottom = parent.top - SUBMENU_RISE + size.height > viewport.height;
        return { ...style, top: runsOffBottom ? 'auto' : '', bottom: runsOffBottom ? '0' : '' };
    }

    const left = Math.min(Math.max(parent.left, 0), Math.max(viewport.width - size.width, 0)) - parent.left;
    const fitsBelow = parent.bottom + size.height <= viewport.height;
    const fitsAbove = parent.top - size.height >= 0;
    const above = !fitsBelow && fitsAbove;
    return {
        left: `${left}px`,
        right: 'auto',
        top: above ? 'auto' : '100%',
        bottom: above ? '100%' : 'auto'
    };
}
