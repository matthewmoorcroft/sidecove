/**
 * E2E tests for where a tab opened from a link lands in the tab list (issue 35).
 * A link opened from a tab in the list sits below it, and several links from one tab stack in
 * opening order while you stay on it. As in Chrome, switching to another tab and back starts
 * again: the next link goes directly below the tab. The "Show new tabs at the top" setting
 * does not matter. A link opened from a favourite goes to the top of the tab list. New tabs
 * still obey the setting. A link dragged away from its tab, or closed, does not decide where
 * the next one lands (issue 59).
 */
import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { delay } from './helpers/test-utils.js';

const NAMES = ['t1', 't2', 't3', 'c1', 'c2', 'c3', 'd1', 'blank', 'popup'];

describe('Link tab order', () => {
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
            const links = ['c1', 'c2', 'c3']
                .map(c => `<a id="${c}" href="/${c}">${c}</a>`)
                .concat(
                    '<a id="blank" href="/blank" target="_blank">blank</a>',
                    '<button id="popup" onclick="window.open(\'/popup\')">popup</button>'
                )
                .join(' ');
            const otherLinks = '<a id="d1" href="/d1">d1</a>';
            res.end(`<title>${name}</title>${name === 't2' ? links : name === 't3' ? otherLinks : name}`);
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

    // Opens t1, t2 and t3 in that order, with the setting as given, and a sidebar to read.
    async function start(invertTabOrder) {
        ({ browser, extensionId } = await launchBrowserWithExtension());
        pages = {};
        for (const name of ['t1', 't2', 't3']) {
            pages[name] = await browser.newPage();
            await pages[name].goto(`${origin}/${name}`, { waitUntil: 'domcontentloaded' });
        }
        sidebar = await openSidebar(browser, extensionId);
        await sidebar.evaluate(value => chrome.storage.sync.set({ invertTabOrder: value }), invertTabOrder);
        // Let the service worker pick the setting up before any tab is opened.
        await delay(500);
        await sidebar.reload({ waitUntil: 'domcontentloaded' });
        await delay(1000);
    }

    // Real mouse input at the element's position. page.click waits on a layout check that
    // never finishes in the current Chrome for Testing, so it is not used here.
    async function clickAt(page, selector, { meta = false } = {}) {
        await page.bringToFront();
        const { x, y } = await page.$eval(selector, el => {
            const box = el.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
        if (meta) await page.keyboard.down('Meta');
        await page.mouse.click(x, y);
        if (meta) await page.keyboard.up('Meta');
        await delay(400);
    }

    const cmdClick = (page, selector) => clickAt(page, selector, { meta: true });

    // The names of the tabs in the tab list, top to bottom, for the pages this test knows.
    function listed() {
        return sidebar.evaluate(async known => {
            const rows = document.querySelectorAll('[data-tab-type="temporary"] .tab[data-tab-id]');
            const names = [];
            for (const row of rows) {
                const tab = await chrome.tabs.get(Number(row.dataset.tabId));
                const url = tab.url || tab.pendingUrl || '';
                const name = url.startsWith('chrome://newtab') ? 'new' : url.slice(url.lastIndexOf('/') + 1);
                if (known.includes(name)) names.push(name);
            }
            return names;
        }, NAMES.concat('new'));
    }

    async function expectListed(expected) {
        let actual;
        for (let attempt = 0; attempt < 40; attempt++) {
            actual = await listed();
            if (JSON.stringify(actual) === JSON.stringify(expected)) break;
            await delay(250);
        }
        expect(actual).toEqual(expected);
    }

    // Chrome's own tab strip, left to right, for the pages this test knows.
    async function chromeOrder() {
        const tabs = await sidebar.evaluate(() => chrome.tabs.query({ currentWindow: true }));
        return tabs
            .map(tab => {
                const url = tab.url || tab.pendingUrl || '';
                return url.slice(url.lastIndexOf('/') + 1);
            })
            .filter(name => NAMES.includes(name));
    }

    test.each([
        ['on', true, ['t3', 't2', 'c1', 'c2', 'c3', 't1'], ['t1', 't2', 'c1', 'c2', 'c3', 't3']],
        ['off', false, ['t1', 't2', 'c1', 'c2', 'c3', 't3'], ['t1', 't2', 'c1', 'c2', 'c3', 't3']]
    ])(
        'three links in a row from one tab stack beneath it in opening order, setting %s',
        async (label, invert, expectedList, expectedChrome) => {
            await start(invert);
            await cmdClick(pages.t2, '#c1');
            await cmdClick(pages.t2, '#c2');
            await cmdClick(pages.t2, '#c3');
            await expectListed(expectedList);
            expect(await chromeOrder()).toEqual(expectedChrome);
        },
        90000
    );

    // Chrome's own model: coming back to a tab starts its links again directly beneath it.
    const switchTo = name =>
        sidebar.evaluate(async name => {
            const [tab] = await chrome.tabs.query({ url: `*://127.0.0.1/${name}` });
            await chrome.tabs.update(tab.id, { active: true });
        }, name);

    test.each([
        ['on', true, ['t3', 't2', 'c3', 'c1', 'c2', 't1']],
        ['off', false, ['t1', 't2', 'c3', 'c1', 'c2', 't3']]
    ])(
        'after switching away and back, the next link goes directly below the tab, setting %s',
        async (label, invert, expected) => {
            await start(invert);
            await cmdClick(pages.t2, '#c1');
            await cmdClick(pages.t2, '#c2');
            await switchTo('t3');
            await delay(400);
            await switchTo('t2');
            await delay(400);
            await cmdClick(pages.t2, '#c3');
            await expectListed(expected);
        },
        90000
    );

    test.each([
        ['on', true, ['t3', 'd1', 't2', 'c3', 'c1', 'c2', 't1']],
        ['off', false, ['t1', 't2', 'c3', 'c1', 'c2', 't3', 'd1']]
    ])(
        'links from one tab, links from another, then back: the next link is directly below the first tab, setting %s',
        async (label, invert, expected) => {
            await start(invert);
            await cmdClick(pages.t2, '#c1');
            await cmdClick(pages.t2, '#c2');
            await switchTo('t3');
            await cmdClick(pages.t3, '#d1');
            await switchTo('t2');
            await delay(400);
            await cmdClick(pages.t2, '#c3');
            await expectListed(expected);
        },
        90000
    );

    test.each([
        ['on', true, ['t3', 't2', 'popup', 'blank', 't1']],
        ['off', false, ['t1', 't2', 'popup', 'blank', 't3']]
    ])(
        // Each click brings the opener to the front first, which is a return to the tab, so the
        // second link goes directly below it.
        'a target=_blank link and window.open land below their tab, setting %s',
        async (label, invert, expected) => {
            await start(invert);
            await clickAt(pages.t2, '#blank');
            await clickAt(pages.t2, '#popup');
            await expectListed(expected);
        },
        90000
    );

    test.each([
        ['on', true, ['c1', 'c2', 'c3', 't3', 't1']],
        ['off', false, ['c1', 'c2', 'c3', 't1', 't3']]
    ])(
        'links opened from a favourite go to the top of the tab list in opening order, setting %s',
        async (label, invert, expected) => {
            await start(invert);
            await sidebar.evaluate(async () => {
                const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/t2' });
                await chrome.tabs.update(tab.id, { pinned: true });
            });
            await delay(500);
            await cmdClick(pages.t2, '#c1');
            await cmdClick(pages.t2, '#c2');
            await cmdClick(pages.t2, '#c3');
            await expectListed(expected);
        },
        90000
    );

    test.each([
        ['on', true, ['new', 't3', 't2', 't1']],
        ['off', false, ['t1', 't2', 't3', 'new']]
    ])(
        'new tabs ignore the opener and follow the setting, setting %s',
        async (label, invert, expected) => {
            await start(invert);
            // As the New Tab row does, and as Cmd+T can, with the current tab as an incidental opener.
            await sidebar.evaluate(async () => {
                const [opener] = await chrome.tabs.query({ url: '*://127.0.0.1/t2' });
                await chrome.tabs.create({ openerTabId: opener.id, active: false });
            });
            await expectListed(expected);
        },
        90000
    );

    // Drops one row on the lower half of another, so it lands below it.
    async function dragBelow(sourceName, targetName) {
        const idOf = name =>
            sidebar.evaluate(async name => (await chrome.tabs.query({ url: `*://127.0.0.1/${name}` }))[0]?.id, name);
        const [source, target] = [await idOf(sourceName), await idOf(targetName)];
        await sidebar.evaluate(
            ({ source, target }) => {
                const from = document.querySelector(`.tab[data-tab-id="${source}"]`);
                const to = document.querySelector(`.tab[data-tab-id="${target}"]`);
                const dataTransfer = new DataTransfer();
                const box = to.getBoundingClientRect();
                const point = { clientX: box.left + box.width / 2, clientY: box.bottom - 3 };
                from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
                to.dispatchEvent(
                    new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point })
                );
                to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point }));
                from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
            },
            { source, target }
        );
    }

    test('after its last link is dragged to the bottom, the next link goes directly below the tab', async () => {
        await start(false);
        await cmdClick(pages.t2, '#c1');
        await dragBelow('c1', 't3');
        await expectListed(['t1', 't2', 't3', 'c1']);
        await cmdClick(pages.t2, '#c2');
        await expectListed(['t1', 't2', 'c2', 't3', 'c1']);
    }, 90000);

    test('after its last link is dragged under another tab and closed, the next link goes below the tab', async () => {
        await start(false);
        await cmdClick(pages.t2, '#c1');
        await dragBelow('c1', 't3');
        await expectListed(['t1', 't2', 't3', 'c1']);
        await sidebar.evaluate(async () => {
            const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/c1' });
            await chrome.tabs.remove(tab.id);
        });
        await expectListed(['t1', 't2', 't3']);
        await cmdClick(pages.t2, '#c2');
        await expectListed(['t1', 't2', 'c2', 't3']);
    }, 90000);
});
