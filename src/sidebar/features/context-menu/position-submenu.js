import { placeSubmenu } from './submenu-placement.js';

// The submenu is only measurable once the hover has shown it, hence the frame wait. Earlier
// offsets are cleared first, because they change the width an absolutely positioned box shrinks to.
export function positionSubmenu(item, submenu) {
    requestAnimationFrame(() => {
        Object.assign(submenu.style, { left: '', right: '', top: '', bottom: '' });
        const size = submenu.getBoundingClientRect();
        const style = placeSubmenu(
            item.getBoundingClientRect(),
            { width: size.width, height: size.height },
            { width: window.innerWidth, height: window.innerHeight }
        );
        Object.assign(submenu.style, style);
    });
}
