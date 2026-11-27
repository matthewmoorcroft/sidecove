import { Utils } from '../../../shared/utils.js';
import { createColorChooser } from './color-chooser.js';
import { spaceColorMenu } from './space-color-menu.js';

// The space button's Theme Color: the same circles, wheel and picker as the space's own menu,
// in a small popover at the pointer. Choices go through that menu, so both always agree.
// Returns false when the space has no menu to go through.
export function showSpaceColorPopover(space, x, y) {
    const menu = spaceColorMenu(space.id);
    if (!menu) return false;
    document.getElementById('spaceColorPopover')?.remove();
    const popover = document.createElement('div');
    popover.id = 'spaceColorPopover';
    popover.className = 'space-color-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Theme Color');
    popover.tabIndex = -1;
    const grid = document.createElement('div');
    grid.className = 'color-picker-grid';
    popover.append(grid);

    const place = () => Utils.adjustMenuPosition(popover, x, y);
    const close = () => {
        popover.remove();
        document.removeEventListener('mousedown', onOutside, true);
    };
    const onOutside = event => {
        if (!popover.contains(event.target)) close();
    };
    createColorChooser({
        container: popover,
        grid,
        current: () => menu.space,
        onChoice: (choice, options) => menu.apply(choice, options),
        onPickingChange: () => requestAnimationFrame(place)
    });
    popover.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !popover.classList.contains('picking')) close();
    });
    document.body.append(popover);
    place();
    document.addEventListener('mousedown', onOutside, true);
    (grid.querySelector('.color-swatch[tabindex="0"]') ?? popover).focus();
    return true;
}
