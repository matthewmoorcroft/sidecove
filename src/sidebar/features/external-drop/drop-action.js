// What a drag from outside the sidebar (a link or some selected text on a page) should do.
// Pure: it reads a DataTransfer-like object and returns the address to open.

// A fixed address, so no new permission is needed (chrome.search would need `search`).
export const SEARCH_URL = 'https://www.google.com/search?q=';

const parseWebUrl = text => {
    try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
};

// What the pointer is carrying, from the type list alone (the data itself is hidden until drop).
// 'link', 'text', 'files' for a file with nothing to open, or null when it is none of these.
export function dragKind(types) {
    const list = Array.from(types ?? []);
    if (list.includes('text/uri-list')) return 'link';
    if (list.includes('text/plain')) return 'text';
    return list.includes('Files') ? 'files' : null;
}

// The tab to open for a drop, or null to ignore it. Only web addresses open: a page cannot
// make the sidebar open chrome:, file: or javascript: addresses.
export function dropAction(dataTransfer) {
    const kind = dragKind(dataTransfer?.types);
    if (kind === 'link') {
        const first = dataTransfer
            .getData('text/uri-list')
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line && !line.startsWith('#'));
        const url = first && parseWebUrl(first);
        return url ? { url } : null;
    }
    if (kind === 'text') {
        const text = dataTransfer.getData('text/plain').trim();
        if (!text) return null;
        // A selected address is a link in all but name.
        const url = !/\s/.test(text) && parseWebUrl(text);
        return { url: url || SEARCH_URL + encodeURIComponent(text) };
    }
    return null;
}
