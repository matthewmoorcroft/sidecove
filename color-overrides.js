/**
 * Colour overrides - the user's custom palette colours, one set for light mode and
 * one for dark mode. The sidebar text follows the system theme, so a single override
 * that suits light mode can be unreadable in dark mode; each mode has its own.
 *
 * Settings: colorOverrides (light mode, the original key) and colorOverridesDarkMode.
 * CSS: --user-chrome-<name>-color (light) and --user-chrome-<name>-dark-mode-color.
 */

export const COLOR_NAMES = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];

// Built-in values, matching styles.css (6-digit hex for <input type="color">).
export const DEFAULT_LIGHT_COLORS = {
    grey: '#cccccc', blue: '#8bb3f3', red: '#ff9e97', yellow: '#ffe29f',
    green: '#8bda99', pink: '#fbaad7', purple: '#d6a6ff', cyan: '#a5e2ea'
};
export const DEFAULT_DARK_COLORS = {
    grey: '#546e7a', blue: '#235d8b', red: '#963d3d', yellow: '#a38e54',
    green: '#4f8057', pink: '#b06c92', purple: '#8d75a1', cyan: '#5e9299'
};

export const lightModeProperty = name => `--user-chrome-${name}-color`;
export const darkModeProperty = name => `--user-chrome-${name}-dark-mode-color`;

// CSS custom property -> value for every palette colour; null means "use the default".
export function overrideProperties(lightOverrides, darkOverrides) {
    const properties = {};
    for (const name of COLOR_NAMES) {
        properties[lightModeProperty(name)] = lightOverrides?.[name] || null;
        properties[darkModeProperty(name)] = darkOverrides?.[name] || null;
    }
    return properties;
}

export function applyOverrideProperties(element, lightOverrides, darkOverrides) {
    for (const [property, value] of Object.entries(overrideProperties(lightOverrides, darkOverrides))) {
        if (value) element.style.setProperty(property, value);
        else element.style.removeProperty(property);
    }
}

// The overrides to store: only colours that differ from the default, or null if none do.
export function changedColors(values, defaults) {
    const changed = {};
    for (const name of COLOR_NAMES) {
        const value = values?.[name];
        if (value && value.toLowerCase() !== defaults[name]) changed[name] = value;
    }
    return Object.keys(changed).length > 0 ? changed : null;
}
