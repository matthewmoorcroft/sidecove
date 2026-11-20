import { COLOR_NAMES } from '../../../shared/color-palette.js';
import { firstUnusedColor } from '../../space-colors.js';
import { fillColorSelect, markSwatch, renderSwatches, setColorSelect } from './color-swatches.js';
import { spaceColorKey } from './space-palette.js';

// The colours of the New Space form: the suggested ones to choose from, with the hidden select holding the
// choice. A new space starts on the first of the original eight that no space uses, as before.
export function setupNewSpaceColors(grid, select) {
    const choose = name => {
        markSwatch(grid, name);
        setColorSelect(select, name);
    };
    renderSwatches(grid, choose);
    fillColorSelect(select);
    choose('grey');
    select.addEventListener('change', () => markSwatch(grid, select.value));
    return {
        reset(spaces) {
            choose(
                firstUnusedColor(
                    spaces.map(space => ({ color: spaceColorKey(space) })),
                    COLOR_NAMES
                )
            );
        }
    };
}
