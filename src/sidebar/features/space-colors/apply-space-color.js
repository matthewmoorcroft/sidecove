import { setSpaceColorVars } from '../color-overrides/space-color-vars.js';

// Applies a colour choice ({ color, shade }) to a space. A preview only repaints the panel; a
// saved choice updates the space and persists it. Spaces that never had a shade keep their
// stored shape.
export async function applySpaceColor(space, choice, { save, active, container, persist }) {
    if (!save) {
        if (active) setSpaceColorVars(container, { ...space, ...choice });
        return;
    }
    space.color = choice.color;
    if (choice.shade || 'shade' in space) space.shade = choice.shade;
    if (active) setSpaceColorVars(container, space);
    await persist(space);
}
