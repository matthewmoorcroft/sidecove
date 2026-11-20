import { normalizeHex } from './color-math.js';
import { fillColorSelect, markSwatch, renderSwatches, setColorSelect } from './color-swatches.js';
import { createCustomColorPicker } from './custom-color-picker.js';
import { choiceForKey, customChoice, paletteEntry, spaceColorKey } from './space-palette.js';

const LIGHT_SEED_FALLBACK = '#cccccc';

// The colour part of a space's options menu: the 24 swatches, a Custom color row, and the
// picker it opens in place of the menu. `onChoice({ color, shade }, { save })` applies a choice;
// save is false for the live preview while the colour square is dragged.
export function setupSpaceColorMenu(root, space, onChoice) {
    const dropdown = root.querySelector('.space-options-dropdown');
    const container = root.querySelector('.space-options-container');
    const select = root.querySelector('.space-color-select');
    const grid = root.querySelector('.space-options-dropdown .color-picker-grid');
    // Clicks on the menu's text keep focus in it, so the menu stays open while it is used.
    dropdown.tabIndex = -1;

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'custom-color-row';
    const ring = document.createElement('span');
    ring.className = 'custom-color-ring';
    ring.setAttribute('aria-hidden', 'true');
    const label = Object.assign(document.createElement('span'), {
        className: 'custom-color-label',
        textContent: 'Custom color'
    });
    const value = Object.assign(document.createElement('span'), { className: 'custom-color-value' });
    const chevron = Object.assign(document.createElement('span'), {
        className: 'custom-color-chevron',
        textContent: '›'
    });
    chevron.setAttribute('aria-hidden', 'true');
    row.append(ring, label, value, chevron);
    grid.after(row);

    const showMark = key => {
        markSwatch(grid, key);
        setColorSelect(select, key);
        const custom = normalizeHex(key);
        row.classList.toggle('selected', Boolean(custom));
        row.setAttribute('aria-pressed', String(Boolean(custom)));
        if (custom) {
            const dot = document.createElement('i');
            dot.style.setProperty('--custom-chip', custom);
            value.replaceChildren(dot, custom.toUpperCase());
        } else value.replaceChildren();
    };

    const apply = (choice, { save }) => {
        if (!choice) return;
        if (save) showMark(spaceColorKey(choice));
        onChoice(choice, { save });
    };

    const setPicking = picking => {
        dropdown.classList.toggle('picking', picking);
        if (!picking && dropdown.contains(document.activeElement)) row.focus();
    };
    const picker = createCustomColorPicker({
        onChange: (hex, group, { save }) => apply(customChoice(hex, group), { save }),
        onBack: () => setPicking(false)
    });
    dropdown.append(picker.element);

    renderSwatches(grid, name => apply(choiceForKey(name), { save: true }));
    fillColorSelect(select);
    showMark(spaceColorKey(space));

    // The select mirrors the choice; changing it (as the chip's Theme Color menu does) applies it.
    select.addEventListener('change', () => apply(choiceForKey(select.value, space.color), { save: true }));

    row.addEventListener('click', e => {
        e.stopPropagation();
        const key = spaceColorKey(space);
        const custom = normalizeHex(key);
        picker.show(custom ?? paletteEntry(key)?.light ?? LIGHT_SEED_FALLBACK, custom ? space.color : null);
        setPicking(true);
        picker.focus();
    });

    // Leaving the menu closes the picker, so it opens on the colours next time.
    const closeIfLeft = () => {
        requestAnimationFrame(() => {
            if (!container.matches(':hover') && !container.contains(document.activeElement)) setPicking(false);
        });
    };
    container.addEventListener('pointerleave', closeIfLeft);
    container.addEventListener('focusout', closeIfLeft);
    dropdown.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dropdown.classList.contains('picking')) {
            e.stopPropagation();
            setPicking(false);
        }
    });

    return { showMark };
}
