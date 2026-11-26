import { spaceLook } from '../space-colors/space-palette.js';

// Elements painted with a colour that has no stylesheet variable carry its light and dark
// values; space-colors.css picks the one for the system theme as --shade-surface/--shade-accent.
export const SHADE_CLASS = 'space-shade';

// Points `surface` (and `accent`, the hover and secondary shade) of element at a space's colour.
// They are references, not computed values, so the colours follow a change of the system theme
// or of a Settings override without being set again. `look` is a spaceLook(), a space, or a
// colour name.
export function paintSpaceColor(element, look, { surface, accent, fallback }) {
    const resolved = typeof look === 'string' ? spaceLook({ color: look }) : look?.key ? look : spaceLook(look);
    const withFallback = value => (fallback ? `var(${value}, ${fallback})` : `var(${value})`);
    if (resolved.named) {
        element.classList?.remove(SHADE_CLASS);
        element.style.removeProperty?.('--shade-light');
        element.style.removeProperty?.('--shade-dark');
        element.style.setProperty(surface, withFallback(`--chrome-${resolved.key}-color`));
        if (accent) element.style.setProperty(accent, withFallback(`--chrome-${resolved.key}-color-dark`));
        return;
    }
    element.classList?.add(SHADE_CLASS);
    element.style.setProperty('--shade-light', resolved.light);
    element.style.setProperty('--shade-dark', resolved.dark);
    element.style.setProperty(surface, 'var(--shade-surface)');
    if (accent) element.style.setProperty(accent, 'var(--shade-accent)');
}

// The sidebar's background variables, for a space or a colour name.
export function setSpaceColorVars(container, space) {
    paintSpaceColor(container, space, {
        surface: '--space-bg-color',
        accent: '--space-bg-color-dark',
        fallback: 'rgba(255, 255, 255, 0.1)'
    });
}
