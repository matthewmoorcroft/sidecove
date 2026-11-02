import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// A favorite only ever owns the tab it opened. Clicking a closed favorite opens its own new
// tab, even when an unlinked tab already shows the same page or a page on the same path, and
// a tab opened from elsewhere never becomes a favorite's tab by itself.
let browser, page, server, base, fixture;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const favoriteRow = () => `.space.active [data-tab-type="pinned"] .tab[data-bookmark-id="${fixture.bookmarkId}"]`;
const temporaryRow = id => `.space.active [data-tab-type="temporary"] .tab[data-tab-id="${id}"]`;
const bindingOf = id => page.evaluate(async id => (await chrome.storage.local.get('pinnedTabStatesById')).pinnedTabStatesById?.[id]?.bookmarkId || null, id);
const openTab = url => page.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, url);
const closeFavoriteTab = async () => {
    const id = await page.$eval(favoriteRow(), row => Number(row.dataset.tabId));
    await page.evaluate(id => chrome.tabs.remove(id), id);
    await page.waitForSelector(`${favoriteRow()}.bookmark-only`);
};

beforeAll(async () => {
    server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>${req.url}</title>`); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    fixture = await page.evaluate(async base => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const bookmark = await chrome.bookmarks.create({ parentId: spaces[0].bookmarkFolderId, title: 'Video first', url: `${base}/watch?v=first` });
        return { bookmarkId: bookmark.id };
    }, base);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${favoriteRow()}.bookmark-only`);
    // Let the refresh after loading settle.
    await sleep(800);
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

test.each([
    ['exactly its link', '/watch?v=first'],
    ['the same page with a different link', '/watch?v=second']
])('clicking a closed favorite opens its own tab while an unlinked tab shows %s', async (_label, path) => {
    const other = await openTab(`${base}${path}`);
    await page.waitForSelector(temporaryRow(other));
    await page.waitForFunction(async ({ id, url }) => (await chrome.tabs.get(id)).url === url, { polling: 100 }, { id: other, url: `${base}${path}` });
    const before = await page.evaluate(async () => (await chrome.tabs.query({})).length);
    await page.click(`${favoriteRow()}.bookmark-only`);
    await page.waitForSelector(`${favoriteRow()}[data-tab-id]`);
    const opened = await page.$eval(favoriteRow(), row => Number(row.dataset.tabId));
    expect(opened).not.toBe(other);
    expect(await page.evaluate(async () => (await chrome.tabs.query({})).length)).toBe(before + 1);
    expect(await bindingOf(other)).toBeNull();
    expect(await page.$(temporaryRow(other))).not.toBeNull();
    await page.bringToFront();
    await page.evaluate(id => chrome.tabs.remove(id), other);
    await closeFavoriteTab();
});

test('a tab opened from elsewhere on exactly a closed favorite\'s link stays an ordinary tab', async () => {
    const id = await openTab(`${base}/watch?v=first`);
    await page.waitForSelector(temporaryRow(id));
    await sleep(800);
    expect(await bindingOf(id)).toBeNull();
    expect(await page.$(temporaryRow(id))).not.toBeNull();
    expect(await page.$(`${favoriteRow()}.bookmark-only`)).not.toBeNull();
    await page.evaluate(id => chrome.tabs.remove(id), id);
});
