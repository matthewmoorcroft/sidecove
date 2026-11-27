// Sidecove's own pages, matched by address. A page's address is its file, with an optional query
// or hash after it (the practice page carries its lesson in the hash).
// Pass `runtime` where the global `chrome` is not the one in use (modules that take chrome as an argument).
export function isExtensionPage(url, file, runtime = globalThis.chrome?.runtime) {
    const page = runtime?.getURL?.(file);
    return Boolean(page && url && (url === page || url.startsWith(`${page}?`) || url.startsWith(`${page}#`)));
}

// The side panel itself. It is never a tab the user reads, even though tests and debugging open it in one.
export const isSidePanelPage = url => isExtensionPage(url, 'sidebar.html');

// The settings page and the setup guide: pages the user opens as tabs and keeps. They sit in the
// tab list like any other tab, but Sidecove never closes them on its own (see favorite-safety.js).
const OWN_PAGES = ['options.html', 'installation-onboarding.html'];
export const isOwnPageUrl = (url, runtime) => OWN_PAGES.some(file => isExtensionPage(url, file, runtime));
