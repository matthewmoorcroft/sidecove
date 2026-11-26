import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Sidecove's own pages (settings, and the setup guide that opens after an update) are tabs the
// user reads, so the sidebar lists them like any other tab (#103). The side panel page itself
// never shows, even when opened in a tab as these tests do.
let server, base, browser, extensionId, page;
const opened = [];

beforeAll(async () => {
    server = createServer((req, res) => res.end(`<title>${req.url}</title>`));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
});

// Close what a test opened even when it timed out, so a failure cannot leak a tab into the next test.
afterEach(async () => {
    const ids = opened.splice(0);
    await page.evaluate(async ids => {
        for (const id of ids) await chrome.tabs.remove(id).catch(() => {});
    }, ids);
});

afterAll(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
});

const rowUrls = () => page.$$eval('.space.active .tab[data-tab-id]', rows => rows.map(row => row.dataset.url || ''));

test.each(['options.html', 'installation-onboarding.html'])('a %s tab is listed in the sidebar', async file => {
    const url = `chrome-extension://${extensionId}/${file}`;
    opened.push(await page.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, url));
    await page.waitForFunction(
        url => [...document.querySelectorAll('.space.active .tab[data-tab-id]')].some(row => row.dataset.url === url),
        { polling: 100, timeout: 10000 },
        url
    );
    expect(await rowUrls()).toContain(url);
});

test('the side panel page opened in a tab is not listed', async () => {
    const urls = await rowUrls();
    expect(urls.some(url => url.endsWith('/sidebar.html'))).toBe(false);
});

// Sidecove's own pages are listed like any tab, but Clear is for pages to archive: it leaves
// the settings tab open.
test('Clear closes ordinary tabs and leaves the settings tab open', async () => {
    const own = `chrome-extension://${extensionId}/options.html`;
    const ordinary = `${base}/clear-me`;
    for (const url of [own, ordinary])
        opened.push(await page.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, url));
    const listed = url =>
        page.evaluate(
            url =>
                [...document.querySelectorAll('.space.active .tab[data-tab-id]')].some(row => row.dataset.url === url),
            url
        );
    await page.waitForFunction(
        urls =>
            urls.every(u =>
                [...document.querySelectorAll('.space.active .tab[data-tab-id]')].some(r => r.dataset.url === u)
            ),
        { polling: 100, timeout: 10000 },
        [own, ordinary]
    );
    await page.$eval('.space.active .clean-tabs-btn', button => button.click());
    await page.waitForFunction(
        url => ![...document.querySelectorAll('.space.active .tab[data-tab-id]')].some(row => row.dataset.url === url),
        { polling: 100, timeout: 10000 },
        ordinary
    );
    expect(await listed(own)).toBe(true);
});
