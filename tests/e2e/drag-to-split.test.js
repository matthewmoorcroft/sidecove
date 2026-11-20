import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { dragOnto, finishHeldDrag, holdDragOver } from './helpers/drag.js';

// Dragging a tab onto another tab and holding it over that tab's middle offers Split View; the
// drop then splits the two through the menu's path. The top and bottom of a row still reorder,
// and a quick drop anywhere reorders as before. On a Chrome without split view nothing is offered.
let browser, page, server, base, supported, ids;
const rows = '.space.active [data-tab-type="temporary"] .tab[data-tab-id]';
const rowSelector = id => `.space.active .tab[data-tab-id="${id}"]`;

const splitIdOf = async id => (await page.evaluate(id => chrome.tabs.get(id), id)).splitViewId ?? -1;
const listedIds = () => page.$$eval(rows, els => els.map(el => Number(el.dataset.tabId)));
const hintedIds = () => page.$$eval('.space.active .tab.split-target', els => els.map(el => Number(el.dataset.tabId)));
const hintText = id => page.$eval(rowSelector(id), el => getComputedStyle(el, '::after').content.replace(/"/g, ''));
const dropLineShown = () => page.$eval('body', () => Boolean(document.querySelector('.drop-line.visible')));

async function openTabs(names) {
    return page.evaluate(
        async (base, names) => {
            const request = async (action, args = {}) => {
                const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...args });
                if (!response.success) throw new Error(response.error);
                return response.spaces;
            };
            const { id: windowId } = await chrome.windows.getCurrent();
            const made = [];
            for (const name of names) {
                made.push((await chrome.tabs.create({ url: `${base}/${name}`, windowId, active: false })).id);
            }
            for (let i = 0; i < 50; i++) {
                const spaces = await request('get');
                if (made.every(id => spaces.some(space => space.temporaryTabs.includes(id)))) break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            for (let i = 0; i < 100; i++) {
                const tabs = await Promise.all(made.map(id => chrome.tabs.get(id)));
                if (tabs.every(tab => tab.status === 'complete' && tab.title)) break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return made;
        },
        base,
        names
    );
}

// Every ordered pair of the tabs the tests below never split.
const freePairs = () => {
    const free = [ids.one, ids.three, ids.five];
    return free.flatMap(a => free.filter(b => b !== a).map(b => [a, b]));
};
const adjacent = (order, a, b) => Math.abs(order.indexOf(a) - order.indexOf(b)) === 1;

// Waits until the two tabs show as one split block, in either order (the list may be inverted).
const waitForPair = (a, b) =>
    page.waitForFunction(
        (a, b) => {
            const rowA = document.querySelector(`.space.active .tab[data-tab-id="${a}"]`);
            const rowB = document.querySelector(`.space.active .tab[data-tab-id="${b}"]`);
            if (!rowA || !rowB) return false;
            const [upper, lower] = rowA.nextElementSibling === rowB ? [rowA, rowB] : [rowB, rowA];
            return (
                upper.nextElementSibling === lower &&
                upper.classList.contains('split-first') &&
                lower.classList.contains('split-second')
            );
        },
        { polling: 100, timeout: 10000 },
        a,
        b
    );

// Waits until the list order differs from `before`.
const waitForReorder = before =>
    page.waitForFunction(
        (before, rows) =>
            JSON.stringify([...document.querySelectorAll(rows)].map(el => Number(el.dataset.tabId))) !==
            JSON.stringify(before),
        { polling: 100, timeout: 10000 },
        before,
        rows
    );

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
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    supported = await page.evaluate(() => typeof chrome.tabs.createSplit === 'function');
    const [one, two, three, four, five] = await openTabs(['one', 'two', 'three', 'four', 'five']);
    ids = { one, two, three, four, five };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(rowSelector(five));
});

afterAll(async () => {
    await browser?.close();
    server?.close();
});

test('where Chrome has no split view, holding a tab over another offers nothing and the drop reorders', async () => {
    if (supported) return;
    const before = await listedIds();
    await holdDragOver(page, rowSelector(ids.one), rowSelector(ids.three));
    expect(await hintedIds()).toEqual([]);
    expect(await dropLineShown()).toBe(true);
    await finishHeldDrag(page);
    await waitForReorder(before);
    expect(await hintedIds()).toEqual([]);
});

test('holding a tab over the middle of another shows Split View on that row, and the drop splits the two', async () => {
    if (!supported) return;
    const before = await listedIds();
    await holdDragOver(page, rowSelector(ids.four), rowSelector(ids.two));
    // Only the row under the pointer is marked, with its hint, and no reorder line shows with it.
    expect(await hintedIds()).toEqual([ids.two]);
    expect(await hintText(ids.two)).toBe('Split View');
    expect(await dropLineShown()).toBe(false);
    await finishHeldDrag(page);

    await waitForPair(ids.two, ids.four);
    expect(await splitIdOf(ids.two)).not.toBe(-1);
    expect(await splitIdOf(ids.four)).toBe(await splitIdOf(ids.two));
    expect(await hintedIds()).toEqual([]);
    // As with the menu, the row dropped on stays and the dragged tab joins it, on the right of the
    // split in Chrome's tab strip, the half the hint marked.
    const [two, four] = await Promise.all([ids.two, ids.four].map(id => page.evaluate(id => chrome.tabs.get(id), id)));
    expect(four.index).toBe(two.index + 1);
    const after = await listedIds();
    expect(after.filter(id => id !== ids.four)).toEqual(before.filter(id => id !== ids.four));
});

test('a tab in a split view is not offered another, dragged or dropped on', async () => {
    if (!supported) return;
    await holdDragOver(page, rowSelector(ids.five), rowSelector(ids.two));
    expect(await hintedIds()).toEqual([]);
    await finishHeldDrag(page, { drop: false });
    await holdDragOver(page, rowSelector(ids.four), rowSelector(ids.five));
    expect(await hintedIds()).toEqual([]);
    await finishHeldDrag(page, { drop: false });
    expect(await splitIdOf(ids.four)).toBe(await splitIdOf(ids.two));
    expect(await splitIdOf(ids.five)).toBe(-1);
});

test('holding a tab over the top of another shows the reorder line instead, and the drop reorders', async () => {
    if (!supported) return;
    // Two free tabs, the first not already just above the second.
    const before = await listedIds();
    const [dragged, target] = freePairs().find(([a, b]) => before.indexOf(a) !== before.indexOf(b) - 1);
    await holdDragOver(page, rowSelector(dragged), rowSelector(target), { at: 0.15 });
    expect(await hintedIds()).toEqual([]);
    expect(await dropLineShown()).toBe(true);
    await finishHeldDrag(page, { at: 0.15 });
    await page.waitForFunction(
        (dragged, target) => {
            const row = document.querySelector(`.space.active .tab[data-tab-id="${dragged}"]`);
            return row?.nextElementSibling?.dataset.tabId === String(target);
        },
        { polling: 100, timeout: 10000 },
        dragged,
        target
    );
    expect(await splitIdOf(dragged)).toBe(-1);
    expect(await splitIdOf(target)).toBe(-1);
});

test('a quick drop onto the middle of a tab reorders as before and splits nothing', async () => {
    if (!supported) return;
    // Two free tabs that are not yet next to each other.
    const before = await listedIds();
    const [dragged, target] = freePairs().find(([a, b]) => !adjacent(before, a, b));
    await dragOnto(page, rowSelector(dragged), rowSelector(target));
    await waitForReorder(before);
    expect(adjacent(await listedIds(), dragged, target)).toBe(true);
    expect(await splitIdOf(dragged)).toBe(-1);
    expect(await splitIdOf(target)).toBe(-1);
    expect(await hintedIds()).toEqual([]);
});

test('ending a held drag without dropping clears the hint and splits nothing', async () => {
    if (!supported) return;
    await holdDragOver(page, rowSelector(ids.one), rowSelector(ids.three));
    expect(await hintedIds()).toEqual([ids.three]);
    await finishHeldDrag(page, { drop: false });
    expect(await hintedIds()).toEqual([]);
    expect(await splitIdOf(ids.one)).toBe(-1);
    expect(await splitIdOf(ids.three)).toBe(-1);
});
