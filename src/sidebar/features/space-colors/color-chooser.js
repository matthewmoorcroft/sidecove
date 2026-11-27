import { normalizeHex } from './color-math.js';
import { fillColorSelect, markSwatch, renderSwatches, setColorSelect } from './color-swatches.js';
import { createCustomColorPicker } from './custom-color-picker.js';
import { choiceForKey, customChoice, paletteEntry, spaceColorKey } from './space-palette.js';

const LIGHT_SEED_FALLBACK = '#cccccc';

// The one way to choose a space colour, shared by the space menu, the New Space form and the
// space button's Theme Color popover: the swatches with a Custom color circle among them, and
// the picker that circle opens in place of everything else in `container`.
//
// `current()` gives the colour now chosen as { color, shade }. `onChoice({ color, shade },
// { save })` hears each choice; save is false for the live preview while the colour square is
// dragged. A `select` (hidden) mirrors the choice for code and tests that read it.
export function createColorChooser({ container, grid, select = null, current, onChoice, onPickingChange }) {
    container.classList.add('color-chooser');
    const showMark = key => {
        markSwatch(grid, key);
        if (select) setColorSelect(select, key);
    };

    const apply = (choice, { save }) => {
        if (!choice) return;
        if (save) showMark(spaceColorKey(choice));
        onChoice(choice, { save });
    };

    const setPicking = picking => {
        container.classList.toggle('picking', picking);
        if (!picking && container.contains(document.activeElement)) grid.querySelector('.custom-color-swatch').focus();
        onPickingChange?.(picking);
    };
    const picker = createCustomColorPicker({
        onChange: (hex, group, { save }) => apply(customChoice(hex, group), { save }),
        onBack: () => setPicking(false)
    });
    container.append(picker.element);

    const openPicker = () => {
        const now = current();
        const key = spaceColorKey(now);
        const custom = normalizeHex(key);
        picker.show(custom ?? paletteEntry(key)?.light ?? LIGHT_SEED_FALLBACK, custom ? now.color : null);
        setPicking(true);
        picker.focus();
    };
    renderSwatches(grid, name => apply(choiceForKey(name), { save: true }), { onCustom: openPicker });
    if (select) fillColorSelect(select);
    showMark(spaceColorKey(current()));

    container.addEventListener('keydown', event => {
        if (event.key === 'Escape' && container.classList.contains('picking')) {
            event.stopPropagation();
            setPicking(false);
        }
    });

    return { apply, showMark, setPicking };
}
