import { spaceSymbol } from '../../space-icons.js';

// Draws an icon into element: a symbol as an SVG in the current text colour, anything else
// as text. Symbols are built from Sidecove's own shape data, never from markup.
export function drawSpaceIcon(element, icon) {
    const symbol = spaceSymbol(icon);
    if (!symbol) {
        element.textContent = icon;
        return;
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'space-symbol');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of symbol.nodes) {
        const shape = document.createElementNS(ns, tag);
        for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
        svg.appendChild(shape);
    }
    element.replaceChildren(svg);
}
