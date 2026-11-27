import { createColorChooser } from './color-chooser.js';
import { choiceForKey } from './space-palette.js';

// Each space's colour menu by space id, so another place that changes the colour (the space
// button's Theme Color popover) goes through the same path and keeps the menu's mark right.
const menus = new Map();
export const spaceColorMenu = id => {
    const menu = menus.get(String(id));
    return menu?.isConnected() ? menu : null;
};

// The colour part of a space's options menu: the shared chooser inside the menu.
// `onChoice({ color, shade }, { save })` applies a choice.
export function setupSpaceColorMenu(root, space, onChoice) {
    const dropdown = root.querySelector('.space-options-dropdown');
    const container = root.querySelector('.space-options-container');
    const select = root.querySelector('.space-color-select');
    const grid = dropdown.querySelector('.color-picker-grid');
    // Clicks on the menu's text keep focus in it, so the menu stays open while it is used.
    dropdown.tabIndex = -1;

    const chooser = createColorChooser({
        container: dropdown,
        grid,
        select,
        current: () => space,
        onChoice
    });

    // The select mirrors the choice; changing it applies it.
    select.addEventListener('change', () => chooser.apply(choiceForKey(select.value, space.color), { save: true }));

    // Leaving the menu closes the picker, so it opens on the colours next time.
    const closeIfLeft = () => {
        requestAnimationFrame(() => {
            if (!container.matches(':hover') && !container.contains(document.activeElement)) chooser.setPicking(false);
        });
    };
    container.addEventListener('pointerleave', closeIfLeft);
    container.addEventListener('focusout', closeIfLeft);

    const menu = { ...chooser, isConnected: () => container.isConnected, space };
    menus.set(String(space.id), menu);
    return menu;
}
