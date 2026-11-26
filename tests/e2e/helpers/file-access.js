import { closeSetupGuide } from './extension-helper.js';

/**
 * Turn off "Allow access to file URLs" for the extension, as it is for most users. Chrome gives
 * it to an extension loaded from the command line, so a test about local files has to take it
 * away first. Chrome reloads the extension when the setting changes.
 */
export async function turnOffFileAccess(browser, extensionId) {
    const page = await browser.newPage();
    await page.goto('chrome://extensions/');
    await page.evaluate(async id => {
        // Chrome keeps a reloaded unpacked extension disabled unless Developer mode is on.
        await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
        await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, fileAccess: false });
    }, extensionId);
    await page.close();
    // The reloaded extension answers again once its worker is back.
    const probe = await browser.newPage();
    try {
        await probe.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
        await probe.waitForFunction(async () => (await chrome.extension.isAllowedFileSchemeAccess()) === false, {
            polling: 200,
            timeout: 20000
        });
    } finally {
        await probe.close();
    }
    // The reload runs the extension's install handler again, which opens the setup guide.
    await closeSetupGuide(browser, extensionId);
}
