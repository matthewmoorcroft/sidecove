// Fills a "Move to Space" entry: the space's icon, drawn as the space chips draw it, then its
// name. A space without an icon is just its name, as before.
export function fillSpaceMenuItem(item, name, icon, drawIcon, doc = document) {
    if (!icon) {
        item.textContent = name;
        return;
    }
    const iconElement = doc.createElement('span');
    iconElement.className = 'context-menu-space-icon';
    // The name alone is the entry's accessible name.
    iconElement.setAttribute('aria-hidden', 'true');
    drawIcon(iconElement, icon);
    const label = doc.createElement('span');
    label.textContent = name;
    item.replaceChildren(iconElement, label);
}
