import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// A tab belongs to a favorite only on exactly the favorite's link. The same page with another
// query (another video, another search) is a different link and stays its own tab.
let browser, page, server, base, fixture;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const favoriteRow = () => `.space.active [data-tab-type="pinned"] .tab[data-bookmark-id="${fixture.bookmarkId}"]`;
const otherFavoriteRow = () => `.space.active [data-tab-type="pinned"] .tab[data-bookmark-id="${fixture.otherId}"]`;
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
        const other = await chrome.bookmarks.create({ parentId: spaces[0].bookmarkFolderId, title: 'Video third', url: `${base}/watch?v=third` });
        return { bookmarkId: bookmark.id, otherId: other.id };
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

test('several tabs opened at once on a closed favorite\'s link give it one tab; the others stay their own', async () => {
    const ids = await page.evaluate(async url => (await Promise.all([url, url, url, url].map(link => chrome.tabs.create({ url: link, active: false })))).map(tab => tab.id), `${base}/watch?v=first`);
    await page.waitForSelector(`${favoriteRow()}[data-tab-id]`);
    await sleep(1000);
    const bound = await Promise.all(ids.map(bindingOf));
    expect(bound.filter(Boolean)).toEqual([fixture.bookmarkId]);
    expect(await page.$$(favoriteRow())).toHaveLength(1);
    expect(await page.$(`${favoriteRow()}[data-tab-id="${ids[bound.indexOf(fixture.bookmarkId)]}"]`)).not.toBeNull();
    for (const id of ids.filter((id, index) => !bound[index])) expect(await page.$(temporaryRow(id))).not.toBeNull();
    await page.evaluate(ids => chrome.tabs.remove(ids), ids);
    await page.waitForSelector(`${favoriteRow()}.bookmark-only`);
});

test('the favorite row shows the joined tab when another link opens at the same moment', async () => {
    for (const gap of [0, 10, 20]) {
        const [joined, other] = await page.evaluate(async ({ base, gap }) => {
            const first = await chrome.tabs.create({ url: `${base}/watch?v=first`, active: false });
            await new Promise(resolve => setTimeout(resolve, gap));
            const second = await chrome.tabs.create({ url: `${base}/elsewhere-${gap}`, active: false });
            return [first.id, second.id];
        }, { base, gap });
        await page.waitForFunction(async id => (await chrome.storage.local.get('pinnedTabStatesById')).pinnedTabStatesById?.[id]?.bookmarkId, { polling: 50 }, joined);
        await sleep(1200);
        expect([gap, Boolean(await page.$(`${favoriteRow()}[data-tab-id="${joined}"]`))]).toEqual([gap, true]);
        expect(await page.$(temporaryRow(joined))).toBeNull();
        expect(await page.$(temporaryRow(other))).not.toBeNull();
        await page.evaluate(ids => chrome.tabs.remove(ids), [joined, other]);
        await page.waitForSelector(`${favoriteRow()}.bookmark-only`);
        await sleep(300);
    }
});

test('a tab that later navigates to a closed favorite\'s link stays an ordinary tab', async () => {
    const id = await openTab(`${base}/watch?v=second`);
    await page.waitForSelector(temporaryRow(id));
    await sleep(500);
    await page.evaluate(({ id, url }) => chrome.tabs.update(id, { url }), { id, url: `${base}/watch?v=first` });
    await sleep(800);
    expect(await bindingOf(id)).toBeNull();
    expect(await page.$(temporaryRow(id))).not.toBeNull();
    expect(await page.$(`${favoriteRow()}.bookmark-only`)).not.toBeNull();
    await page.evaluate(id => chrome.tabs.remove(id), id);
});

test('a tab opened on a favorite\'s link while another favorite is opening still opens as its favorite', async () => {
    const id = await page.evaluate(async ({ selector, url }) => {
        document.querySelector(selector).click();
        await new Promise(resolve => setTimeout(resolve, 5));
        return (await chrome.tabs.create({ url, active: false })).id;
    }, { selector: `${favoriteRow()}.bookmark-only`, url: `${base}/watch?v=third` });
    await page.waitForSelector(`${otherFavoriteRow()}[data-tab-id="${id}"]`);
    await page.waitForSelector(`${favoriteRow()}[data-tab-id]`);
    expect(await bindingOf(id)).toBe(fixture.otherId);
    expect(await page.$(temporaryRow(id))).toBeNull();
    await page.bringToFront();
    const opened = await page.$eval(favoriteRow(), row => Number(row.dataset.tabId));
    await page.evaluate(ids => chrome.tabs.remove(ids), [id, opened]);
    await page.waitForSelector(`${favoriteRow()}.bookmark-only`);
    await page.waitForSelector(`${otherFavoriteRow()}.bookmark-only`);
});
