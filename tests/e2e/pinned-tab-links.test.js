/**
 * E2E tests for links opened from a space's pinned tab, and the setting "Links opened from a
 * pinned tab". By default such a link opens at the top of the tab list, unpinned. With "Open as
 * a new pinned tab" it becomes a pinned tab directly under the one it came from, in the same
 * folder, also while the side panel is closed. A link from a top-bar favorite always opens
 * unpinned in the tab list, whatever the setting says.
 */
import { createServer } from 'node:http';
import {
    launchBrowserWithExtension,
    openSidebar,
    openOptionsPage,
    getBackgroundServiceWorker
} from './helpers/extension-helper.js';
import { delay } from './helpers/test-utils.js';

const LINKS = ['c1', 'c2', 'c3'];

describe('Links opened from a pinned tab', () => {
    let server;
    let origin;
    let browser;
    let extensionId;
    let sidebar;
    let pages;

    beforeAll(async () => {
        server = createServer((req, res) => {
            const name = req.url.split('?')[0].slice(1);
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Connection', 'close');
            const links = LINKS.map(c => `<a id="${c}" href="/${c}">${c}</a>`)
                .concat('<button id="popup" onclick="window.open(\'/popup\')">popup</button>')
                .join(' ');
            res.end(`<title>Page ${name}</title>${['p', 'fav'].includes(name) ? links : name}`);
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

    // Opens p (to be the pinned tab), t1 and fav, then a sidebar, and pins p in the space.
    async function start(pinnedTabLinks) {
        ({ browser, extensionId } = await launchBrowserWithExtension());
        pages = {};
        for (const name of ['p', 't1', 'fav']) {
            pages[name] = await browser.newPage();
            await pages[name].goto(`${origin}/${name}`, { waitUntil: 'domcontentloaded' });
        }
        sidebar = await openSidebar(browser, extensionId);
        if (pinnedTabLinks)
            await sidebar.evaluate(value => chrome.storage.sync.set({ pinnedTabLinks: value }), pinnedTabLinks);
        // As the context menu's Pin Tab does: the worker hands it to this window's panel.
        await sidebar.evaluate(async url => {
            const [tab] = await chrome.tabs.query({ url });
            await chrome.runtime.sendMessage({ command: 'toggleSpacePin', tabId: tab.id });
        }, `${origin}/p`);
        await expectPinned(['p']);
    }

    async function clickLinks(page, ids, { meta = true } = {}) {
        await page.bringToFront();
        for (const id of ids) {
            const { x, y } = await page.$eval(`#${id}`, el => {
                const box = el.getBoundingClientRect();
                return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            });
            if (meta) await page.keyboard.down('Meta');
            await page.mouse.click(x, y);
            if (meta) await page.keyboard.up('Meta');
            await delay(400);
        }
    }

    const nameOf = url => url.slice(url.lastIndexOf('/') + 1);

    // Page names in one section of the active space, top to bottom.
    function shown(section) {
        return sidebar.evaluate(async section => {
            const rows = document.querySelectorAll(`.space.active [data-tab-type="${section}"] .tab[data-tab-id]`);
            const names = [];
            for (const row of rows) {
                const tab = await chrome.tabs.get(Number(row.dataset.tabId));
                const url = tab.url || tab.pendingUrl || '';
                names.push(url.slice(url.lastIndexOf('/') + 1));
            }
            return names;
        }, section);
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

    const expectPinned = expected => eventually(() => shown('pinned'), expected);
    // Only the pages this test opens; the list may also hold the sidebar's own helper tabs.
    const expectListed = expected =>
        eventually(
            async () => (await shown('temporary')).filter(name => [...LINKS, 't1', 'popup'].includes(name)),
            expected
        );

    // The bookmarks of the space folder, folders as [name, children], read in the worker.
    async function spaceBookmarks() {
        const worker = await getBackgroundServiceWorker(browser);
        const tree = await worker.evaluate(async () => {
            const [root] = (await chrome.bookmarks.search({ title: 'Sidecove' })).filter(node => !node.url);
            const [folder] = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url);
            const read = async id =>
                Promise.all(
                    (await chrome.bookmarks.getChildren(id)).map(async node =>
                        node.url ? node.url : [node.title, await read(node.id)]
                    )
                );
            return read(folder.id);
        });
        const names = items => items.map(item => (Array.isArray(item) ? [item[0], names(item[1])] : nameOf(item)));
        return names(tree);
    }

    test('by default, links from a pinned tab open at the top of the tab list, unpinned', async () => {
        await start();
        await clickLinks(pages.p, ['c1', 'c2']);
        await expectListed(['c1', 'c2', 't1']);
        await expectPinned(['p']);
        expect(await spaceBookmarks()).toEqual(['p']);
    }, 90000);

    test('set to open as a new pinned tab, links stack under their pinned tab in opening order', async () => {
        await start('pin');
        await clickLinks(pages.p, ['c1', 'c2', 'c3']);
        await expectPinned(['p', 'c1', 'c2', 'c3']);
        await expectListed(['t1']);
        expect(await spaceBookmarks()).toEqual(['p', 'c1', 'c2', 'c3']);
        // The new bookmark takes the page's title once it has loaded.
        await eventually(async () => {
            const worker = await getBackgroundServiceWorker(browser);
            return worker.evaluate(async url => (await chrome.bookmarks.search({ url }))[0]?.title, `${origin}/c1`);
        }, 'Page c1');
    }, 90000);

    test('with the side panel closed, the link still becomes a pinned tab under its pinned tab', async () => {
        await start('pin');
        await sidebar.close();
        await clickLinks(pages.p, ['c1', 'c2']);
        await eventually(spaceBookmarks, ['p', 'c1', 'c2']);
        sidebar = await openSidebar(browser, extensionId);
        await expectPinned(['p', 'c1', 'c2']);
        await expectListed(['t1']);
    }, 90000);

    test('a link from a pinned tab inside a folder becomes a pinned tab in that folder, under it', async () => {
        await start('pin');
        const worker = await getBackgroundServiceWorker(browser);
        await worker.evaluate(async url => {
            const [mark] = await chrome.bookmarks.search({ url });
            const folder = await chrome.bookmarks.create({ parentId: mark.parentId, title: 'Work' });
            await chrome.bookmarks.create({ parentId: folder.id, title: 'Other', url: 'https://other.test/other' });
            await chrome.bookmarks.move(mark.id, { parentId: folder.id, index: 0 });
        }, `${origin}/p`);
        await eventually(spaceBookmarks, [['Work', ['p', 'other']]]);
        await clickLinks(pages.p, ['c1']);
        await eventually(spaceBookmarks, [['Work', ['p', 'c1', 'other']]]);
    }, 90000);

    test('a page a pinned tab opens with window.open becomes a pinned tab too', async () => {
        await start('pin');
        await clickLinks(pages.p, ['popup'], { meta: false });
        await expectPinned(['p', 'popup']);
        expect(await spaceBookmarks()).toEqual(['p', 'popup']);
    }, 90000);

    test('a page Sidecove opens while a pinned tab is active is not pinned', async () => {
        await start('pin');
        await pages.p.bringToFront();
        await delay(400);
        // As opening a favorite or restoring an archived tab does.
        const worker = await getBackgroundServiceWorker(browser);
        await worker.evaluate(url => chrome.tabs.create({ url, active: false }), `${origin}/c1`);
        await expectListed(['c1', 't1']);
        await delay(1000);
        await expectPinned(['p']);
        expect(await spaceBookmarks()).toEqual(['p']);
    }, 90000);

    test('a link from a top-bar favorite opens unpinned in the tab list, even set to open as a new pinned tab', async () => {
        await start('pin');
        await sidebar.evaluate(async url => {
            const [tab] = await chrome.tabs.query({ url });
            await chrome.tabs.update(tab.id, { pinned: true });
        }, `${origin}/fav`);
        await delay(500);
        await clickLinks(pages.fav, ['c1', 'c2']);
        await expectListed(['c1', 'c2', 't1']);
        await expectPinned(['p']);
        expect(await spaceBookmarks()).toEqual(['p']);
    }, 90000);
    test('the settings page offers the choice, starts on the tab list and keeps what you pick', async () => {
        ({ browser, extensionId } = await launchBrowserWithExtension());
        const options = await openOptionsPage(browser, extensionId);
        const read = () =>
            options.evaluate(() => {
                const select = document.getElementById('pinnedTabLinks');
                return {
                    label: document.querySelector('label[for="pinnedTabLinks"]').textContent,
                    value: select.value,
                    choices: [...select.options].map(option => option.textContent)
                };
            });
        expect(await read()).toEqual({
            label: 'Links opened from a pinned tab',
            value: 'list',
            choices: ['Open in the tab list', 'Open as a new pinned tab']
        });
        await options.select('#pinnedTabLinks', 'pin');
        await eventually(
            () => options.evaluate(async () => (await chrome.storage.sync.get('pinnedTabLinks')).pinnedTabLinks),
            'pin'
        );
        await options.reload({ waitUntil: 'networkidle0' });
        await eventually(async () => (await read()).value, 'pin');
    }, 60000);
});
