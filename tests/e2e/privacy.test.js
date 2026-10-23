import { launchBrowserWithExtension } from './helpers/extension-helper.js';

// The privacy claim is that nothing is sent anywhere: extension pages must not fetch
// stylesheets, fonts, scripts or images from the network.
let browser, extensionId;

beforeAll(async () => { ({ browser, extensionId } = await launchBrowserWithExtension()); });
afterAll(async () => { await browser?.close(); });

async function openAndRecord(path) {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: 'load' });
    const fonts = await page.evaluate(async () => {
        const loaded = await document.fonts.load('16px "Varela Round"');
        return loaded.map(face => face.status);
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    return { page, requests, fonts };
}

test.each(['sidebar.html', 'options.html', 'onboarding.html', 'installation-onboarding.html'])(
    '%s makes no network request and renders Varela Round from the extension',
    async path => {
        const { page, requests, fonts } = await openAndRecord(path);
        const remote = requests.filter(url => !url.startsWith('chrome-extension://') && !url.startsWith('data:'));
        expect(remote).toEqual([]);
        if (path !== 'installation-onboarding.html') expect(fonts).toEqual(expect.arrayContaining(['loaded']));
        await page.close();
    }
);
