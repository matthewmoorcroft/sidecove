import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowserWithExtension, openSidebar, createSpace } from './helpers/extension-helper.js';

// Closing a window while another stays open reopens each of its ordinary tabs as a tab in the
// window that is left, in the same space and order, unloaded until you go to it (issue 65).
// Pinned tabs, favorites, New Tab and private windows leave nothing behind; a page already open in
// the window that stays is not opened twice; quitting Chrome leaves it to Chrome's own restore.
let server, base;

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>Page ${req.url.slice(1)}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const urlOf = name => `${base}/${name}`;

// Everything a test needs from one browser: the panel page, and helpers that run in it.
function driver(page) {
    return {
        // Opens a window with these pages (not focused, so the panel's window keeps focus) and waits
        // until Chrome has loaded them and the extension has given each one a space.
        openWindow: paths =>
            page.evaluate(
                async (urls, count) => {
                    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                    const win = await chrome.windows.create({ url: urls, focused: false });
                    for (let i = 0; i < 100; i++) {
                        const tabs = await chrome.tabs.query({ windowId: win.id });
                        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                        const owned = id => spaces.some(s => s.temporaryTabs.includes(id));
                        if (tabs.length === count && tabs.every(t => t.status === 'complete' && owned(t.id)))
                            return { windowId: win.id, tabIds: tabs.map(t => t.id) };
                        await sleep(100);
                    }
                    throw new Error('The window never settled');
                },
                paths.map(urlOf),
                paths.length
            ),
        openTab: (name, windowId, extra = {}) =>
            page.evaluate(
                async (url, windowId, extra) => {
                    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                    const tab = await chrome.tabs.create({ url, windowId, active: false, ...extra });
                    for (let i = 0; i < 100; i++) {
                        const now = await chrome.tabs.get(tab.id);
                        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                        const owned = spaces.some(s => [...s.temporaryTabs, ...s.pinnedTabs].includes(tab.id));
                        if (now.status === 'complete' && owned) return tab.id;
                        await sleep(100);
                    }
                    throw new Error('The tab never settled');
                },
                urlOf(name),
                windowId,
                extra
            ),
        closeWindow: windowId => page.evaluate(id => chrome.windows.remove(id), windowId),
        tabsWith: url => page.evaluate(url => chrome.tabs.query({ url }), url),
        // Waits until each page is open in exactly one tab, in this window, and returns those tabs.
        waitForReopened: (names, windowId, timeout = 10000) =>
            page.waitForFunction(
                async (urls, windowId) => {
                    for (const url of urls) {
                        const tabs = await chrome.tabs.query({ url });
                        if (tabs.length !== 1 || tabs[0].windowId !== windowId) return false;
                    }
                    return true;
                },
                { polling: 100, timeout },
                names.map(urlOf),
                windowId
            ),
        spaceOf: tabId =>
            page.evaluate(async id => {
                const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                return spaces.find(s => s.temporaryTabs.includes(id))?.id;
            }, tabId),
        assign: (tabId, spaceId, extra = {}) =>
            page.evaluate(
                (tabId, spaceId, extra) =>
                    chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId, spaceId, ...extra }),
                tabId,
                spaceId,
                extra
            ),
        // The open tabs of the space's list, top to bottom.
        listUrls: () => page.$$eval('.space.active .tab[data-tab-id]', rows => rows.map(row => row.dataset.url)),
        activeSpaceId: () => page.$eval('.space.active', el => el.dataset.spaceId),
        async closeOtherWindows(mainWindowId) {
            await page.evaluate(async mainWindowId => {
                for (const win of await chrome.windows.getAll())
                    if (win.id !== mainWindowId) await chrome.windows.remove(win.id).catch(() => {});
            }, mainWindowId);
        }
    };
}

describe('closing a window while another stays open', () => {
    let browser, extensionId, page, d, mainWindowId;

    beforeAll(async () => {
        ({ browser, extensionId } = await launchBrowserWithExtension());
        page = await openSidebar(browser, extensionId);
        page.on('pageerror', error => console.error('Sidebar error:', error.message));
        d = driver(page);
        mainWindowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
        await page.bringToFront();
    });

    afterAll(async () => {
        await browser?.close();
    });

    beforeEach(async () => {
        await d.closeOtherWindows(mainWindowId);
        // Let any reopening from the last test finish.
        await sleep(1500);
    });

    test('its pages open again as tabs in the window that stays, in the same space and order, unloaded', async () => {
        const names = ['a-one', 'a-two', 'a-three'];
        const spaceId = await d.activeSpaceId();
        const { windowId } = await d.openWindow(names);
        await page.waitForFunction(
            urls => {
                const listed = [...document.querySelectorAll('.space.active .tab[data-tab-id]')];
                return urls.every(url => listed.some(row => row.dataset.url === url));
            },
            { polling: 100 },
            names.map(urlOf)
        );
        const listBefore = await d.listUrls();

        await d.closeWindow(windowId);
        await d.waitForReopened(names, mainWindowId);

        // The same rows in the same order, now tabs of this window.
        await page.waitForFunction(
            before => {
                const now = [...document.querySelectorAll('.space.active .tab[data-tab-id]')];
                return (
                    JSON.stringify(now.map(row => row.dataset.url)) === JSON.stringify(before) &&
                    now.every(row => !row.classList.contains('other-window'))
                );
            },
            { polling: 100, timeout: 10000 },
            listBefore
        );
        expect(await page.$('.space.active .closed-links, .space.active .closed-link')).toBeNull();
        for (const name of names) {
            const [tab] = await d.tabsWith(urlOf(name));
            expect(await d.spaceOf(tab.id)).toBe(spaceId);
        }
        // Each one is unloaded once it has its title, and keeps that title.
        await page.waitForFunction(
            async urls => {
                for (const url of urls) {
                    const [tab] = await chrome.tabs.query({ url });
                    if (!tab?.discarded) return false;
                }
                return true;
            },
            { polling: 200, timeout: 20000 },
            names.map(urlOf)
        );
        for (const name of names) {
            const [tab] = await d.tabsWith(urlOf(name));
            expect(tab.title).toBe(`Page ${name}`);
            expect(tab.active).toBe(false);
        }
    }, 60000);

    test('pinned tabs, favorites, New Tab and pages already open here leave nothing behind', async () => {
        await d.openTab('ex-here', mainWindowId);
        const spaceId = await d.activeSpaceId();
        const { windowId, tabIds } = await d.openWindow(['ex-plain', 'ex-here', 'ex-favorite']);
        // A favorite of the space, a Chrome-pinned tab and a New Tab.
        await d.assign(tabIds[2], spaceId, { pinned: true });
        await d.openTab('ex-pinned', windowId, { pinned: true });
        await page.evaluate(windowId => chrome.tabs.create({ windowId, url: 'chrome://newtab/' }), windowId);
        const mainTabs = () => page.evaluate(id => chrome.tabs.query({ windowId: id }), mainWindowId);
        const before = (await mainTabs()).length;

        await d.closeWindow(windowId);
        await d.waitForReopened(['ex-plain'], mainWindowId);
        await sleep(2000);
        // Only the ordinary page came back; the one already open here is still one tab.
        expect(await d.tabsWith(urlOf('ex-here'))).toHaveLength(1);
        for (const name of ['ex-favorite', 'ex-pinned']) expect(await d.tabsWith(urlOf(name))).toHaveLength(0);
        // Of the five tabs that closed with the window, one came back here.
        const after = await mainTabs();
        expect(after.length).toBe(before + 1);
        expect(after.filter(tab => /^chrome:\/\/new/.test(tab.url || tab.pendingUrl))).toHaveLength(0);
    }, 60000);

    test('moving the last tab of a window into another window reopens nothing', async () => {
        const { windowId, tabIds } = await d.openWindow(['mv-only']);
        await page.evaluate(
            (tabId, mainWindowId) => chrome.tabs.move(tabId, { windowId: mainWindowId, index: -1 }),
            tabIds[0],
            mainWindowId
        );
        await page.waitForFunction(
            async id => !(await chrome.windows.getAll()).some(win => win.id === id),
            { polling: 100 },
            windowId
        );
        await sleep(2500);
        const tabs = await d.tabsWith(urlOf('mv-only'));
        expect(tabs).toHaveLength(1);
        expect(tabs[0].id).toBe(tabIds[0]);
    }, 60000);

    test('a private window leaves nothing behind', async () => {
        // The extension is not allowed in private windows, so it sees nothing there; this proves a
        // private page never comes back in a normal window.
        const context = await browser.createBrowserContext();
        const privatePage = await context.newPage();
        await privatePage.goto(urlOf('private-page'));
        await privatePage.close();
        await context.close();
        await sleep(2500);
        expect(await d.tabsWith(urlOf('private-page'))).toHaveLength(0);
    }, 60000);

    test('each tab goes back to its own space', async () => {
        const work = await createSpace(browser, extensionId, 'Reopen Work');
        const workId = await work.evaluate(async () => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return spaces.find(s => s.name === 'Reopen Work').id;
        });
        await work.close();
        const homeId = await d.activeSpaceId();
        const { windowId, tabIds } = await d.openWindow(['sp-home', 'sp-work']);
        await d.assign(tabIds[0], homeId);
        await d.assign(tabIds[1], workId);

        await d.closeWindow(windowId);
        await d.waitForReopened(['sp-home', 'sp-work'], mainWindowId);
        const [home] = await d.tabsWith(urlOf('sp-home'));
        const [workTab] = await d.tabsWith(urlOf('sp-work'));
        expect(await d.spaceOf(home.id)).toBe(homeId);
        expect(await d.spaceOf(workTab.id)).toBe(workId);
    }, 60000);
});

// Restarting Chrome brings each page back once. The profile is reused, as a restart does, with
// "continue where you left off".
describe('restarting Chrome', () => {
    const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
    let profileDir;

    beforeEach(() => {
        profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecove-reopen-'));
    });
    afterEach(() => {
        fs.rmSync(profileDir, { recursive: true, force: true });
    });

    const launch = async () => {
        const { browser, extensionId } = await launchBrowserWithExtension({
            extensionPath: dist,
            userDataDir: profileDir,
            args: ['--restore-last-session']
        });
        const page = await openSidebar(browser, extensionId);
        return { browser, page, d: driver(page) };
    };
    const countOf = (page, urls) =>
        page.evaluate(
            async urls => Promise.all(urls.map(async url => (await chrome.tabs.query({ url })).length)),
            urls
        );

    test('reopened tabs come back once, in their space and order', async () => {
        const names = ['rs-one', 'rs-two', 'rs-three'];
        let { browser, page, d } = await launch();
        let orderBefore;
        try {
            const mainWindowId = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
            const { windowId } = await d.openWindow(names);
            await d.closeWindow(windowId);
            await d.waitForReopened(names, mainWindowId);
            orderBefore = await page.evaluate(async urls => {
                const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                const tabs = await chrome.tabs.query({});
                const urlOf = id => tabs.find(tab => tab.id === id)?.url;
                return spaces[0].temporaryTabs.map(urlOf).filter(url => urls.includes(url));
            }, names.map(urlOf));
            expect(orderBefore).toHaveLength(3);
            await sleep(1500);
        } finally {
            await browser.close();
        }

        ({ browser, page } = await launch());
        try {
            await page.waitForFunction(
                async urls => (await Promise.all(urls.map(url => chrome.tabs.query({ url })))).every(t => t.length),
                { polling: 100, timeout: 15000 },
                names.map(urlOf)
            );
            await sleep(2500);
            expect(await countOf(page, names.map(urlOf))).toEqual([1, 1, 1]);
            const orderAfter = await page.evaluate(async urls => {
                const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                const tabs = await chrome.tabs.query({});
                const urlOf = id => tabs.find(tab => tab.id === id)?.url;
                return spaces[0].temporaryTabs.map(urlOf).filter(url => urls.includes(url));
            }, names.map(urlOf));
            expect(orderAfter).toEqual(orderBefore);
        } finally {
            await browser.close();
        }
    }, 120000);

    test('quitting with two windows open reopens nothing: Chrome brings each window back as it was', async () => {
        const names = ['qt-one', 'qt-two'];
        let { browser, d } = await launch();
        let page;
        try {
            await d.openWindow(names);
            await sleep(1500);
        } finally {
            await browser.close();
        }

        ({ browser, page, d } = await launch());
        try {
            await page.waitForFunction(
                async urls => (await Promise.all(urls.map(url => chrome.tabs.query({ url })))).every(t => t.length),
                { polling: 100, timeout: 15000 },
                names.map(urlOf)
            );
            await sleep(2500);
            expect(await countOf(page, names.map(urlOf))).toEqual([1, 1]);
            // Still together in the window they were in, not moved into another.
            const [[one], [two]] = await Promise.all(names.map(name => d.tabsWith(urlOf(name))));
            expect(one.windowId).toBe(two.windowId);
            const others = await page.evaluate(id => chrome.tabs.query({ windowId: id }), one.windowId);
            expect(others.filter(tab => /^https?:/.test(tab.url)).map(tab => tab.url)).toEqual(names.map(urlOf));
        } finally {
            await browser.close();
        }
    }, 120000);
});
