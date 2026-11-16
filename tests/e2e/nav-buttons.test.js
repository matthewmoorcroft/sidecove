import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar, openOptionsPage } from './helpers/extension-helper.js';

// Issue 64: back, forward and reload at the top of the sidebar, acting on the tab you are looking
// at, with the same keys while the sidebar has focus. A Settings switch hides the row.
let browser, page, options, server, base, tabId, isMac;
const hits = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const button = name => `#navRow [data-nav="${name}"]`;
const click = (name, init = {}) =>
    page.$eval(
        button(name),
        (el, init) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })),
        init
    );
const tabUrl = () => page.evaluate(async id => (await chrome.tabs.get(id)).url, tabId);
const waitForUrl = path =>
    page.waitForFunction(
        async (id, url) => (await chrome.tabs.get(id)).url === url && (await chrome.tabs.get(id)).status === 'complete',
        { polling: 100, timeout: 5000 },
        tabId,
        `${base}${path}`
    );
const waitForHits = async count => {
    const deadline = Date.now() + 5000;
    while (hits.length < count && Date.now() < deadline) await sleep(50);
    expect(hits.length).toBe(count);
};
// The sidebar page is a background tab here, so the keys are sent to it as events. The modifier
// is the platform's own: Command on a Mac, Alt or Ctrl elsewhere.
const press = (code, { shift = false } = {}) =>
    page.evaluate(
        (code, shift, isMac) => {
            const keys = { BracketLeft: 'ArrowLeft', BracketRight: 'ArrowRight' };
            const mac = { metaKey: true };
            const other = code === 'KeyR' ? { ctrlKey: true } : { altKey: true };
            const event = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                shiftKey: shift,
                code: isMac ? code : (keys[code] ?? code),
                ...(isMac ? mac : other)
            });
            document.dispatchEvent(event);
            return event.defaultPrevented;
        },
        code,
        shift,
        isMac
    );

beforeAll(async () => {
    server = createServer((req, res) => {
        if (req.url === '/favicon.ico') return res.writeHead(404).end();
        hits.push({ url: req.url, cacheControl: req.headers['cache-control'] || '' });
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'max-age=3600');
        res.end(`<title>Page ${req.url.slice(1)}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    options = await openOptionsPage(browser, result.extensionId);
    isMac = await page.evaluate(() => /Mac/i.test(navigator.platform));
    // A tab that has been to /one and then /two, and is the one in front.
    tabId = await page.evaluate(async url => (await chrome.tabs.create({ url, active: true })).id, `${base}/one`);
    await waitForUrl('/one');
    // Navigated from the tab's own page, so that /one stays in its history: Chrome's back button
    // skips entries the tab left without any interaction.
    const tabPage = (await browser.pages()).find(candidate => candidate.url() === `${base}/one`);
    await tabPage.goto(`${base}/two`);
    await waitForUrl('/two');
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

test('the row is at the top of the sidebar, above the favorites, and is shown by default', async () => {
    const order = await page.$$eval('#sidebar-container > *', els => els.map(el => el.id));
    expect(order.indexOf('navRow')).toBe(0);
    expect(order.indexOf('pinnedFavicons')).toBeGreaterThan(0);
    expect(await page.$eval('#navRow', el => el.hidden)).toBe(false);
    expect(await page.$$eval('#navRow button', els => els.map(el => el.dataset.nav))).toEqual([
        'back',
        'forward',
        'reload'
    ]);
});

test('Back and Forward move the tab you are looking at through its history', async () => {
    await click('back');
    await waitForUrl('/one');
    await click('forward');
    await waitForUrl('/two');
});

test('Back with nowhere to go does nothing and breaks nothing', async () => {
    await click('back');
    await waitForUrl('/one');
    await click('back');
    await sleep(500);
    expect(await tabUrl()).toBe(`${base}/one`);
    await click('forward');
    await waitForUrl('/two');
});

test('Reload reloads the tab, and Shift-click reloads without the cache', async () => {
    hits.length = 0;
    await click('reload');
    await waitForHits(1);
    expect(hits[0].cacheControl).not.toContain('no-cache');
    await click('reload', { shiftKey: true });
    await waitForHits(2);
    expect(hits[1].cacheControl).toContain('no-cache');
});

test('the keys do the same while the sidebar has focus, and the sidebar keeps them to itself', async () => {
    expect(await press('BracketLeft')).toBe(true);
    await waitForUrl('/one');
    expect(await press('BracketRight')).toBe(true);
    await waitForUrl('/two');
    hits.length = 0;
    expect(await press('KeyR')).toBe(true);
    await waitForHits(1);
    expect(await press('KeyR', { shift: true })).toBe(true);
    await waitForHits(2);
    expect(hits[1].cacheControl).toContain('no-cache');
});

test('the Settings switch hides the row, and the keys still work', async () => {
    expect(await options.$eval('#showNavButtons', input => input.checked)).toBe(true);
    await options.$eval('#showNavButtons', input => input.click());
    await page.waitForFunction(() => document.getElementById('navRow').hidden, { polling: 100 });
    expect(await page.$eval('#navRow', el => getComputedStyle(el).display)).toBe('none');
    expect(await press('BracketLeft')).toBe(true);
    await waitForUrl('/one');
    await options.$eval('#showNavButtons', input => input.click());
    await page.waitForFunction(() => !document.getElementById('navRow').hidden, { polling: 100 });
});
