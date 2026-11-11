import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar, openOptionsPage } from './helpers/extension-helper.js';
import { dragOnto } from './helpers/drag.js';

// Settings -> Show tabs and favorites from all windows, step 3 (issues 27 and 43): the top-bar
// favorites are one saved list in every window. A favorite with no tab in a window shows dimmed
// there, loads nothing, and opens in that window when picked; nothing in another window moves.
let browser, one, two, options, server, base, win;

const url = path => `${base}/${path}`;
const dimmed = favoriteId => `#pinnedFavicons .saved-favorite[data-favorite-id="${favoriteId}"]`;
const live = tabId => `#pinnedFavicons .pinned-favicon[data-tab-id="${tabId}"]:not(.saved-favorite)`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Each panel is a tab, hidden whenever another tab of its window is active, and a hidden page
// runs no in-page waits. So waiting is done from here, a check at a time.
async function until(page, check, ...args) {
    const end = Date.now() + 10000;
    for (;;) {
        const value = await page.evaluate(check, ...args);
        if (value) return value;
        if (Date.now() > end) {
            // The bar and the saved list as they were, to see what went wrong.
            const state = await page.evaluate(async () => ({
                bar: [...document.querySelectorAll('#pinnedFavicons .pinned-favicon')].map(icon => ({
                    ...icon.dataset,
                    className: icon.className
                })),
                stored: await chrome.storage.local.get(['savedFavorites', 'favoriteTabs']),
                pins: (await chrome.tabs.query({ pinned: true })).map(tab => [tab.id, tab.windowId, tab.url])
            }));
            throw new Error(`Timed out waiting for: ${check} ${JSON.stringify(args)}\n${JSON.stringify(state)}`);
        }
        await sleep(100);
    }
}
const shown = (page, selector) => until(page, sel => Boolean(document.querySelector(sel)), selector);
const gone = (page, selector) => until(page, sel => !document.querySelector(sel), selector);
const saved = page =>
    page.evaluate(async () => (await chrome.storage.local.get('savedFavorites')).savedFavorites || []);
const favoriteAt = (page, path) =>
    until(
        page,
        async url =>
            ((await chrome.storage.local.get('savedFavorites')).savedFavorites || []).find(f => f.url === url)?.id,
        url(path)
    );
const tabsAt = (windowId, path) =>
    one.evaluate(
        async (windowId, url) =>
            (await chrome.tabs.query({ windowId })).filter(t => (t.url || t.pendingUrl) === url).map(t => t.id),
        windowId,
        url(path)
    );
const pinIn = (windowId, path) =>
    one.evaluate(
        async (windowId, url) => (await chrome.tabs.create({ windowId, url, pinned: true, active: false })).id,
        windowId,
        url(path)
    );
const barOrder = page =>
    page.$$eval('#pinnedFavicons .pinned-favicon[data-favorite-id]', icons => icons.map(i => i.dataset.favoriteId));
const activeIn = windowId =>
    one.evaluate(async windowId => (await chrome.tabs.query({ active: true, windowId }))[0].id, windowId);
// Dispatched rather than page.click, which waits for a frame a hidden panel does not paint.
const press = (page, selector) =>
    page.$eval(selector, el => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
const switchSpace = (page, spaceId) =>
    page.evaluate(id => document.querySelector(`#spaceSwitcher button[data-space-id="${id}"]`).click(), spaceId);
const setToggle = async (id, on) => {
    if ((await options.$eval(`#${id}`, input => input.checked)) !== on)
        await options.$eval(`#${id}`, input => input.click());
    await until(one, async (id, on) => (await chrome.storage.sync.get(id))[id] === on, id, on);
};

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>Page ${req.url.slice(1)}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    one = await openSidebar(browser, result.extensionId);
    options = await openOptionsPage(browser, result.extensionId);
    one.on('pageerror', error => console.error('Sidebar error:', error.message));
    win = await one.evaluate(async () => {
        const here = await chrome.windows.getCurrent();
        const other = await chrome.windows.create({ url: 'about:blank', focused: false });
        return { one: here.id, two: other.id };
    });
    // A second panel, in the other window, to see what it shows.
    const panelUrl = `chrome-extension://${result.extensionId}/sidebar.html?panel=two`;
    await one.evaluate((windowId, url) => chrome.tabs.create({ windowId, url, active: true }), win.two, panelUrl);
    two = await (await browser.waitForTarget(target => target.url() === panelUrl)).page();
    two.on('pageerror', error => console.error('Second panel error:', error.message));
    await shown(two, '#pinnedFavicons');
    await one.bringToFront();
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

test('a favorite pinned in one window shows dimmed in the other, which loads nothing for it', async () => {
    const tab = await pinIn(win.two, 'mail');
    const mail = await favoriteAt(one, 'mail');
    await shown(two, live(tab));
    await shown(one, dimmed(mail));
    await until(
        one,
        sel => document.querySelector(sel).getAttribute('aria-label') === 'Page mail (not open)',
        dimmed(mail)
    );
    expect(await one.$eval(`${dimmed(mail)} img`, img => Number(getComputedStyle(img).opacity))).toBeLessThan(1);
    expect(await tabsAt(win.one, 'mail')).toEqual([]);
});

test('picking it opens it pinned in this window and leaves the other window as it was', async () => {
    const mail = await favoriteAt(one, 'mail');
    const [there] = await tabsAt(win.two, 'mail');
    const otherActive = await activeIn(win.two);
    await press(one, dimmed(mail));
    await until(
        one,
        async (windowId, url) =>
            (await chrome.tabs.query({ windowId, active: true })).some(
                t => t.pinned && (t.url || t.pendingUrl) === url
            ),
        win.one,
        url('mail')
    );
    const [here] = await tabsAt(win.one, 'mail');
    await shown(one, live(here));
    await gone(one, dimmed(mail));
    expect(await tabsAt(win.two, 'mail')).toEqual([there]);
    expect(await activeIn(win.two)).toBe(otherActive);
    expect((await saved(one)).filter(f => f.url === url('mail'))).toHaveLength(1);
});

test('closing a favorite’s tab keeps the favorite, dimmed', async () => {
    const mail = await favoriteAt(one, 'mail');
    const [here] = await tabsAt(win.one, 'mail');
    await one.evaluate(id => chrome.tabs.remove(id), here);
    await shown(one, dimmed(mail));
    expect((await saved(one)).some(f => f.id === mail)).toBe(true);
});

test('adding, reordering and removing a favorite in one window shows in the other', async () => {
    const mail = await favoriteAt(one, 'mail');
    const docsTab = await pinIn(win.one, 'docs');
    const chatTab = await pinIn(win.one, 'chat');
    const docs = await favoriteAt(one, 'docs');
    const chat = await favoriteAt(one, 'chat');
    await shown(two, dimmed(docs));
    await shown(two, dimmed(chat));
    expect(await barOrder(two)).toEqual([mail, docs, chat]);

    // Drag Chat onto Mail in this window: the other window's bar follows.
    await shown(one, live(chatTab));
    await dragOnto(one, live(chatTab), dimmed(mail));
    await until(
        two,
        (first, last) => {
            const ids = [...document.querySelectorAll('#pinnedFavicons .pinned-favicon[data-favorite-id]')].map(
                icon => icon.dataset.favoriteId
            );
            return ids.indexOf(first) < ids.indexOf(last);
        },
        chat,
        docs
    );
    expect(await barOrder(two)).toEqual(await barOrder(one));

    // Remove Mail from the window that has no tab for it: the other window's tab is unpinned.
    const [mailTab] = await tabsAt(win.two, 'mail');
    await one.$eval(dimmed(mail), el =>
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }))
    );
    await shown(one, '#tab-context-menu .context-menu-item');
    expect(await one.$eval('#tab-context-menu .context-menu-item', el => el.textContent)).toBe('Remove from Favorites');
    await one.$eval('#tab-context-menu .context-menu-item', el => el.click());
    await gone(two, live(mailTab));
    await gone(one, dimmed(mail));
    expect(await one.evaluate(id => chrome.tabs.get(id).then(t => t.pinned), mailTab)).toBe(false);
    expect((await saved(one)).some(f => f.id === mail)).toBe(false);

    // Unpinning a favorite's tab removes it everywhere too.
    await one.evaluate(id => chrome.tabs.update(id, { pinned: false }), docsTab);
    await gone(two, dimmed(docs));
    expect((await saved(one)).map(f => f.id)).toEqual([chat]);
});

test('separate favorites per space still decide which favorites show', async () => {
    const chat = await favoriteAt(one, 'chat');
    const [chatTab] = await tabsAt(win.one, 'chat');
    const request = (action, args = {}) =>
        one.evaluate(
            async (action, args) => {
                const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...args });
                if (!response.success) throw new Error(response.error);
                return response.spaces;
            },
            action,
            args
        );
    const before = await request('get');
    const home = before[0].id;
    await one.evaluate(async folderId => {
        const [folder] = await chrome.bookmarks.get(folderId);
        await chrome.bookmarks.create({ parentId: folder.parentId, title: 'Elsewhere' });
    }, before[0].bookmarkFolderId);
    await until(one, async () => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        return spaces.some(space => space.name === 'Elsewhere');
    });
    const elsewhere = (await request('get')).find(space => space.name === 'Elsewhere').id;
    // Moving the favorite's tab to Elsewhere moves the favorite.
    await request('assignPin', { tabId: chatTab, spaceId: elsewhere });
    await until(
        one,
        async (url, spaceId) =>
            (await chrome.storage.local.get('savedFavorites')).savedFavorites.find(f => f.url === url)?.spaceId ===
            spaceId,
        url('chat'),
        elsewhere
    );
    await setToggle('perSpacePinnedFavorites', true);
    try {
        // The other window shows Home, so Chat is not in its bar until it switches to Elsewhere.
        await gone(two, dimmed(chat));
        await shown(two, `#spaceSwitcher button[data-space-id="${elsewhere}"]`);
        await switchSpace(two, elsewhere);
        await shown(two, dimmed(chat));
        await press(two, dimmed(chat));
        const opened = await until(
            two,
            async (windowId, url) =>
                (await chrome.tabs.query({ windowId, pinned: true })).find(t => (t.url || t.pendingUrl) === url)?.id,
            win.two,
            url('chat')
        );
        await shown(two, live(opened));
        const owner = (await request('get')).find(space => space.pinnedTabs.includes(opened));
        expect(owner.id).toBe(elsewhere);
        await switchSpace(two, home);
        await gone(two, live(opened));
    } finally {
        await setToggle('perSpacePinnedFavorites', false);
    }
    await shown(two, `#pinnedFavicons .pinned-favicon[data-favorite-id="${chat}"]`);
});

test('turned off, each window’s bar is its own pins again, with nothing dimmed', async () => {
    const lone = await pinIn(win.two, 'only-there');
    await favoriteAt(one, 'only-there');
    const [chatHere] = await tabsAt(win.one, 'chat');
    await setToggle('showTabsFromAllWindows', false);
    await gone(one, '#pinnedFavicons .saved-favorite');
    await shown(one, live(chatHere));
    expect(await one.$(live(lone))).toBeNull();
    await shown(two, live(lone));
    await setToggle('showTabsFromAllWindows', true);
    await shown(one, dimmed(await favoriteAt(one, 'only-there')));
});
