/**
 * E2E tests for the right-click menu of a row in a space. An ordinary tab, a pinned tab and a
 * favorite with no open tab share one layout: Copy Link; Rename and Mute; arranging (favorite, pin,
 * duplicate, move); then Close Tab and the type's own removal. A pinned tab's Close Tab closes
 * the tab and keeps the pin.
 */
import { createServer } from 'node:http';
import { launchBrowserWithExtension, createSpace, openSidebar } from './helpers/extension-helper.js';

describe('Tab menus', () => {
    let server;
    let origin;
    let browser;
    let sidebar;
    let ids;
    let bookmarkIds;
    const NAMES = ['plain', 'pinned', 'saved'];

    beforeAll(async () => {
        server = createServer((req, res) => {
            const name = req.url.split('?')[0].slice(1);
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Connection', 'close');
            res.end(`<title>Page ${name}</title>${name}`);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        origin = `http://127.0.0.1:${server.address().port}`;

        const launched = await launchBrowserWithExtension();
        browser = launched.browser;
        ids = {};
        for (const name of NAMES) {
            const page = await browser.newPage();
            await page.goto(`${origin}/${name}`, { waitUntil: 'domcontentloaded' });
        }
        sidebar = await openSidebar(browser, launched.extensionId);
        for (const name of NAMES) {
            ids[name] = await sidebar.evaluate(
                async url => (await chrome.tabs.query({ url }))[0].id,
                `${origin}/${name}`
            );
            await sidebar.waitForSelector(`.space.active .tab[data-tab-id="${ids[name]}"]`);
        }
        const homeId = await sidebar.$eval('.space.active', el => el.dataset.spaceId);

        // The same Pin Tab the menu runs; the worker saves the bookmark.
        bookmarkIds = {};
        for (const name of ['pinned', 'saved']) {
            await sidebar.evaluate(
                tabId => chrome.runtime.sendMessage({ command: 'toggleSpacePin', tabId }),
                ids[name]
            );
            await sidebar.waitForFunction(
                id => document.querySelector(`[data-tab-type="pinned"] .tab[data-tab-id="${id}"][data-bookmark-id]`),
                { polling: 100 },
                ids[name]
            );
            bookmarkIds[name] = await sidebar.$eval(`.tab[data-tab-id="${ids[name]}"]`, el => el.dataset.bookmarkId);
        }
        // Closing a pinned tab leaves its favorite with no open tab.
        await sidebar.evaluate(tabId => chrome.tabs.remove(tabId), ids.saved);
        await sidebar.waitForSelector(`.bookmark-only[data-bookmark-id="${bookmarkIds.saved}"]`);

        // A second space, so Move to Space has somewhere to go; then back to the first.
        await sidebar.close();
        sidebar = await createSpace(browser, launched.extensionId, 'Other');
        await sidebar.$eval(`#spaceSwitcher button[data-space-id="${homeId}"]`, button => button.click());
        await sidebar.waitForFunction(
            id => document.querySelector('.space.active')?.dataset.spaceId === id,
            { polling: 100 },
            homeId
        );
    });

    afterAll(async () => {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    });

    const rows = {
        plain: () => `.tab[data-tab-id="${ids.plain}"]`,
        pinned: () => `.tab[data-tab-id="${ids.pinned}"]`,
        saved: () => `.bookmark-only[data-bookmark-id="${bookmarkIds.saved}"]`
    };

    // The top level of the menu, top to bottom, with '-' for a separator. Split view appears only
    // where this Chrome has it, so it is left out here and covered by split-view.test.js.
    async function menuOf(row) {
        await sidebar.evaluate(() => document.getElementById('tab-context-menu')?.remove());
        await sidebar.$eval(`.space.active ${row}`, el => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 })
            );
        });
        await sidebar.waitForSelector('#tab-context-menu .context-menu-item');
        return sidebar.$$eval('#tab-context-menu > *', nodes =>
            nodes
                .map(node => (node.classList.contains('context-menu-separator') ? '-' : node.firstChild.textContent))
                .filter(label => !/Split View/.test(label))
        );
    }

    async function choose(label) {
        await sidebar.evaluate(
            label =>
                [...document.querySelectorAll('#tab-context-menu > .context-menu-item')]
                    .find(item => item.firstChild.textContent === label)
                    .click(),
            label
        );
    }

    test('an ordinary tab: link, edit, arrange, then Close Tab and Archive Tab', async () => {
        expect(await menuOf(rows.plain())).toEqual([
            'Copy Link',
            '-',
            'Rename Tab',
            'Mute Tab',
            '-',
            'Add to Favorites',
            'Pin Tab',
            'Duplicate Tab',
            'Move to Space',
            '-',
            'Close Tab',
            'Archive Tab'
        ]);
    });

    test('a pinned tab: the same groups, with its own pin actions', async () => {
        expect(await menuOf(rows.pinned())).toEqual([
            'Copy Link',
            '-',
            'Rename Tab',
            'Mute Tab',
            'Replace Bookmark URL with Current URL',
            '-',
            'Add to Favorites',
            'Duplicate Tab',
            'Move to Space',
            '-',
            'Close Tab',
            'Archive Tab',
            'Unpin Tab'
        ]);
    });

    test('a favorite with no open tab: only what works without a tab', async () => {
        expect(await menuOf(rows.saved())).toEqual(['Copy Link', '-', 'Move to Space', '-', 'Remove Bookmark']);
    });

    test('Close Tab on a pinned tab closes the tab and keeps the pin', async () => {
        await menuOf(rows.pinned());
        await choose('Close Tab');
        await sidebar.waitForSelector(`.bookmark-only[data-bookmark-id="${bookmarkIds.pinned}"]`);
        const open = await sidebar.evaluate(
            tabId =>
                chrome.tabs.get(tabId).then(
                    () => true,
                    () => false
                ),
            ids.pinned
        );
        expect(open).toBe(false);
        const kept = await sidebar.evaluate(
            id =>
                chrome.bookmarks.get(id).then(
                    ([bookmark]) => bookmark.url,
                    () => null
                ),
            bookmarkIds.pinned
        );
        expect(kept).toBe(`${origin}/pinned`);
    });

    test('Close Tab on an ordinary tab closes it', async () => {
        await menuOf(rows.plain());
        await choose('Close Tab');
        await sidebar.waitForFunction(
            id => !document.querySelector(`.tab[data-tab-id="${id}"]`),
            { polling: 100 },
            ids.plain
        );
        const open = await sidebar.evaluate(
            tabId =>
                chrome.tabs.get(tabId).then(
                    () => true,
                    () => false
                ),
            ids.plain
        );
        expect(open).toBe(false);
    });
});
