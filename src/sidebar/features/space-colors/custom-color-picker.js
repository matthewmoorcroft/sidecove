import { hexToHsv, hexToRgb, hsvToHex, luminance, normalizeHex } from './color-math.js';
import { nearestChromeColor, readableSurface, textContrast } from './readable-surface.js';
import { CHROME_COLOR_NAMES, chromeColorLabel } from './space-palette.js';

const html = (tag, className, attrs = {}) => Object.assign(document.createElement(tag), { className }, attrs);

// What the picker says about the surfaces it will paint for a colour.
export function surfaceNote(seed, light, dark) {
    const parts = [];
    if (light === seed) parts.push('Light mode uses your color exactly.');
    else if (luminance(hexToRgb(light)) > luminance(hexToRgb(seed)))
        parts.push('Light mode: lightened just enough for the text.');
    else parts.push('Light mode: toned down a little so all text stays readable.');
    if (dark === seed) parts.push('Dark mode uses it exactly.');
    else parts.push('Dark mode: a deep version of the same hue, as every Sidecove color is.');
    return parts.join(' ');
}

// Any colour: a saturation and brightness square, a hue slider and a hex field, with how the
// space will look in light and dark mode. `onChange(hex, group, { save })` reports each change;
// save is false while the square is being dragged. `group` is a Chrome colour name, or null for
// the nearest one.
export function createCustomColorPicker({ onChange, onBack }) {
    const root = html('div', 'custom-color-picker');
    const head = html('div', 'custom-color-head');
    const back = html('button', 'custom-color-back', {
        type: 'button',
        textContent: '‹',
        title: 'Back to the colors'
    });
    back.setAttribute('aria-label', 'Back to the colors');
    head.append(back, html('span', '', { textContent: 'Custom color' }));

    const square = html('div', 'custom-color-square', { tabIndex: 0 });
    square.setAttribute('role', 'slider');
    square.setAttribute('aria-label', 'Saturation and brightness');
    const thumb = html('span', 'custom-color-thumb');
    square.append(thumb);

    const hue = html('input', 'custom-color-hue', { type: 'range', min: 0, max: 360, step: 1 });
    hue.setAttribute('aria-label', 'Hue');

    const hexRow = html('div', 'custom-color-hex-row');
    const chip = html('span', 'custom-color-chip');
    const hex = html('input', 'custom-color-hex', { type: 'text', maxLength: 7, spellcheck: false });
    hex.setAttribute('aria-label', 'Hex color');
    hexRow.append(chip, hex);

    const preview = html('div', 'custom-color-preview');
    const light = html('div', 'preview-light');
    const dark = html('div', 'preview-dark');
    preview.append(light, dark);
    const note = html('div', 'custom-color-note');

    const groupRow = html('label', 'custom-color-group');
    const group = html('select', 'custom-color-group-select');
    group.append(new Option('Auto', 'auto'), ...CHROME_COLOR_NAMES.map(n => new Option(chromeColorLabel(n), n)));
    groupRow.append(html('span', '', { textContent: 'Tab group' }), group);

    root.append(head, square, hue, hexRow, preview, note, groupRow);

    const state = { seed: '#cccccc', hsv: hexToHsv('#cccccc'), group: 'auto' };
    const chosenGroup = () => (state.group === 'auto' ? null : state.group);

    function render() {
        const { h, s, v } = state.hsv;
        square.style.setProperty('--picker-hue', Math.round(h));
        square.setAttribute('aria-valuetext', `Saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);
        thumb.style.left = `${s * 100}%`;
        thumb.style.top = `${(1 - v) * 100}%`;
        thumb.style.background = state.seed;
        hue.value = String(Math.round(h));
        if (document.activeElement !== hex) hex.value = state.seed.toUpperCase();
        chip.style.setProperty('--custom-chip', state.seed);
        const surfaces = { light: readableSurface(state.seed, 'light'), dark: readableSurface(state.seed, 'dark') };
        preview.style.setProperty('--preview-light', surfaces.light);
        preview.style.setProperty('--preview-dark', surfaces.dark);
        light.replaceChildren(
            html('b', '', { textContent: 'Light' }),
            html('span', '', { textContent: `${textContrast('light', surfaces.light).toFixed(1)}:1` })
        );
        dark.replaceChildren(
            html('b', '', { textContent: 'Dark' }),
            html('span', '', { textContent: `${textContrast('dark', surfaces.dark).toFixed(1)}:1` })
        );
        note.textContent = surfaceNote(state.seed, surfaces.light, surfaces.dark);
        group.options[0].textContent = `Auto (${chromeColorLabel(nearestChromeColor(state.seed))})`;
        group.value = state.group;
    }

    function setSeed(seed, { fromHsv = false, save = true } = {}) {
        state.seed = seed;
        if (!fromHsv) state.hsv = hexToHsv(seed);
        render();
        onChange(state.seed, chosenGroup(), { save });
    }

    const fromHsv = save => setSeed(hsvToHex(state.hsv.h, state.hsv.s, state.hsv.v), { fromHsv: true, save });

    function pointAt(e) {
        const r = square.getBoundingClientRect();
        const clamp = x => Math.min(1, Math.max(0, x));
        state.hsv = {
            ...state.hsv,
            s: clamp((e.clientX - r.left) / r.width),
            v: clamp(1 - (e.clientY - r.top) / r.height)
        };
    }
    square.addEventListener('pointerdown', e => {
        e.preventDefault();
        square.focus();
        square.setPointerCapture?.(e.pointerId);
        pointAt(e);
        fromHsv(false);
    });
    square.addEventListener('pointermove', e => {
        if (!square.hasPointerCapture?.(e.pointerId)) return;
        pointAt(e);
        fromHsv(false);
    });
    const release = e => {
        if (!square.hasPointerCapture?.(e.pointerId)) return;
        square.releasePointerCapture(e.pointerId);
        fromHsv(true);
    };
    square.addEventListener('pointerup', release);
    square.addEventListener('pointercancel', release);
    square.addEventListener('keydown', e => {
        const step = e.shiftKey ? 0.1 : 0.02;
        const moves = {
            ArrowLeft: ['s', -step],
            ArrowRight: ['s', step],
            ArrowUp: ['v', step],
            ArrowDown: ['v', -step]
        };
        const move = moves[e.key];
        if (!move) return;
        e.preventDefault();
        const [axis, by] = move;
        state.hsv = { ...state.hsv, [axis]: Math.min(1, Math.max(0, state.hsv[axis] + by)) };
        fromHsv(true);
    });
    hue.addEventListener('input', () => {
        state.hsv = { ...state.hsv, h: Number(hue.value) };
        fromHsv(false);
    });
    hue.addEventListener('change', () => fromHsv(true));
    hex.addEventListener('input', () => {
        const typed = normalizeHex(hex.value);
        if (typed) setSeed(typed);
    });
    hex.addEventListener('blur', render);
    group.addEventListener('change', () => {
        state.group = group.value;
        onChange(state.seed, chosenGroup(), { save: true });
    });
    back.addEventListener('click', e => {
        e.stopPropagation();
        onBack();
    });

    return {
        element: root,
        // Starts from a colour without reporting a change. groupColor is the space's stored tab
        // group colour when it was chosen by hand, else null.
        show(seed, groupColor = null) {
            state.seed = normalizeHex(seed) ?? '#cccccc';
            state.hsv = hexToHsv(state.seed);
            state.group = groupColor && groupColor !== nearestChromeColor(state.seed) ? groupColor : 'auto';
            render();
        },
        focus: () => square.focus()
    };
}
