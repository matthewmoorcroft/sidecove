import { COLOR_NAMES } from '../../../shared/color-palette.js';
import { firstUnusedColor } from '../../space-colors.js';
import { createColorChooser } from './color-chooser.js';
import { choiceForKey, paletteChoice, spaceColorKey } from './space-palette.js';

// The Chrome colour a hand-picked custom colour was given, when it was not left to Auto.
let customGroup = null;

// What the New Space form holds: read when Create is pressed. The select mirrors the choice.
export function newSpaceChoice(select) {
    return choiceForKey(select.value, customGroup) ?? paletteChoice('grey');
}

// The colours of the New Space form: the same circles, wheel and picker as a space's own menu,
// with the hidden select holding the choice. A new space starts on the first of the original
// eight that no space uses, as before.
export function setupNewSpaceColors(container, grid, select) {
    let chosen = paletteChoice('grey');
    const chooser = createColorChooser({
        container,
        grid,
        select,
        current: () => chosen,
        onChoice: (choice, { save }) => {
            chosen = choice;
            customGroup = choice.shade && choice.shade.startsWith('#') ? choice.color : null;
            if (save) select.value = spaceColorKey(choice);
        }
    });
    return {
        reset(spaces) {
            chooser.setPicking(false);
            customGroup = null;
            const name = firstUnusedColor(
                spaces.map(space => ({ color: spaceColorKey(space) })),
                COLOR_NAMES
            );
            chosen = paletteChoice(name);
            chooser.showMark(name);
        }
    };
}
