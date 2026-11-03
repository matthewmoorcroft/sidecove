/**
 * Copy the last-focused tab URL from the MV3 service worker.
 *
 * Clipboard APIs are unavailable in a service worker, so the copy goes through
 * an offscreen document. An open sidebar is the fallback when that fails. The
 * extension never injects scripts into pages, so it needs no scripting access.
 */
export async function copyCurrentTabUrlWithFallback({ chromeApi = globalThis.chrome, logger = console } = {}) {
    try {
        const [tab] = await chromeApi.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id || !tab.url) {
            logger.error?.('[URLCopy] No active tab found');
            return false;
        }

        try {
            if (chromeApi.offscreen?.createDocument) {
                const offscreenUrl = chromeApi.runtime.getURL('offscreen.html');
                const contexts = await chromeApi.runtime.getContexts?.({
                    contextTypes: ['OFFSCREEN_DOCUMENT'],
                    documentUrls: [offscreenUrl]
                });
                if (!contexts?.length) {
                    await chromeApi.offscreen.createDocument({
                        url: 'offscreen.html',
                        reasons: ['CLIPBOARD'],
                        justification: 'Copy the current tab URL from a keyboard shortcut.'
                    });
                }
                const response = await chromeApi.runtime.sendMessage({
                    target: 'offscreen',
                    type: 'copyToClipboard',
                    text: tab.url
                });
                if (response?.success !== true) throw new Error(response?.error || 'Offscreen clipboard copy failed');
                await chromeApi.offscreen.closeDocument?.();
                try { chromeApi.runtime.sendMessage({ action: 'urlCopySuccess' }); } catch (notifyError) {
                    logger.log?.('[URLCopy] Could not notify sidebar:', notifyError);
                }
                return true;
            }
        } catch (offscreenError) {
            logger.log?.('[URLCopy] Offscreen clipboard failed, trying the sidebar:', offscreenError);
        }

        try {
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Sidebar timeout')), 1000);
                chromeApi.runtime.sendMessage({ command: 'copyCurrentUrl', url: tab.url }, result => {
                    clearTimeout(timeout);
                    if (chromeApi.runtime.lastError) reject(chromeApi.runtime.lastError);
                    else resolve(result);
                });
            });
            return response?.success === true;
        } catch (sidebarError) {
            logger.error?.('[URLCopy] Both the offscreen document and the sidebar failed:', sidebarError);
            return false;
        }
    } catch (error) {
        logger.error?.('[URLCopy] Failed to copy URL:', error);
        return false;
    }
}
