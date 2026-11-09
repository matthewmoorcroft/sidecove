import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar, openOptionsPage } from './helpers/extension-helper.js';

// Settings -> Show tabs and favorites from all windows (issues 27 and 43, first step), on by
// default: each window's sidebar also lists the space's open tabs and the top-bar favorites of the
// other windows, marked, and picking one switches to the window it lives in.
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

test('the setting starts on; turned off, each window lists only its own tabs and favorites', async () => {
    expect(await options.$eval('#showTabsFromAllWindows', input => input.checked)).toBe(true);
    await page.waitForSelector(`${rowSelector(ids.otherTab)}.other-window`);
    await setToggle('showTabsFromAllWindows', false);
    await page.waitForFunction(() => !document.querySelector('.other-window'), { polling: 100 });
    expect(await page.$(rowSelector(ids.own))).not.toBeNull();
    expect(await page.$(rowSelector(ids.otherTab))).toBeNull();
    expect(await page.$(pinSelector(ids.otherPin))).toBeNull();
    expect(await page.$$('.other-window')).toHaveLength(0);
});

test('with it on, the other window’s tab and favorite are listed and marked, and search finds them', async () => {
    await setToggle('showTabsFromAllWindows', true);
    const row = await page.waitForSelector(`${rowSelector(ids.otherTab)}.other-window`);
    expect(await row.$eval('.other-window-badge', el => el.getAttribute('aria-label'))).toBe('In another window');
    expect(await row.evaluate(el => [el.draggable, el.classList.contains('active')])).toEqual([false, false]);
    expect(await page.$eval(rowSelector(ids.own), el => el.classList.contains('other-window'))).toBe(false);
    // One row per live tab.
    expect(await page.$$(rowSelector(ids.otherTab))).toHaveLength(1);

    const pin = await page.waitForSelector(`${pinSelector(ids.otherPin)}.other-window`);
    expect(await pin.$eval('img', img => img.alt)).toContain('in another window');
    expect(await pin.$('.other-window-badge')).not.toBeNull();

    await page.focus('#tabSearchInput');
    await page.keyboard.type('other-tab');
    const result = await page.waitForSelector('#tabSearchResults .search-result.other-window');
    expect(await result.$eval('.tab-title-display', el => el.textContent)).toBe('Page other-tab');
    await page.keyboard.press('Escape');
});

test('picking another window’s tab or favorite switches to that window on it', async () => {
    // Make the tab inactive in its own window first.
    await page.evaluate(id => chrome.tabs.update(id, { active: true }), ids.otherPin);
    await waitForActive(ids.otherPin, ids.other);
    const ownActive = await page.evaluate(
        async id => (await chrome.tabs.query({ active: true, windowId: id }))[0].id,
        ids.here
    );

    await page.click(rowSelector(ids.otherTab));
    await waitForActive(ids.otherTab, ids.other);
    expect(await page.evaluate(id => chrome.windows.get(id).then(w => w.focused), ids.other)).toBe(true);
    // Nothing moved: this window keeps its tab and the tab stays in its own window.
    expect(
        await page.evaluate(async id => (await chrome.tabs.query({ active: true, windowId: id }))[0].id, ids.here)
    ).toBe(ownActive);

    await page.$eval(pinSelector(ids.otherPin), el =>
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    );
    await waitForActive(ids.otherPin, ids.other);
    expect(await page.evaluate(id => chrome.tabs.get(id).then(t => t.windowId), ids.otherPin)).toBe(ids.other);
});

test('a Cmd-click on another window’s tab switches to it too, and selects nothing', async () => {
    await page.evaluate(id => chrome.tabs.update(id, { active: true }), ids.otherPin);
    await waitForActive(ids.otherPin, ids.other);
    await page.$eval(rowSelector(ids.otherTab), el =>
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true }))
    );
    await waitForActive(ids.otherTab, ids.other);
    expect(await page.$$('.tab.selected')).toHaveLength(0);
});

test('closing another window’s tab from this list closes it there', async () => {
    const extra = await page.evaluate(
        async (windowId, url) => (await chrome.tabs.create({ windowId, url, active: false })).id,
        ids.other,
        `${base}/closed-from-here`
    );
    await page.waitForSelector(`${rowSelector(extra)}.other-window`);
    await page.$eval(`${rowSelector(extra)} .tab-close`, button => button.click());
    await page.waitForFunction(sel => !document.querySelector(sel), { polling: 100 }, rowSelector(extra));
    expect(
        await page.evaluate(
            id =>
                chrome.tabs.get(id).then(
                    () => true,
                    () => false
                ),
            extra
        )
    ).toBe(false);
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
        await page.waitForSelector(`${pinSelector(ids.otherPin)}.other-window`);
        await page.waitForSelector(`${rowSelector(ids.otherTab)}.other-window`);
    } finally {
        await setToggle('perSpacePinnedFavorites', false);
    }
    // Shared favorites again: the other window's pin shows in every space.
    await switchTo(elsewhere);
    await page.waitForSelector(`${pinSelector(ids.otherPin)}.other-window`);
    await switchTo(ids.home);
});

test('turning the setting off again goes back to this window’s own lists', async () => {
    await setToggle('showTabsFromAllWindows', false);
    await page.waitForFunction(() => !document.querySelector('.other-window'), { polling: 100 });
    expect(await page.$(rowSelector(ids.own))).not.toBeNull();
});
