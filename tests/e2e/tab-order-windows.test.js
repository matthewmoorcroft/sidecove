import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar, openSidebarInWindow } from './helpers/extension-helper.js';

// With tabs from all windows on, every window's panel lists the pages in the same order, and
// opening a page here from another window's tab does not move it. So next and previous visit each
// entry once in either window, with no jump.
let browser, one, two, server, base, win;
// The panel lists the newest tab on top, so the pages read bottom to top as they were opened.
const SHOWN = ['R', 'Q', 'P', 'G'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const pagesIn = panel =>
    panel.$$eval('.space.active .tab[data-tab-id]', rows =>
        rows.map(row => row.dataset.url).filter(url => url?.includes('/walk-'))
    );
// A panel in a window that is not in front is hidden and does not redraw, so each is brought up to
// be read.
const sameOrder = async () => {
    await one.bringToFront();
    const a = await pagesIn(one);
    await two.bringToFront();
    const b = await pagesIn(two);
    return a.length === b.length && a.every((url, i) => url === b[i]) ? a : null;
};
const settled = async expected => {
    for (let i = 0; i < 100; i++) {
        const order = await sameOrder();
        if (order && order.length === expected.length && order.every((url, i) => url.endsWith(expected[i]))) return;
        await sleep(100);
    }
    const dump = await one.evaluate(async () => ({
        spaces: (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces.map(s => [
            s.name,
            s.temporaryTabs
        ]),
        tabs: (await chrome.tabs.query({})).map(t => [t.id, t.windowId, t.url])
    }));
    dump.two = await two.$$eval('.space', els => els.map(e => [e.className, e.querySelectorAll('.tab').length]));
    await one.bringToFront();
    throw new Error(
        `Panels disagree: ${JSON.stringify([await pagesIn(one), await pagesIn(two)])} ${JSON.stringify(dump)}`
    );
};
const open = (windowId, name, active = false) =>
    one.evaluate(
        (windowId, url, active) => chrome.tabs.create({ windowId, url, active }).then(tab => tab.id),
        windowId,
        `${base}/walk-${name}`,
        active
    );
const tabUrl = id => one.evaluate(id => chrome.tabs.get(id).then(tab => tab.url), id);
const activeUrl = windowId =>
    one.evaluate(async windowId => (await chrome.tabs.query({ active: true, windowId }))[0].url, windowId);
// Reading a panel brings it to the front of its window, so the tab stepped from is put back in
// front first. Returns the page now shown, and its tab.
let at;
const filed = id =>
    one.evaluate(
        async id =>
            (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces.some(space =>
                space.temporaryTabs.includes(id)
            ),
        id
    );
const step = async direction => {
    await one.evaluate(id => chrome.tabs.update(id, { active: true }), at);
    for (let i = 0; i < 50 && (await activeUrl(win.two)) !== (await tabUrl(at)); i++) await sleep(100);
    const before = at;
    // A copy only joins the walk once the space has filed it.
    for (let i = 0; i < 50 && !(await filed(at)); i++) await sleep(100);
    await one.evaluate(direction => chrome.runtime.sendMessage({ command: 'stepTabInSpace', direction }), direction);
    for (let i = 0; i < 50; i++) {
        const now = await one.evaluate(
            async windowId => (await chrome.tabs.query({ active: true, windowId }))[0],
            win.two
        );
        if (now.id !== before) {
            at = now.id;
            return (now.url || now.pendingUrl).replace(base, '');
        }
        await sleep(100);
    }
    throw new Error(`Stepping ${direction} stayed on tab ${before}`);
};

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    one = await openSidebar(browser, result.extensionId);
    one.on('pageerror', error => console.error('Sidebar error:', error.message));
    win = await one.evaluate(async () => {
        const here = await chrome.windows.getCurrent();
        const other = await chrome.windows.create({ url: 'about:blank', focused: false });
        return { one: here.id, two: other.id };
    });
    two = await openSidebarInWindow(browser, result.extensionId, one, win.two, {
        query: '?panel=two',
        onPageError: error => console.error('Second panel error:', error.message)
    });
    await two.bringToFront();
    await one.bringToFront();
    await one.waitForSelector('.space.active');
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

// The shortcuts walk from the window that was last focused, which is window two here: windows
// cannot be re-focused under automation, so the laps below run there; window one's list is the
// same function, and is compared in the panels and in unit tests.
const tabsAtPage = name =>
    one.evaluate(async name => (await chrome.tabs.query({})).filter(t => (t.url || t.pendingUrl).endsWith(name)), name);
const entriesIn = panel => panel.$$eval('.space.active .tab[data-tab-id]', rows => rows.length);
const lap = async () => {
    await two.bringToFront();
    const length = await entriesIn(two);
    const seen = [];
    for (let i = 0; i < length; i++) seen.push(await step('next'));
    // Every entry once: no page twice, and back where it began after a full lap.
    expect(new Set(seen).size).toBe(length);
    expect(await step('next')).toBe(seen[0]);
    await settled(SHOWN);
};

test('both windows list the same order as copies are opened, and the walk visits each entry once', async () => {
    at = await open(win.two, 'G');
    for (const name of ['P', 'Q', 'R']) await open(win.one, name);
    await one.reload({ waitUntil: 'domcontentloaded' });
    await two.reload({ waitUntil: 'domcontentloaded' });
    await settled(SHOWN);

    // Walking window two opens copies of P, Q and R there; the order stays the same in both.
    await lap();
    // Window one opens a copy of G, and walks again.
    await open(win.one, 'G');
    await settled(SHOWN);
    await lap();
    expect((await tabsAtPage('walk-P')).filter(tab => tab.windowId === win.two)).toHaveLength(1);
});
