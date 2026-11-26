/**
 * E2E tests for where a duplicated tab lands in the tab list (issue 109). As in Arc, the copy is
 * listed directly below the tab it copies, whichever tab you are on when you duplicate it and
 * whichever way the list is drawn. Chrome names the active tab as the copy's opener, so before
 * the fix the copy went below the active tab, as a link from it would. A copy is never pinned as
 * a link from the active pinned tab, even with "Open as a new pinned tab" on.
 */
import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { delay } from './helpers/test-utils.js';

const NAMES = ['a', 'b', 'c', 'd'];

describe('Duplicated tab placement', () => {
    let server;
    let origin;
    let browser;
    let sidebar;
    let ids;

    beforeAll(async () => {
        server = createServer((req, res) => {
            const name = req.url.split('?')[0].slice(1);
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Connection', 'close');
            res.end(`<title>Page ${name}</title>${name}`);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        origin = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
    });

    afterEach(async () => {
        if (browser) await browser.close();
        browser = null;
    });

    // Opens a, b, c and d in that order, with the settings as given, and a sidebar to read.
    async function start(settings = {}) {
        let extensionId;
        ({ browser, extensionId } = await launchBrowserWithExtension());
        ids = {};
        for (const name of NAMES) {
            const page = await browser.newPage();
            await page.goto(`${origin}/${name}`, { waitUntil: 'domcontentloaded' });
        }
        sidebar = await openSidebar(browser, extensionId);
        for (const name of NAMES)
            ids[name] = await sidebar.evaluate(
                async url => (await chrome.tabs.query({ url }))[0].id,
                `${origin}/${name}`
            );
        await sidebar.evaluate(values => chrome.storage.sync.set(values), settings);
        // Let the service worker pick the settings up before any tab is opened.
        await delay(500);
        await sidebar.reload({ waitUntil: 'domcontentloaded' });
        await delay(1000);
    }

    // A real page is the active tab, as with the side panel; the sidebar here is a tab of its own.
    async function activate(name) {
        await sidebar.evaluate(id => chrome.tabs.update(id, { active: true }), ids[name]);
        await delay(300);
    }

    async function duplicateFromMenu(name) {
        await sidebar.$eval(`.space.active .tab[data-tab-id="${ids[name]}"]`, el => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 })
            );
        });
        await sidebar.waitForFunction(
            () =>
                [...document.querySelectorAll('#tab-context-menu .context-menu-item')].some(
                    i => i.textContent === 'Duplicate Tab'
                ),
            { polling: 100 }
        );
        await sidebar.evaluate(() =>
            [...document.querySelectorAll('#tab-context-menu .context-menu-item')]
                .find(i => i.textContent === 'Duplicate Tab')
                .click()
        );
    }

    // Page names in one section of the active space, top to bottom; only this test's pages.
    function shown(section) {
        return sidebar.evaluate(
            async (section, names) => {
                const rows = document.querySelectorAll(`.space.active [data-tab-type="${section}"] .tab[data-tab-id]`);
                const shownNames = [];
                for (const row of rows) {
                    const tab = await chrome.tabs.get(Number(row.dataset.tabId));
                    const url = tab.url || tab.pendingUrl || '';
                    shownNames.push(url.slice(url.lastIndexOf('/') + 1));
                }
                return shownNames.filter(name => names.includes(name));
            },
            section,
            NAMES
        );
    }

    async function eventually(read, expected) {
        let actual;
        for (let attempt = 0; attempt < 40; attempt++) {
            actual = await read();
            if (JSON.stringify(actual) === JSON.stringify(expected)) break;
            await delay(250);
        }
        expect(actual).toEqual(expected);
    }

    const listedOrder = order => (order === 'top' ? [...NAMES].reverse() : NAMES);
    const withCopyOf = (names, name) => names.flatMap(n => (n === name ? [n, n] : [n]));

    for (const [order, invertTabOrder] of [
        ['bottom', false],
        ['top', true]
    ]) {
        test(`Duplicate Tab on a tab you are not on lists the copy directly below it (new tabs at the ${order})`, async () => {
            await start({ invertTabOrder });
            const before = listedOrder(order);
            await eventually(() => shown('temporary'), before);
            // The active tab sits below b, so a copy filed as its link would land under it.
            await activate(before.at(-1));
            await duplicateFromMenu('b');
            await eventually(() => shown('temporary'), withCopyOf(before, 'b'));

            // Chrome's own Duplicate, on a background tab, lands the same way.
            await activate(before[0]);
            await sidebar.evaluate(id => chrome.tabs.duplicate(id), ids.c);
            await eventually(() => shown('temporary'), withCopyOf(withCopyOf(before, 'b'), 'c'));
        });
    }

    test('with all windows off too, the copy is listed directly below the tab it copies', async () => {
        await start({ invertTabOrder: false, showTabsFromAllWindows: false });
        await eventually(() => shown('temporary'), NAMES);
        await activate('d');
        await duplicateFromMenu('b');
        await eventually(() => shown('temporary'), ['a', 'b', 'b', 'c', 'd']);
    });

    test('a copy made while a pinned tab is active stays in the list and saves no bookmark', async () => {
        await start({ invertTabOrder: false, pinnedTabLinks: 'pin' });
        // As the context menu's Pin Tab does: the worker hands it to this window's panel.
        await sidebar.evaluate(id => chrome.runtime.sendMessage({ command: 'toggleSpacePin', tabId: id }), ids.a);
        await eventually(() => shown('pinned'), ['a']);
        await eventually(() => shown('temporary'), ['b', 'c', 'd']);
        await activate('a');
        await duplicateFromMenu('c');
        await eventually(() => shown('temporary'), ['b', 'c', 'c', 'd']);
        // Give a wrong pin time to happen before checking it did not.
        await delay(1000);
        expect(await shown('pinned')).toEqual(['a']);
        expect(await sidebar.evaluate(url => chrome.bookmarks.search({ url }), `${origin}/c`)).toEqual([]);
    });
});
