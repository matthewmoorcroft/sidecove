import { Utils } from '../../../shared/utils.js';
import { MOUSE_BUTTON } from '../../../shared/constants.js';

export const notOpenLabel = title => `${title} (not open)`;

// A saved favorite with no tab in this window. It is dimmed and says "not open" in its name, so
// it does not rely on colour; nothing loads until it is picked. It cannot be dragged, as there is
// no tab to move.
export function createSavedFavoriteIcon(favorite, { open, showMenu }) {
    const element = document.createElement('div');
    element.className = 'pinned-favicon saved-favorite';
    element.dataset.favoriteId = favorite.id;
    element.draggable = false;
    element.setAttribute('role', 'button');
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    element.appendChild(img);
    refreshSavedFavoriteIcon(element, favorite);

    element.addEventListener('mousedown', event => {
        if (event.button === MOUSE_BUTTON.LEFT) open(favorite);
    });
    element.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
        showMenu(event, favorite);
    });
    return element;
}

// The title arrives once the favorite's page has loaded somewhere, after the icon was drawn.
export function refreshSavedFavoriteIcon(element, favorite) {
    const label = notOpenLabel(favorite.title || favorite.url);
    if (element.title !== label) {
        element.title = label;
        element.setAttribute('aria-label', label);
    }
    const img = element.querySelector('img');
    if (!img || img.dataset.page === favorite.url) return;
    img.dataset.page = favorite.url;
    img.onerror = () => {
        img.onerror = null;
        img.src = '/assets/default_icon.png';
    };
    img.src = Utils.getFaviconUrl(favorite.url, '96');
}
