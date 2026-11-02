import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Reported on 1.1.0: a link opened from another app could land in the first space instead of
// the one in use, whenever it arrived in a window Sidecove had no space recorded for.
let browser, page, server, base;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

beforeAll(async () => {
    server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>${req.url}</title>`); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#spaceSwitcher button');
    await sleep(800);
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

test('a link that opens in a new window lands in the space last in use, not the first one', async () => {
    await page.bringToFront();
    await page.$eval('#addSpaceBtn', b => b.click());
    await page.$eval('#newSpaceName', el => { el.value = 'Work'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('#createSpaceBtn', b => b.click());
    await page.waitForFunction(() => document.querySelector('.space.active .space-name')?.value === 'Work', { polling: 100 });
    await sleep(500);
    // Chrome opens a link from another app in a new window when none is open; that window
    // has no space of its own yet.
    const landed = await page.evaluate(async url => {
        const win = await chrome.windows.create({ url, focused: true });
        const tabId = win.tabs[0].id;
        for (let i = 0; i < 40; i++) {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const owner = spaces.find(s => s.temporaryTabs.includes(tabId) || s.spaceBookmarks.includes(tabId));
            if (owner) return owner.name;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
    }, `${base}/from-another-app`);
    expect(landed).toBe('Work');
});
