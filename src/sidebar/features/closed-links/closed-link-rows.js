import { Utils } from '../../../shared/utils.js';
import { openPagesOf, visibleLinks } from '../../../shared/closed-links.js';
import { MOUSE_BUTTON } from '../../../shared/constants.js';
import { readClosedLinks, openClosedLink, removeClosedLink } from './closed-links-client.js';
import { Logger } from '../../../shared/logger.js';

export const closedLinkLabel = link => `${link.title || link.url} (closed link)`;

// A page closed with its window: dimmed, and nothing loads until it is picked. The name says
// "closed link", so the difference does not rest on colour. It is not a tab, so it cannot be dragged.
export function createClosedLinkRow(link, { open, remove }) {
    const row = document.createElement('div');
    row.className = 'closed-link';
    row.dataset.linkId = link.id;
    row.dataset.url = link.url;
    row.draggable = false;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.title = closedLinkLabel(link);
    row.setAttribute('aria-label', closedLinkLabel(link));

    const icon = document.createElement('img');
    icon.className = 'closed-link-favicon';
    icon.alt = '';
    icon.draggable = false;
    icon.onerror = () => {
        icon.onerror = null;
        icon.src = '/assets/default_icon.png';
    };
    icon.src = Utils.getFaviconUrl(link.url);

    const title = document.createElement('span');
    title.className = 'closed-link-title';
    title.textContent = link.title || link.url;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'closed-link-close';
    close.title = 'Remove link';
    close.setAttribute('aria-label', `Remove link to ${link.title || link.url}`);
    close.textContent = '×';

    row.append(icon, title, close);
    row.addEventListener('click', event => {
        if (event.target.closest('.closed-link-close') || (event.button ?? MOUSE_BUTTON.LEFT) !== MOUSE_BUTTON.LEFT)
            return;
        open(link);
    });
    row.addEventListener('keydown', event => {
        if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        open(link);
    });
    close.addEventListener('click', event => {
        event.stopPropagation();
        remove(link);
    });
    return row;
}

// Draws a space's links under its list. Incognito windows show none: they are never saved, and
// a private window should not list pages from the others.
export async function drawClosedLinks(spaceElement, { spaceId, invertTabOrder, windowId, incognito }) {
    const section = spaceElement?.querySelector('.closed-links');
    if (!section) return 0;
    const list = section.querySelector('.closed-links-list');
    let rows = [];
    if (!incognito) {
        const [links, tabs] = await Promise.all([readClosedLinks(), chrome.tabs.query({})]);
        rows = visibleLinks(links, spaceId, openPagesOf(tabs), { invertTabOrder });
    }
    const handlers = {
        open: link => openClosedLink(link.id, windowId).catch(error => Logger.warn('Could not open the link:', error)),
        remove: link => removeClosedLink(link.id).catch(error => Logger.warn('Could not remove the link:', error))
    };
    list.replaceChildren(...rows.map(link => createClosedLinkRow(link, handlers)));
    section.hidden = rows.length === 0;
    return rows.length;
}

// Redraws the open space's links when the stored links change, so every window's panel follows.
export function watchClosedLinks(redraw) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.closedLinks) redraw();
    });
}
