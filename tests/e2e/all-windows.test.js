import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar, openOptionsPage } from './helpers/extension-helper.js';

// Settings -> Show tabs and favorites from all windows (issues 27 and 43, first step), on by
// default: each window's sidebar lists the space's open tabs and the top-bar favorites of every
// window as one list, one entry per page. Which window a tab lives in does not show; picking a
// page open only in another window opens it again in this one and leaves that window's tab alone.
let browser, page, options, server, base, ids;

const rowSelector = id => `.space.active .tab[data-tab-id="${id}"]`;
const pinSelector = id => `#pinnedFavicons .pinned-favicon[data-tab-id="${id}"]`;
const request = (action, args = {}) =>
    page.evaluate(
        async (action, args) => {
            const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...args });
            if (!response.success) throw new Error(response.error);
            return response.spaces;
        },
        action,
        args
    );
const setToggle = async (id, on) => {
    if ((await options.$eval(`#${id}`, input => input.checked)) !== on)
        await options.$eval(`#${id}`, input => input.click());
    await page.waitForFunction(
        async (id, on) => (await chrome.storage.sync.get(id))[id] === on,
        { polling: 100 },
        id,
        on
    );
};
const switchTo = async spaceId => {
    await page.evaluate(id => document.querySelector(`#spaceSwitcher button[data-space-id="${id}"]`).click(), spaceId);
    await page.waitForSelector(`.space.active[data-space-id="${spaceId}"]`);
};
const waitForActive = (tabId, windowId) =>
    page.waitForFunction(
        async (tabId, windowId) => {
            const tab = await chrome.tabs.get(tabId);
            return tab.active && tab.windowId === windowId;
        },
        { polling: 100, timeout: 5000 },
        tabId,
        windowId
    );

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>Page ${req.url.slice(1)}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    options = await openOptionsPage(browser, result.extensionId);
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    ids = await page.evaluate(async base => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const owned = async tabId => {
            for (let i = 0; i < 50; i++) {
                const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                const space = spaces.find(
                    s =>
                        s.temporaryTabs.includes(tabId) ||
                        s.spaceBookmarks.includes(tabId) ||
                        s.pinnedTabs?.includes(tabId)
                );
                if (space) return space.id;
                await sleep(100);
            }
            throw new Error(`Tab ${tabId} was never given a space`);
        };
        const here = await chrome.windows.getCurrent();
        const own = await chrome.tabs.create({ url: `${base}/own-tab`, active: false });
        const other = await chrome.windows.create({ url: `${base}/other-tab`, focused: false });
        const otherTab = other.tabs[0].id;
        const otherPin = (
            await chrome.tabs.create({ windowId: other.id, url: `${base}/other-pin`, pinned: true, active: false })
        ).id;
        const home = await owned(own.id);
        await owned(otherTab);
        await owned(otherPin);
        return { here: here.id, other: other.id, own: own.id, otherTab, otherPin, home };
    }, base);
    await page.bringToFront();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(rowSelector(ids.own));
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

const rowsOfPage = url =>
    page.$$eval('.space.active .tab[data-tab-id]', (rows, url) => rows.filter(r => r.dataset.url === url).length, url);
const windowTabsAt = (windowId, url) =>
    page.evaluate(
        async (windowId, url) =>
            (await chrome.tabs.query({ windowId })).filter(t => (t.url || t.pendingUrl) === url).map(t => t.id),
        windowId,
        url
    );
const activeIn = windowId =>
    page.evaluate(async windowId => (await chrome.tabs.query({ active: true, windowId }))[0].id, windowId);
// Dispatched rather than page.click, which waits for a frame the sidebar may not paint while
// another window has focus.
const clickRow = (id, extra = {}) =>
    page.$eval(
        rowSelector(id),
        (el, extra) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...extra })),
        extra
    );
const waitForOpenHere = url =>
    page.waitForFunction(
        async (windowId, url) =>
            (await chrome.tabs.query({ windowId, active: true })).some(t => (t.url || t.pendingUrl) === url),
        { polling: 100, timeout: 5000 },
        ids.here,
        url
    );
const openInOther = path =>
    page.evaluate(
        async (windowId, url) => (await chrome.tabs.create({ windowId, url, active: false })).id,
        ids.other,
        `${base}/${path}`
    );

test('the setting starts on; turned off, each window lists only its own tabs and favorites', async () => {
    expect(await options.$eval('#showTabsFromAllWindows', input => input.checked)).toBe(true);
    await page.waitForSelector(rowSelector(ids.otherTab));
    await setToggle('showTabsFromAllWindows', false);
    await page.waitForFunction(sel => !document.querySelector(sel), { polling: 100 }, rowSelector(ids.otherTab));
    expect(await page.$(rowSelector(ids.own))).not.toBeNull();
    expect(await page.$(pinSelector(ids.otherPin))).toBeNull();
    expect(await page.$$('.other-window')).toHaveLength(0);
});

test('with it on, the other window’s tab and favorite are in the list and look like any other', async () => {
    await setToggle('showTabsFromAllWindows', true);
    const row = await page.waitForSelector(rowSelector(ids.otherTab));
    const own = await page.$(rowSelector(ids.own));
    const look = el =>
        el.evaluate(row => {
            const style = getComputedStyle(row.querySelector('.tab-details'));
            return { opacity: style.opacity, extra: row.querySelectorAll('[aria-label]').length, title: row.title };
        });
    expect(await look(row)).toEqual(await look(own));
    expect(await row.evaluate(el => el.classList.contains('active'))).toBe(false);

    const pin = await page.waitForSelector(pinSelector(ids.otherPin));
    expect(await pin.$eval('img', img => getComputedStyle(img).opacity)).toBe('1');
    expect(await pin.$eval('img', img => img.alt)).toBe('Page other-pin');

    await page.focus('#tabSearchInput');
    await page.keyboard.type('other-tab');
    const result = await page.waitForSelector('#tabSearchResults .search-result');
    expect(await result.$eval('.tab-title-display', el => el.textContent)).toBe('Page other-tab');
    await page.keyboard.press('Escape');
});

test('separate favorites per space still decide which pins show, from every window', async () => {
    const before = await request('get');
    await page.evaluate(async folderId => {
        const [folder] = await chrome.bookmarks.get(folderId);
        await chrome.bookmarks.create({ parentId: folder.parentId, title: 'Elsewhere' });
    }, before[0].bookmarkFolderId);
    await page.waitForFunction(
        async () => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return spaces.some(space => space.name === 'Elsewhere');
        },
        { polling: 100 }
    );
    const elsewhere = (await request('get')).find(space => space.name === 'Elsewhere').id;
    await page.waitForSelector(`#spaceSwitcher button[data-space-id="${elsewhere}"]`);
    await setToggle('perSpacePinnedFavorites', true);
    try {
        await switchTo(elsewhere);
        await page.waitForFunction(sel => !document.querySelector(sel), { polling: 100 }, pinSelector(ids.otherPin));
        expect(await page.$(rowSelector(ids.otherTab))).toBeNull();
        await switchTo(ids.home);
        await page.waitForSelector(pinSelector(ids.otherPin));
        await page.waitForSelector(rowSelector(ids.otherTab));
    } finally {
        await setToggle('perSpacePinnedFavorites', false);
    }
    // Shared favorites again: the other window's pin shows in every space.
    await switchTo(elsewhere);
    await page.waitForSelector(pinSelector(ids.otherPin));
    await switchTo(ids.home);
});

test('picking a tab open only in another window opens it here and leaves that window alone', async () => {
    const url = `${base}/other-tab`;
    await page.evaluate(id => chrome.tabs.update(id, { active: true }), ids.otherPin);
    await waitForActive(ids.otherPin, ids.other);
    expect(await windowTabsAt(ids.here, url)).toEqual([]);

    await clickRow(ids.otherTab);
    await waitForOpenHere(url);
    // The other window keeps its tab, still in the background there: two tabs, one per window.
    expect(await windowTabsAt(ids.other, url)).toEqual([ids.otherTab]);
    expect(await activeIn(ids.other)).toBe(ids.otherPin);
    expect(await windowTabsAt(ids.here, url)).toHaveLength(1);
    // The list still shows the page once, now as this window's tab.
    const [copy] = await windowTabsAt(ids.here, url);
    await page.waitForSelector(rowSelector(copy));
    await page.waitForFunction(sel => !document.querySelector(sel), { polling: 100 }, rowSelector(ids.otherTab));
    expect(await rowsOfPage(url)).toBe(1);

    // Picking it again switches to it here; nothing new opens.
    await page.evaluate(id => chrome.tabs.update(id, { active: true }), ids.own);
    await clickRow(copy);
    await waitForActive(copy, ids.here);
    expect(await windowTabsAt(ids.here, url)).toHaveLength(1);
});

test('picking a favorite pinned only in another window pins it here too, shown once', async () => {
    const url = `${base}/other-pin`;
    await page.$eval(pinSelector(ids.otherPin), el =>
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    );
    await waitForOpenHere(url);
    const [copy] = await windowTabsAt(ids.here, url);
    expect(await page.evaluate(id => chrome.tabs.get(id).then(t => t.pinned), copy)).toBe(true);
    expect(await windowTabsAt(ids.other, url)).toEqual([ids.otherPin]);
    await page.waitForSelector(pinSelector(copy));
    await page.waitForFunction(sel => !document.querySelector(sel), { polling: 100 }, pinSelector(ids.otherPin));
    expect(
        await page.$$eval(
            '#pinnedFavicons .pinned-favicon img',
            imgs => imgs.filter(i => i.alt === 'Page other-pin').length
        )
    ).toBe(1);
});

test('a Cmd-click opens it here too, and selects nothing', async () => {
    const url = `${base}/cmd-click`;
    const id = await openInOther('cmd-click');
    await page.waitForSelector(rowSelector(id));
    await clickRow(id, { metaKey: true });
    await waitForOpenHere(url);
    expect(await page.$$('.tab.selected')).toHaveLength(0);
    expect(await windowTabsAt(ids.other, url)).toEqual([id]);
});

test('closing an entry closes its page in every window, so it leaves the list', async () => {
    // Open only in the other window.
    const only = await openInOther('closed-from-here');
    await page.waitForSelector(rowSelector(only));
    await page.$eval(`${rowSelector(only)} .tab-close`, button => button.click());
    await page.waitForFunction(sel => !document.querySelector(sel), { polling: 100 }, rowSelector(only));
    expect(await windowTabsAt(ids.other, `${base}/closed-from-here`)).toEqual([]);

    // Open in both windows: one entry, and closing it closes both tabs.
    const url = `${base}/in-both`;
    const there = await openInOther('in-both');
    const here = await page.evaluate(async url => (await chrome.tabs.create({ url, active: false })).id, url);
    await page.waitForSelector(rowSelector(here));
    await page.waitForFunction(sel => !document.querySelector(sel), { polling: 100 }, rowSelector(there));
    await page.$eval(`${rowSelector(here)} .tab-close`, button => button.click());
    await page.waitForFunction(
        async ids =>
            (
                await Promise.all(
                    ids.map(id =>
                        chrome.tabs.get(id).then(
                            () => true,
                            () => false
                        )
                    )
                )
            ).every(open => !open),
        { polling: 100, timeout: 5000 },
        [here, there]
    );
    expect(await rowsOfPage(url)).toBe(0);
});

test('turning the setting off again goes back to this window’s own lists', async () => {
    await setToggle('showTabsFromAllWindows', false);
    await page.waitForFunction(() => !document.querySelector('.other-window'), { polling: 100 });
    expect(await page.$(rowSelector(ids.own))).not.toBeNull();
});
