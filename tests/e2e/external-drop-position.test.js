import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// A link dragged from a page over the open tabs list shows the reorder line between rows and
// opens where the line was, in the list and next to the same tabs in Chrome's tab strip. It never
// splits a tab, even held over a tab's middle. The drag is dispatched as DOM events, as in
// external-drop.test.js, because a real drag from another page cannot be driven from a test.
let browser, page, server, base, ids;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = '.space.active [data-tab-type="temporary"] .tab[data-tab-id]';
const listedIds = () => page.$$eval(rows, els => els.map(el => Number(el.dataset.tabId)));

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1)}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    await page.setViewport({ width: 360, height: 800 });
    ids = await page.evaluate(async base => {
        const { id: windowId } = await chrome.windows.getCurrent();
        const made = [];
        for (const name of ['one', 'two', 'three']) {
            made.push((await chrome.tabs.create({ url: `${base}/${name}`, windowId, active: false })).id);
        }
        for (let i = 0; i < 100; i++) {
            const tabs = await Promise.all(made.map(id => chrome.tabs.get(id)));
            if (tabs.every(tab => tab.status === 'complete' && tab.title)) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return made;
    }, base);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`.space.active .tab[data-tab-id="${ids[2]}"]`);
    await sleep(500);
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

/**
 * Drags a link from a page over the row with `tabId` at `at` (a fraction of its height), holding
 * it there for `holdMs`, then drops it unless `drop` is false. Reports what the list showed.
 */
async function dragLinkOver(url, tabId, { at, holdMs = 0, drop = true }) {
    const fire = type =>
        page.evaluate(
            ({ type, url, tabId, at }) => {
                const row = document.querySelector(`.space.active .tab[data-tab-id="${tabId}"]`);
                const r = row.getBoundingClientRect();
                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/uri-list', url);
                dataTransfer.setData('text/plain', url);
                const event = new DragEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer,
                    clientX: r.left + r.width / 2,
                    clientY: r.top + r.height * at
                });
                row.dispatchEvent(event);
                const line = document.querySelector('.drop-line.visible');
                return {
                    line: line ? Number.parseFloat(line.style.top) : null,
                    rowTop: r.top,
                    rowBottom: r.bottom,
                    splitHint: Boolean(document.querySelector('.tab.split-target'))
                };
            },
            { type, url, tabId, at }
        );
    await fire('dragenter');
    let state = await fire('dragover');
    for (let waited = 0; waited < holdMs; waited += 100) {
        await sleep(100);
        state = await fire('dragover');
    }
    if (drop) await fire('drop');
    return state;
}

// The tab Chrome opened for `url`, once the list shows it.
async function openedTab(url) {
    for (let i = 0; i < 50; i++) {
        const tab = await page.evaluate(
            async url => (await chrome.tabs.query({})).find(t => (t.url || t.pendingUrl) === url) ?? null,
            url
        );
        if (tab && (await listedIds()).includes(tab.id)) return tab;
        await sleep(100);
    }
    throw new Error(`no listed tab for ${url}`);
}

const chromeIndex = id => page.evaluate(async id => (await chrome.tabs.get(id)).index, id);

test('a link dragged over the upper half of a row shows the line above it and opens there', async () => {
    const before = await listedIds();
    const target = before[1];
    const url = `${base}/above-second`;
    const state = await dragLinkOver(url, target, { at: 0.25 });
    // The line is the reorder line, at the row's top edge.
    expect(state.line).not.toBeNull();
    expect(Math.abs(state.line - state.rowTop)).toBeLessThan(4);

    const tab = await openedTab(url);
    await sleep(300);
    const after = await listedIds();
    expect(after[after.indexOf(tab.id) + 1]).toBe(target);
    expect(after.filter(id => id !== tab.id)).toEqual(before);
    // In Chrome's tab strip it stands next to the same row.
    expect(Math.abs((await chromeIndex(target)) - tab.index)).toBe(1);
    expect(await page.$('.drop-line.visible')).toBeNull();
});

test('a link dragged over the lower half of the last row opens at the end of the list', async () => {
    const before = await listedIds();
    const last = before.at(-1);
    const url = `${base}/at-the-end`;
    const state = await dragLinkOver(url, last, { at: 0.75 });
    expect(Math.abs(state.line - state.rowBottom)).toBeLessThan(4);
    const tab = await openedTab(url);
    await sleep(300);
    const after = await listedIds();
    expect(after.at(-1)).toBe(tab.id);
    expect(Math.abs((await chromeIndex(last)) - tab.index)).toBe(1);
});

test('a link held over the middle of a tab is never split with it and opens beside it', async () => {
    const before = await listedIds();
    const target = before[0];
    const url = `${base}/held-on-middle`;
    const state = await dragLinkOver(url, target, { at: 0.5, holdMs: 800 });
    expect(state.splitHint).toBe(false);
    const tab = await openedTab(url);
    await sleep(300);
    expect(adjacentIn(await listedIds(), tab.id, target)).toBe(true);
    const split = await page.evaluate(
        async ids => Promise.all(ids.map(async id => (await chrome.tabs.get(id)).splitViewId ?? -1)),
        [tab.id, target]
    );
    expect(split).toEqual([-1, -1]);
});

test('a link dragged away from the list shows no line', async () => {
    const state = await dragLinkOver(`${base}/never-dropped`, ids[0], { at: 0.25, drop: false });
    expect(state.line).not.toBeNull();
    await page.evaluate(() => {
        const root = document.getElementById('sidebar-container');
        root.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null }));
    });
    expect(await page.$('.drop-line.visible')).toBeNull();
});

function adjacentIn(order, a, b) {
    return Math.abs(order.indexOf(a) - order.indexOf(b)) === 1;
}
