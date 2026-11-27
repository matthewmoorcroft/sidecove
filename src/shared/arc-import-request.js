// The setup guide asks the sidebar to open Import from Arc: it leaves this note in local storage
// and the sidebar, which may only be opening now, takes it and shows the panel. Nothing else
// is stored, and a note nobody takes is harmless.
export const ARC_IMPORT_REQUEST_KEY = 'arcImportRequested';

export const requestArcImport = () => chrome.storage.local.set({ [ARC_IMPORT_REQUEST_KEY]: Date.now() });

// Calls `open` once for each request, now if one is waiting and again whenever another arrives.
export function watchArcImportRequests(open) {
    const take = async () => {
        const stored = await chrome.storage.local.get(ARC_IMPORT_REQUEST_KEY);
        if (!stored[ARC_IMPORT_REQUEST_KEY]) return;
        await chrome.storage.local.remove(ARC_IMPORT_REQUEST_KEY);
        open();
    };
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[ARC_IMPORT_REQUEST_KEY]?.newValue) take().catch(() => {});
    });
    return take();
}
