import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// A tab belongs to a favorite only on exactly the favorite's link. The same page with another
// query (another video, another search) is a different link and stays its own tab.
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

test('a new tab on the same page with a different link stays its own tab', async () => {
    const id = await openTab(`${base}/watch?v=second`);
    await page.waitForSelector(temporaryRow(id));
    await sleep(800);
    expect(await page.$(temporaryRow(id))).not.toBeNull();
    expect(await page.$(`${favoriteRow()}.bookmark-only`)).not.toBeNull();
    expect(await bindingOf(id)).toBeNull();
    await page.evaluate(id => chrome.tabs.remove(id), id);
});

test('clicking a favorite opens its own link rather than taking over a tab on a different one', async () => {
    const other = await openTab(`${base}/watch?v=second`);
    await page.waitForSelector(temporaryRow(other));
    await sleep(500);
    await page.click(`${favoriteRow()}.bookmark-only`);
    await page.waitForSelector(`${favoriteRow()}[data-tab-id]`);
    const opened = await page.$eval(favoriteRow(), row => Number(row.dataset.tabId));
    expect(opened).not.toBe(other);
    expect(await page.evaluate(id => chrome.tabs.get(id).then(tab => tab.url), opened)).toBe(`${base}/watch?v=first`);
    expect(await bindingOf(other)).toBeNull();
    await page.bringToFront();
    await page.evaluate(id => chrome.tabs.remove(id), other);
    await closeFavoriteTab();
});

test('a new tab on exactly a closed favorite\'s link opens as that favorite and stays in the background', async () => {
    const id = await openTab(`${base}/watch?v=first`);
    await page.waitForSelector(`${favoriteRow()}[data-tab-id="${id}"]`);
    expect(await bindingOf(id)).toBe(fixture.bookmarkId);
    expect(await page.$(temporaryRow(id))).toBeNull();
    expect(await page.evaluate(id => chrome.tabs.get(id).then(tab => tab.active), id)).toBe(false);
});

test('a favorite that is already open keeps its tab when another tab opens the same link', async () => {
    const first = await page.$eval(favoriteRow(), row => Number(row.dataset.tabId));
    const second = await openTab(`${base}/watch?v=first`);
    await page.waitForSelector(temporaryRow(second));
    await sleep(800);
    expect(await page.$eval(favoriteRow(), row => Number(row.dataset.tabId))).toBe(first);
    expect(await bindingOf(second)).toBeNull();
    await page.evaluate(id => chrome.tabs.remove(id), second);
    await closeFavoriteTab();
});
