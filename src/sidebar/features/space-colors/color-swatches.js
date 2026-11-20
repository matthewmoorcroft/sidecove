import { paintSpaceColor } from '../color-overrides/space-color-vars.js';
import { PALETTE } from './space-palette.js';

// Where an arrow key moves focus in a grid of count swatches, columns wide; null for other keys.
export function arrowTarget(index, key, columns, count) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -index }[key];
    if (key === 'End') return count - 1;
    if (step === undefined) return null;
    const next = index + step;
    return next >= 0 && next < count ? next : index;
}

// Fills grid with one swatch per palette colour. Each shows the colour as a space will look in
// the current mode (the stylesheet's own variable for the original eight, so Settings overrides
// show), is named for screen readers and on hover, and calls onPick(name) when chosen. The grid
// is one Tab stop; arrow keys move between swatches.
export function renderSwatches(grid, onPick) {
    grid.replaceChildren(
        ...PALETTE.map(colour => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.dataset.color = colour.name;
            swatch.dataset.tip = colour.label;
            swatch.setAttribute('role', 'button');
            swatch.setAttribute('tabindex', '-1');
            swatch.setAttribute('aria-label', colour.label);
            swatch.setAttribute('aria-pressed', 'false');
            paintSpaceColor(swatch, colour.name, { surface: '--swatch-color' });
            return swatch;
        })
    );
    const tip = document.createElement('span');
    tip.className = 'color-swatch-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    grid.append(tip);

    const show = swatch => {
        tip.textContent = swatch.dataset.tip;
        tip.style.left = `${swatch.offsetLeft + swatch.offsetWidth / 2}px`;
        tip.style.top = `${swatch.offsetTop}px`;
        tip.hidden = false;
    };
    const hide = () => (tip.hidden = true);
    const swatchOf = target => target?.closest?.('.color-swatch');
    grid.addEventListener('pointerover', e => swatchOf(e.target) && show(swatchOf(e.target)));
    grid.addEventListener('pointerout', e => !swatchOf(e.relatedTarget) && hide());
    grid.addEventListener('focusin', e => swatchOf(e.target) && show(swatchOf(e.target)));
    grid.addEventListener('focusout', hide);
    grid.addEventListener('click', e => {
        const swatch = swatchOf(e.target);
        if (swatch) onPick(swatch.dataset.color);
    });
    grid.addEventListener('keydown', e => {
        const swatch = swatchOf(e.target);
        if (!swatch) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(swatch.dataset.color);
            return;
        }
        const swatches = [...grid.querySelectorAll('.color-swatch')];
        const columns = swatches.filter(s => s.offsetTop === swatches[0].offsetTop).length || swatches.length;
        const next = arrowTarget(swatches.indexOf(swatch), e.key, columns, swatches.length);
        if (next === null) return;
        e.preventDefault();
        focusable(grid, swatches[next]);
        swatches[next].focus();
    });
    focusable(grid, grid.querySelector('.color-swatch'));
}

// The one swatch Tab reaches.
function focusable(grid, target) {
    for (const swatch of grid.querySelectorAll('.color-swatch'))
        swatch.setAttribute('tabindex', swatch === target ? '0' : '-1');
}

// Marks the swatch for key as chosen; a custom colour or unknown key marks none.
export function markSwatch(grid, key) {
    for (const swatch of grid.querySelectorAll('.color-swatch')) {
        const chosen = swatch.dataset.color === key;
        swatch.classList.toggle('selected', chosen);
        swatch.setAttribute('aria-pressed', String(chosen));
    }
    focusable(grid, grid.querySelector('.color-swatch.selected') ?? grid.querySelector('.color-swatch'));
}

// The options of a hidden select that mirrors the choice, which other code and tests read:
// one per palette colour, and one for a custom colour whose value is its hex.
export function fillColorSelect(select) {
    select.replaceChildren(
        ...PALETTE.map(colour => new Option(colour.label, colour.name)),
        Object.assign(new Option('Custom color', ''), { className: 'custom-color-option', hidden: true })
    );
}

export function setColorSelect(select, key) {
    const custom = select.querySelector('.custom-color-option');
    const isPalette = PALETTE.some(colour => colour.name === key);
    if (custom) custom.value = isPalette ? '' : (key ?? '');
    select.value = key ?? '';
}
