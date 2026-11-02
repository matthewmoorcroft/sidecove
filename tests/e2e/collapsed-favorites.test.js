import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Reported on 1.1.0: favorites hidden by collapsing a space's Favorites section could still be
// clicked (opening "random links") and reached with Tab.
let browser, page, server, base;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tabCount = () => page.evaluate(async () => (await chrome.tabs.query({})).length);

beforeAll(async () => {
    server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>${req.url}</title>`); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    await page.evaluate(async base => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        for (const name of ['one', 'two', 'three', 'four']) {
            await chrome.bookmarks.create({ parentId: spaces[0].bookmarkFolderId, title: `Hidden ${name}`, url: `${base}/hidden-${name}` });
        }
    }, base);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.space.active [data-tab-type="pinned"] .bookmark-only');
    await sleep(800);
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

test('favorites hidden by collapsing the Favorites section cannot be clicked or focused', async () => {
    await page.bringToFront();
    const spots = await page.$$eval('.space.active [data-tab-type="pinned"] .bookmark-only', rows => rows.map(row => {
        const r = row.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }));
    expect(spots.length).toBe(4);
    await page.$eval('.space.active .space-toggle-chevron', button => button.click());
    await page.waitForSelector('.space.active .pinned-tabs.collapsed');
    await sleep(400);

    // Nothing of the hidden section is under the pointer where its rows used to be.
    const hits = await page.evaluate(spots => spots.map(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.pinned-tabs'))), spots);
    expect(hits).toEqual(spots.map(() => false));
    const before = await tabCount();
    for (const { x, y } of spots) await page.mouse.click(x, y);
    await sleep(800);
    expect(await tabCount()).toBe(before);

    // Keyboard focus skips the hidden rows too.
    await page.focus('#tabSearchInput');
    let reachedHidden = false;
    for (let i = 0; i < 25 && !reachedHidden; i++) {
        await page.keyboard.press('Tab');
        reachedHidden = await page.evaluate(() => Boolean(document.activeElement?.closest('.pinned-tabs.collapsed')));
    }
    expect(reachedHidden).toBe(false);

    // Expanding brings the favorites back, and they open as before.
    await page.$eval('.space.active .space-toggle-chevron', button => button.click());
    await page.waitForSelector('.space.active .pinned-tabs:not(.collapsed)');
    await sleep(400);
    await page.mouse.click(spots[0].x, spots[0].y);
    await page.waitForFunction(count => chrome.tabs.query({}).then(tabs => tabs.length === count + 1), { polling: 100 }, before);
});

test('New Folder with Favorites collapsed opens the section and shows the new folder', async () => {
    // Start from a settled panel, so activity from the test above cannot interleave.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.space.active [data-tab-type="pinned"] .bookmark-only');
    await sleep(800);
    await page.bringToFront();
    if (!await page.$('.space.active .pinned-tabs.collapsed')) await page.$eval('.space.active .space-toggle-chevron', button => button.click());
    await page.waitForSelector('.space.active .pinned-tabs.collapsed');
    const before = await page.$$eval('.space.active .folder', els => els.map(el => el.dataset.bookmarkId));
    await page.$eval('.space.active .new-folder-btn', button => button.click());
    await page.waitForSelector('.space.active .pinned-tabs:not(.collapsed)');
    // The new folder is on screen, not inside a hidden section.
    const shown = () => page.evaluate(before => {
        const folder = [...document.querySelectorAll('.space.active .folder')].find(el => el.dataset.bookmarkId && !before.includes(el.dataset.bookmarkId));
        const header = folder?.querySelector(':scope > .folder-header');
        if (!header) return { found: false };
        const r = header.getBoundingClientRect();
        return { found: true, visible: getComputedStyle(header).visibility === 'visible' && r.height > 0, hit: Boolean(document.elementFromPoint(r.left + 20, r.top + r.height / 2)?.closest('.folder') === folder) };
    }, before);
    await page.waitForFunction(before => [...document.querySelectorAll('.space.active .folder')].some(el => el.dataset.bookmarkId && !before.includes(el.dataset.bookmarkId)), { polling: 100 }, before);
    await page.$eval('.space.active .folder:last-of-type', el => el.scrollIntoView({ block: 'center' }));
    await sleep(300);
    const state = await shown();
    if (!state.visible) console.log('New folder state:', JSON.stringify(state), await page.$eval('.space.active .pinned-tabs', el => el.className));
    expect(state).toEqual({ found: true, visible: true, hit: true });
});
