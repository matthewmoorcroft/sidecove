import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// A link or some text dragged from a page onto the sidebar opens in a new tab of the current
// space; text opens a web search. The drag is dispatched as DOM events, as helpers/drag.js does,
// because a real drag from another page cannot be driven from a test.
let browser, page, server, base;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    await page.setViewport({ width: 360, height: 800 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.space.active .space-name');
    await sleep(800);
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

// Drag something carrying `data` over the panel, then (optionally) drop it. Reports the panel's state.
async function dragFromPage(data, { drop = true } = {}) {
    return page.evaluate(
        ({ data, drop }) => {
            const root = document.getElementById('sidebar-container');
            const target = document.querySelector('.space.active .tab-list, .space.active') || root;
            const dataTransfer = new DataTransfer();
            for (const [type, value] of Object.entries(data)) dataTransfer.setData(type, value);
            const fire = type => {
                const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
                target.dispatchEvent(event);
                return event;
            };
            fire('dragenter');
            const over = fire('dragover');
            const state = {
                highlighted: root.classList.contains('external-drop-active'),
                kind: root.dataset.externalDrop ?? null,
                caption: getComputedStyle(root, '::after').content,
                allowed: over.defaultPrevented
            };
            if (drop) fire('drop');
            state.afterDrop = root.classList.contains('external-drop-active');
            return state;
        },
        { data, drop }
    );
}

// The tab Chrome opened for an address (loaded or still pending), and the space it landed in.
async function findTab(urlStart) {
    for (let i = 0; i < 50; i++) {
        const found = await page.evaluate(async urlStart => {
            const tab = (await chrome.tabs.query({})).find(t => (t.url || t.pendingUrl || '').startsWith(urlStart));
            if (!tab) return null;
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const owner = spaces.find(s => s.temporaryTabs.includes(tab.id));
            return { id: tab.id, space: owner?.name ?? null };
        }, urlStart);
        if (found?.space) return found;
        await sleep(100);
    }
    return null;
}

const tabCount = () => page.evaluate(async () => (await chrome.tabs.query({})).length);

test('a link dropped on the sidebar opens in a new tab of the current space, with a drop target shown', async () => {
    const activeSpace = await page.$eval('.space.active .space-name', el => el.value);
    const url = `${base}/dropped-link`;
    const state = await dragFromPage({ 'text/uri-list': url, 'text/plain': url });

    expect(state).toMatchObject({ highlighted: true, kind: 'link', allowed: true, afterDrop: false });
    expect(state.caption).toContain('Drop to open');
    const tab = await findTab(url);
    expect(tab?.space).toBe(activeSpace);
});

test('text dropped on the sidebar opens a web search for it', async () => {
    const state = await dragFromPage({ 'text/plain': 'sidecove drop test' });

    expect(state).toMatchObject({ highlighted: true, kind: 'text', afterDrop: false });
    expect(state.caption).toContain('search');
    const tab = await findTab('https://www.google.com/search?q=sidecove%20drop%20test');
    expect(tab).not.toBeNull();
    await page.evaluate(id => chrome.tabs.remove(id), tab.id);
});

test('a dropped file, or anything that is not a link or text, opens nothing', async () => {
    const before = await tabCount();
    const file = await dragFromPage({ Files: '' });
    const other = await dragFromPage({ 'text/html': '<b>hello</b>' });
    await sleep(500);

    expect(file).toMatchObject({ highlighted: false, afterDrop: false });
    expect(other.highlighted).toBe(false);
    expect(await tabCount()).toBe(before);
});

test('dragging a tab within the sidebar shows no drop target and opens nothing', async () => {
    // Seed one tab row, then drag it the way the sidebar's own drag does.
    const tabId = await page.evaluate(
        async url => (await chrome.tabs.create({ url, active: false })).id,
        `${base}/row`
    );
    await page.waitForSelector(`.space.active .tab[data-tab-id="${tabId}"]`);
    const before = await tabCount();
    const state = await page.evaluate(tabId => {
        const row = document.querySelector(`.space.active .tab[data-tab-id="${tabId}"]`);
        const root = document.getElementById('sidebar-container');
        const dataTransfer = new DataTransfer();
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
        const highlighted = root.classList.contains('external-drop-active');
        row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        return { highlighted };
    }, tabId);
    await sleep(500);

    expect(state.highlighted).toBe(false);
    expect(await tabCount()).toBe(before);
});
