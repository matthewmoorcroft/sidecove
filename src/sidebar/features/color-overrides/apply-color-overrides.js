import { applyColorVariables } from '../../../shared/color-palette.js';
import { setSpaceColorVars } from './space-color-vars.js';

// The settings keys that hold the colour overrides, for the storage change listener.
export function colorOverridesChanged(changes) {
    return Boolean(changes.colorOverrides || changes.colorOverridesDark);
}

// Applies the light and dark overrides from settings; the stylesheet picks the pair that
// matches the system theme. Then points the sidebar at the active space's colour.
export async function applyColorOverrides({ getSettings, root, container, activeSpace, logger }) {
    try {
        applyColorVariables(root, await getSettings());
        const space = activeSpace();
        if (container && space) setSpaceColorVars(container, space);
    } catch (error) {
        logger.error('Error applying color overrides:', error);
    }
}
