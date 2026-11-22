import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Sidecove's own pages (settings, and the setup guide that opens after an update) are tabs the
// user reads, so the sidebar lists them like any other tab (#103). The side panel page itself
// never shows, even when opened in a tab as these tests do.
let browser, extensionId, page;

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
});

afterAll(async () => {
    await browser?.close();
});

const rowUrls = () => page.$$eval('.space.active .tab[data-tab-id]', rows => rows.map(row => row.dataset.url || ''));

test.each(['options.html', 'installation-onboarding.html'])('a %s tab is listed in the sidebar', async file => {
    const url = `chrome-extension://${extensionId}/${file}`;
    const tabId = await page.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, url);
    await page.waitForFunction(
        url => [...document.querySelectorAll('.space.active .tab[data-tab-id]')].some(row => row.dataset.url === url),
        { polling: 100, timeout: 10000 },
        url
    );
    expect(await rowUrls()).toContain(url);
    await page.evaluate(id => chrome.tabs.remove(id), tabId);
});

test('the side panel page opened in a tab is not listed', async () => {
    const urls = await rowUrls();
    expect(urls.some(url => url.endsWith('/sidebar.html'))).toBe(false);
});
