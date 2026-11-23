import { SHADE_CLASS, paintSpaceColor } from '../color-overrides/space-color-vars.js';
import { normalizeHex } from './color-math.js';
import { PALETTE, spaceLook, wheelStops } from './space-palette.js';
import { arrowTarget, tipShift } from './swatch-geometry.js';

const CUSTOM = 'custom';
const CUSTOM_LABEL = 'Custom color';
// Each grid's tip, so markSwatch can refresh one that shows a name it changes.
const tips = new WeakMap();

// The horizontal edges the tip is clipped to: its nearest ancestor that clips overflow (the
// spaces list, inside the panel's padding), else the panel itself.
function clipEdges(element) {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).overflowX !== 'visible') {
            const { left, right } = node.getBoundingClientRect();
            return { left, right };
        }
    }
    return { left: 0, right: document.documentElement.clientWidth };
}

function makeSwatch(name, label) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.dataset.color = name;
    swatch.dataset.tip = label;
    swatch.setAttribute('role', 'button');
    swatch.setAttribute('tabindex', '-1');
    swatch.setAttribute('aria-label', label);
    swatch.setAttribute('aria-pressed', 'false');
    return swatch;
}

// Fills grid with one swatch per palette colour. Each shows the colour as a space will look in
// the current mode (the stylesheet's own variable for the original eight, so Settings overrides
// show), is named for screen readers and on hover, and calls onPick(name) when chosen. With
// onCustom, a last circle in the same grid stands for any other colour. The grid is one Tab
// stop; arrow keys move between swatches.
export function renderSwatches(grid, onPick, { onCustom } = {}) {
    const swatches = PALETTE.map(colour => {
        const swatch = makeSwatch(colour.name, colour.label);
        paintSpaceColor(swatch, colour.name, { surface: '--swatch-color' });
        return swatch;
    });
    if (onCustom) {
        const custom = makeSwatch(CUSTOM, CUSTOM_LABEL);
        custom.classList.add('custom-color-swatch');
        custom.style.setProperty('--wheel-light', wheelStops('light').join(', '));
        custom.style.setProperty('--wheel-dark', wheelStops('dark').join(', '));
        swatches.push(custom);
    }
    const choose = swatch => (swatch.dataset.color === CUSTOM ? onCustom() : onPick(swatch.dataset.color));
    grid.replaceChildren(...swatches);
    const tip = document.createElement('span');
    tip.className = 'color-swatch-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.hidden = true;
    grid.append(tip);

    const show = swatch => {
        const centre = swatch.offsetLeft + swatch.offsetWidth / 2;
        tip.textContent = swatch.dataset.tip;
        tip.style.left = `${centre}px`;
        tip.style.top = `${swatch.offsetTop}px`;
        tip.hidden = false;
        // A name at the end of a row (the custom colour's hex is the longest) would run past the
        // panel's edge, so it moves back inside.
        const { left, right } = tip.getBoundingClientRect();
        const edges = clipEdges(grid);
        const shift = tipShift(left, right, edges.left, edges.right);
        if (shift) tip.style.left = `${centre + shift}px`;
        tips.set(grid, { show, shownFor: swatch });
    };
    const hide = () => {
        tip.hidden = true;
        tips.delete(grid);
    };
    const swatchOf = target => target?.closest?.('.color-swatch');
    grid.addEventListener('pointerover', e => swatchOf(e.target) && show(swatchOf(e.target)));
    grid.addEventListener('pointerout', e => !swatchOf(e.relatedTarget) && hide());
    grid.addEventListener('focusin', e => swatchOf(e.target) && show(swatchOf(e.target)));
    grid.addEventListener('focusout', hide);
    grid.addEventListener('click', e => {
        const swatch = swatchOf(e.target);
        if (swatch) choose(swatch);
    });
    grid.addEventListener('keydown', e => {
        const swatch = swatchOf(e.target);
        if (!swatch) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose(swatch);
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

// Marks the swatch for key as chosen. A custom colour marks the custom circle, which then
// shows that colour as the space looks in the current mode, and its hex in its name.
export function markSwatch(grid, key) {
    const hex = normalizeHex(key);
    for (const swatch of grid.querySelectorAll('.color-swatch')) {
        const chosen = swatch.dataset.color === CUSTOM ? Boolean(hex) : swatch.dataset.color === key;
        swatch.classList.toggle('selected', chosen);
        swatch.setAttribute('aria-pressed', String(chosen));
    }
    const custom = grid.querySelector('.custom-color-swatch');
    if (custom) {
        const label = hex ? `${CUSTOM_LABEL} ${hex.toUpperCase()}` : CUSTOM_LABEL;
        custom.dataset.tip = label;
        custom.setAttribute('aria-label', label);
        // A tip already naming the circle shows the new name, kept inside the panel.
        const shown = tips.get(grid);
        if (shown?.shownFor === custom) shown.show(custom);
        if (hex) paintSpaceColor(custom, spaceLook({ shade: hex }), { surface: '--custom-fill' });
        else {
            custom.classList.remove(SHADE_CLASS);
            custom.style.removeProperty('--custom-fill');
        }
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
