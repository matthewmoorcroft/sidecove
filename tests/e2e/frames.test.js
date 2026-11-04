import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Clicks, hovers, animations and screenshots in every suite need the test Chrome to draw frames.
// On macOS that holds while the display is asleep only through the flag the launch helper passes;
// if a Chrome update drops it, this test names the cause instead of leaving a run of timeouts.
let browser, extensionId;

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
});
afterAll(async () => {
    await browser?.close();
});

test('the test Chrome keeps drawing frames, even with the display asleep', async () => {
    const page = await openSidebar(browser, extensionId);
    const frames = await page.evaluate(
        () =>
            new Promise(resolve => {
                let count = 0;
                const tick = () => {
                    count++;
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
                setTimeout(() => resolve(count), 1000);
            })
    );
    if (frames < 10) {
        throw new Error(
            `Chrome drew ${frames} frames in 1 s. On macOS with the display asleep, check that ` +
                'launchBrowserWithExtension() still passes a flag this Chrome version knows ' +
                '(see tests/README.md, Tests Timeout).'
        );
    }
    await page.close();
});
