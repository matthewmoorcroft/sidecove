import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowserWithExtension, openSidebar, createSpace } from './helpers/extension-helper.js';

// Closed links (issue 65): when a window closes, each of its ordinary tabs whose page is not open in
// any other window stays in the space's list as a dimmed link row, in every window, under a heading.
// A page that is still open in a window that stays is not closed at all: its tab stays open there
// and keeps its place in the list. Picking a link opens its page here and uses it up; Clear and
// auto-archive put links in Archived.
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

// Everything a test needs from one browser: the panel page, and helpers that run in it.
function driver(page) {
    const rowSelector = '.space.active .closed-link';
    const api = {
        page,
        // Opens a window with these pages (not focused, so the panel's window keeps focus) and waits
        // until Chrome has loaded them and the extension has given each one a space.
        async openWindow(paths) {
            return page.evaluate(
                async (base, paths) => {
                    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                    const win = await chrome.windows.create({ url: paths.map(p => `${base}/${p}`), focused: false });
                    for (let i = 0; i < 100; i++) {
                        const tabs = await chrome.tabs.query({ windowId: win.id });
                        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                        const owned = id => spaces.some(s => s.temporaryTabs.includes(id));
                        if (tabs.length === paths.length && tabs.every(t => t.status === 'complete' && owned(t.id)))
                            return { windowId: win.id, tabIds: tabs.map(t => t.id) };
                        await sleep(100);
                    }
                    throw new Error('The window never settled');
                },
                base,
                paths
            );
        },
        async openTab(path, windowId) {
            return page.evaluate(
                async (url, windowId) => {
                    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                    const tab = await chrome.tabs.create({ url, windowId, active: false });
                    for (let i = 0; i < 100; i++) {
                        const now = await chrome.tabs.get(tab.id);
                        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                        if (now.status === 'complete' && spaces.some(s => s.temporaryTabs.includes(tab.id)))
                            return tab.id;
                        await sleep(100);
                    }
                    throw new Error('The tab never settled');
                },
                `${base}/${path}`,
                windowId
            );
        },
        closeWindow: windowId => page.evaluate(id => chrome.windows.remove(id), windowId),
        links: () => page.evaluate(async () => (await chrome.storage.local.get('closedLinks')).closedLinks || []),
        archived: () => page.evaluate(async () => (await chrome.storage.local.get('archivedTabs')).archivedTabs || []),
        rowUrls: () => page.$$eval(rowSelector, rows => rows.map(row => row.dataset.url)),
        // The open tabs of the space's list, top to bottom.
        listUrls: () => page.$$eval('.space.active .tab[data-tab-id]', rows => rows.map(row => row.dataset.url)),
        waitForRows: (urls, timeout = 8000) =>
            page.waitForFunction(
                (selector, urls) => {
                    const now = [...document.querySelectorAll(selector)].map(row => row.dataset.url);
                    return JSON.stringify(now) === JSON.stringify(urls);
                },
                { polling: 100, timeout },
                rowSelector,
                urls
            ),
        waitForLinks: (count, timeout = 8000) =>
            page.waitForFunction(
                async count => {
                    const { closedLinks = [] } = await chrome.storage.local.get('closedLinks');
                    return closedLinks.length === count;
                },
                { polling: 100, timeout },
                count
            ),
        activeSpaceId: () => page.$eval('.space.active', el => el.dataset.spaceId),
        // Dispatched rather than page.click, which waits for a frame the panel may not paint while
        // another window has focus.
        click: selector => page.$eval(selector, el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))),
        async clearLinksAndWindows(mainWindowId) {
            const spaceId = await api.activeSpaceId();
            await page.evaluate(
                async (mainWindowId, spaceId) => {
                    for (const win of await chrome.windows.getAll())
                        if (win.id !== mainWindowId) await chrome.windows.remove(win.id).catch(() => {});
                    await chrome.runtime.sendMessage({ type: 'closedLinks', action: 'clear', spaceId });
                },
                mainWindowId,
                spaceId
            );
        }
    };
    return api;
}

describe('closing a window', () => {
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
        await d.clearLinksAndWindows(mainWindowId);
        await d.waitForLinks(0);
    });

    test('each of its pages becomes a dimmed link row, in the order it had in the list, and nothing is a tab any more', async () => {
        const { windowId } = await d.openWindow(['a-one', 'a-two', 'a-three']);
        const urls = ['a-one', 'a-two', 'a-three'].map(p => `${base}/${p}`);
        await page.waitForFunction(
            n => document.querySelectorAll('.space.active .tab[data-tab-id]').length >= n,
            { polling: 100 },
            3
        );
        const before = (await d.listUrls()).filter(url => urls.includes(url));
        expect(before).toHaveLength(3);

        await d.closeWindow(windowId);
        await d.waitForRows(before);

        // Under a small heading, faded, named as closed links, and not tabs.
        expect(await page.$eval('.space.active .closed-links-heading', el => el.textContent)).toBe('Closed links');
        expect(await page.$eval('.space.active .closed-links', el => el.hidden)).toBe(false);
        expect(
            await page.$$eval('.space.active .closed-link', rows => rows.map(r => r.getAttribute('aria-label')))
        ).toEqual(before.map(url => `Page ${url.split('/').pop()} (closed link)`));
        expect(await d.listUrls()).toEqual(expect.not.arrayContaining(urls));
        const opacity = await page.$eval('.space.active .closed-link-favicon', el => getComputedStyle(el).opacity);
        expect(Number(opacity)).toBeLessThan(1);

        // The worker's list is what the panel drew; every window's panel draws from it.
        const stored = await d.links();
        expect(stored.map(link => link.url).sort()).toEqual([...urls].sort());
        expect(stored.every(link => link.title.startsWith('Page '))).toBe(true);
    });

    test('a page still open in a window that stays is not closed: it stays open in its place, and only the other pages become links', async () => {
        // The list is one entry per page at the page's earliest tab, here the other window's:
        // [mine, shared, only-closed, between, shared, after] shows as mine, shared, between, after
        // (newest first, as the list is by default).
        await d.openTab('keep-mine', mainWindowId);
        const closing = await d.openWindow(['keep-shared']);
        await d.openTab('keep-only-closed', closing.windowId);
        await d.openTab('keep-between', mainWindowId);
        const sharedHere = await d.openTab('keep-shared', mainWindowId);
        await d.openTab('keep-after', mainWindowId);
        const wanted = ['keep-after', 'keep-between', 'keep-shared', 'keep-mine'].map(p => `${base}/${p}`);
        const order = async () => (await d.listUrls()).filter(url => wanted.includes(url));
        await page.waitForFunction(
            (selector, n) => document.querySelectorAll(selector).length >= n,
            { polling: 100 },
            '.space.active .tab[data-tab-id]',
            5
        );
        const listBefore = await order();
        expect(listBefore).toEqual(['keep-after', 'keep-between', 'keep-shared', 'keep-mine'].map(p => `${base}/${p}`));
        // The page only the closing window has is an open row until the window closes.
        expect(await d.listUrls()).toContain(`${base}/keep-only-closed`);

        await d.closeWindow(closing.windowId);
        await d.waitForRows([`${base}/keep-only-closed`]);

        // The page that was still open is the same tab, open and loaded, in the same place.
        expect(await order()).toEqual(listBefore);
        const tab = await page.evaluate(id => chrome.tabs.get(id), sharedHere);
        expect(tab.url).toBe(`${base}/keep-shared`);
        expect(tab.discarded).toBe(false);
        expect((await d.links()).map(link => link.url)).toEqual([`${base}/keep-only-closed`]);
    });

    // A window with these pages, closed at once, leaving a link for each.
    async function closedWindowWith(paths) {
        const { windowId } = await d.openWindow(paths);
        await page.waitForFunction(
            n => document.querySelectorAll('.space.active .tab[data-tab-id]').length >= n,
            { polling: 100 },
            paths.length
        );
        await d.closeWindow(windowId);
        await d.waitForLinks(paths.length);
        return paths.map(p => `${base}/${p}`);
    }

    test('picking a link opens the page in this window, in its space, and uses the link up', async () => {
        const [url, other] = await closedWindowWith(['pick-me', 'pick-other']);
        await page.waitForSelector(`.space.active .closed-link[data-url="${url}"]`);
        const spaceId = await d.activeSpaceId();
        await d.click(`.space.active .closed-link[data-url="${url}"]`);
        await d.waitForLinks(1);
        await page.waitForFunction(async url => (await chrome.tabs.query({ url })).length === 1, { polling: 100 }, url);
        const [tab] = await page.evaluate(url => chrome.tabs.query({ url }), url);
        expect(tab.windowId).toBe(mainWindowId);
        const owner = await page.evaluate(async id => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return spaces.find(s => s.temporaryTabs.includes(id))?.id;
        }, tab.id);
        expect(owner).toBe(spaceId);
        await d.waitForRows([other]);
        expect((await d.links()).map(l => l.url)).toEqual([other]);
    });

    test('the close button removes one link and nothing else', async () => {
        const [first, second] = await closedWindowWith(['rm-one', 'rm-two']);
        await page.waitForSelector(`.space.active .closed-link[data-url="${first}"]`);
        await d.click(`.space.active .closed-link[data-url="${first}"] .closed-link-close`);
        await d.waitForLinks(1);
        await d.waitForRows([second]);
        expect((await d.archived()).map(e => e.url)).not.toContain(first);
    });

    test('Clear puts the links in Archived and Undo brings them back', async () => {
        const urls = await closedWindowWith(['clr-one', 'clr-two']);
        await page.waitForFunction(() => document.querySelectorAll('.space.active .closed-link').length === 2, {
            polling: 100
        });
        // No open tab to close, and Clear still shows, because links are there to clear.
        expect(await page.$eval('.space.active .clean-tabs-btn', b => b.offsetParent !== null)).toBe(true);
        await d.click('.space.active .clean-tabs-btn');
        await d.waitForLinks(0);
        await d.waitForRows([]);
        expect((await d.archived()).map(e => e.url)).toEqual(expect.arrayContaining(urls));
        await page.waitForSelector('#undoToast');
        expect(await page.$eval('#undoToast', t => t.textContent)).toMatch(/^Closed \d+ tabs/);

        await d.click('#undoToast .undo-toast-button');
        await d.waitForLinks(2);
        await page.waitForFunction(() => document.querySelectorAll('.space.active .closed-link').length === 2, {
            polling: 100
        });
        expect((await d.links()).map(l => l.url).sort()).toEqual([...urls].sort());
        const archivedUrls = (await d.archived()).map(e => e.url);
        for (const url of urls) expect(archivedUrls).not.toContain(url);
    });

    test('past 100 links the oldest go to Archived', async () => {
        const paths = Array.from({ length: 101 }, (_, i) => `cap-${String(i).padStart(3, '0')}`);
        const { windowId } = await d.openWindow(paths);
        await d.closeWindow(windowId);
        await d.waitForLinks(100);
        await page.waitForFunction(
            async () =>
                ((await chrome.storage.local.get('archivedTabs')).archivedTabs || []).filter(e =>
                    e.url.includes('/cap-')
                ).length === 1,
            { polling: 100, timeout: 8000 }
        );
        // One page went to Archived and 100 stayed as links: every page is in exactly one place.
        const linked = (await d.links()).map(l => l.url);
        const archivedUrls = (await d.archived()).map(e => e.url).filter(url => url.includes('/cap-'));
        expect(new Set([...linked, ...archivedUrls]).size).toBe(101);
        expect(linked).not.toContain(archivedUrls[0]);
    }, 120000);

    test('deleting a space takes its links', async () => {
        const second = await createSpace(browser, extensionId, 'Links Gone');
        const spaceId = await second.evaluate(async () => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return spaces.find(s => s.name === 'Links Gone').id;
        });
        const { windowId, tabIds } = await d.openWindow(['gone-one']);
        await page.evaluate(
            (tabId, spaceId) => chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId, spaceId }),
            tabIds[0],
            spaceId
        );
        await d.closeWindow(windowId);
        await d.waitForLinks(1);
        expect((await d.links())[0].spaceId).toBe(spaceId);

        await page.evaluate(async spaceId => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            await chrome.runtime.sendMessage({
                type: 'spaceStore',
                action: 'patch',
                before: spaces,
                after: spaces.filter(s => s.id !== spaceId)
            });
        }, spaceId);
        await d.waitForLinks(0);
        await second.close();
    });

    test('a private window leaves no links', async () => {
        // The extension is not allowed in private windows, so it sees nothing there; this proves a
        // private page never ends up as a link.
        const context = await browser.createBrowserContext();
        const privatePage = await context.newPage();
        await privatePage.goto(`${base}/private-page`);
        await privatePage.close();
        await context.close();
        await sleep(1500);
        expect(await d.links()).toEqual([]);
    });
});

// Quitting Chrome keeps links. The profile is reused, as a restart does: once starting fresh, once
// with "continue where you left off".
describe('quitting and restoring Chrome', () => {
    const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist');
    let profileDir;

    beforeEach(() => {
        profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecove-links-'));
    });
    afterEach(() => {
        fs.rmSync(profileDir, { recursive: true, force: true });
    });

    const launch = async args => {
        const { browser, extensionId } = await launchBrowserWithExtension({
            extensionPath: dist,
            userDataDir: profileDir,
            args
        });
        const page = await openSidebar(browser, extensionId);
        return { browser, page, d: driver(page) };
    };

    test('links stay after a fresh start', async () => {
        let { browser, d } = await launch();
        let page;
        try {
            const { windowId } = await d.openWindow(['quit-one', 'quit-two']);
            await d.closeWindow(windowId);
            await d.waitForLinks(2);
            await sleep(1000);
        } finally {
            await browser.close();
        }

        ({ browser, page, d } = await launch());
        try {
            await d.waitForLinks(2);
            await page.waitForFunction(() => document.querySelectorAll('.space.active .closed-link').length === 2, {
                polling: 100,
                timeout: 10000
            });
            expect((await d.links()).map(l => l.url).sort()).toEqual(
                ['quit-one', 'quit-two'].map(p => `${base}/${p}`).sort()
            );
        } finally {
            await browser.close();
        }
    }, 120000);

    test('links stay after Chrome restores its last session, except for pages that are open again', async () => {
        let { browser, d } = await launch();
        let page;
        try {
            // One window is closed (a link); a page in the window that is open at quit comes back.
            const gone = await d.openWindow(['restore-gone']);
            await d.closeWindow(gone.windowId);
            await d.waitForLinks(1);
            await d.openWindow(['restore-open']);
            await sleep(2000);
        } finally {
            await browser.close();
        }

        ({ browser, page, d } = await launch(['--restore-last-session']));
        try {
            await page.waitForFunction(
                async url => (await chrome.tabs.query({ url })).length > 0,
                { polling: 100, timeout: 15000 },
                `${base}/restore-open`
            );
            await sleep(1500);
            const urls = (await d.links()).map(l => l.url);
            expect(urls).toContain(`${base}/restore-gone`);
            // Open again, so it is a tab and not a link.
            expect(urls).not.toContain(`${base}/restore-open`);
            await page.waitForFunction(
                url => !!document.querySelector(`.space.active .closed-link[data-url="${url}"]`),
                { polling: 100, timeout: 10000 },
                `${base}/restore-gone`
            );
        } finally {
            await browser.close();
        }
    }, 120000);
});
