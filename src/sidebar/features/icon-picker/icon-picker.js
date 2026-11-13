/**
 * Icon picker - draws a space or folder icon and lets the user choose one: monochrome
 * symbols and emoji from space-icons.js, searchable, or any typed emoji.
 */

import { normalizeSpaceIcon, spaceSymbol, searchSpaceIcons, isTypedEmoji } from '../../space-icons.js';
import { drawSpaceIcon } from '../space-icons/draw-space-icon.js';
import { Utils } from '../../../shared/utils.js';

// The symbol and emoji picker that spaces and folders share. onChoose gets the chosen icon,
// or null for Remove Icon; current is the icon shown as selected.
export function showIconPicker({ label, current = null, anchor, onChoose }) {
    document.getElementById('spaceIconPicker')?.remove();
    const picker = document.createElement('div');
    picker.id = 'spaceIconPicker';
    picker.className = 'space-icon-picker';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', label);
    const close = () => {
        picker.remove();
        document.removeEventListener('mousedown', onOutside, true);
    };
    const choose = async icon => {
        close();
        try {
            await onChoose(icon);
        } catch (error) {
            alert(error.message);
        }
    };
    const onOutside = event => {
        if (!picker.contains(event.target)) close();
    };

    // Monochrome symbols first, as in Arc, then emoji; the search box filters both by name
    // and keyword, and a typed emoji can be used as it is.
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'space-icon-custom';
    search.placeholder = 'Search, or type an emoji';
    search.setAttribute('aria-label', 'Search icons, or type an emoji');
    const results = document.createElement('div');
    results.className = 'space-icon-results';
    const section = (title, icons) => {
        if (!icons.length) return [];
        const heading = document.createElement('p');
        heading.className = 'space-icon-heading';
        heading.textContent = title;
        const grid = document.createElement('div');
        grid.className = 'space-icon-grid';
        for (const icon of icons) {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = 'space-icon-choice';
            choice.classList.toggle('selected', icon === current);
            choice.title = spaceSymbol(icon)?.label || '';
            drawSpaceIcon(choice, icon);
            choice.addEventListener('click', () => choose(icon));
            grid.appendChild(choice);
        }
        return [heading, grid];
    };
    const showResults = () => {
        const found = searchSpaceIcons(search.value);
        const empty = document.createElement('p');
        empty.className = 'space-icon-empty';
        empty.textContent = isTypedEmoji(search.value) ? 'Press Enter to use this emoji' : 'No icons match';
        const sections = [...section('Symbols', found.symbols), ...section('Emoji', found.emoji)];
        results.replaceChildren(...(sections.length ? sections : [empty]));
    };
    search.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
            return;
        }
        if (event.key !== 'Enter') return;
        const first = results.querySelector('.space-icon-choice');
        if (isTypedEmoji(search.value)) choose(normalizeSpaceIcon(search.value));
        else if (first && search.value.trim()) first.click();
        else search.classList.add('invalid');
    });
    search.addEventListener('input', () => {
        search.classList.remove('invalid');
        showResults();
    });
    showResults();
    picker.append(search, results);
    if (current) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'space-icon-remove';
        remove.textContent = 'Remove Icon';
        remove.addEventListener('click', () => choose(null));
        picker.appendChild(remove);
    }
    picker.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    });
    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    Utils.adjustMenuPosition(picker, Math.max(8, rect.left - 4), rect.bottom + 6);
    document.addEventListener('mousedown', onOutside, true);
    (results.querySelector('.selected') || search).focus();
}
