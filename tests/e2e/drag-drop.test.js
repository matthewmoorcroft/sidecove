import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { finishHeldDrag, holdDragOver } from './helpers/drag.js';

// Dragging rows in the open tabs list and in the favorites. The drags are dispatched as DOM drag
// events (helpers/drag.js), which works while Chrome focuses other tabs. Every test here checks the
// order the list ends in, and what the drag leaves behind. Dropping on a space chip, on another tab to
// split, from another page, and the drop line itself are tested in arc-parity, move-pinned-folder,
// drag-to-split, external-drop and drop-indicator; reordering chips in spaces.
let browser, page, server, base, ids;
const ROWS = '.space.active [data-tab-type="temporary"] .tab[data-tab-id]';
const row = id => `.space.active .tab[data-tab-id="${id}"]`;
const listedIds = () => page.$$eval(ROWS, els => els.map(el => Number(el.dataset.tabId)));
const sameOrder = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// `order` with `id` taken out and put back just before `beforeId`, or after `afterId`.
function moved(order, id, { beforeId, afterId }) {
    const rest = order.filter(other => other !== id);
    const at = beforeId !== undefined ? rest.indexOf(beforeId) : rest.indexOf(afterId) + 1;
    return [...rest.slice(0, at), id, ...rest.slice(at)];
}

const waitForOrder = expected =>
    page.waitForFunction(
        (rows, expected) =>
            JSON.stringify([...document.querySelectorAll(rows)].map(el => Number(el.dataset.tabId))) ===
            JSON.stringify(expected),
        { polling: 50, timeout: 10000 },
        ROWS,
        expected
    );

// Nothing is going to change the list: it holds `expected` for a whole quiet spell.
async function expectStays(expected, quietMs = 600) {
    for (const start = Date.now(); Date.now() - start < quietMs;) {
        expect(await listedIds()).toEqual(expected);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

// Everything a drag marks in the list while it runs; all of it must be gone once it ends.
const dragState = () =>
    page.evaluate(() => ({
        dragging: document.querySelectorAll('.dragging').length,
        companions: document.querySelectorAll('.drag-companion').length,
        dropLines: document.querySelectorAll('.drop-line.visible').length,
        highlightedFolders: document.querySelectorAll('.drop-target-folder').length,
        overPlaceholders: document.querySelectorAll('.drag-over').length,
        chipTargets: document.querySelectorAll('.space-drop-target').length
    }));
const NO_DRAG_STATE = {
    dragging: 0,
    companions: 0,
    dropLines: 0,
    highlightedFolders: 0,
    overPlaceholders: 0,
    chipTargets: 0
};

// Chrome's own order of the test tabs (the sidebar order is kept in the space model, not in the strip).
const chromeOrder = () =>
    page.evaluate(async ids => {
        const { id: windowId } = await chrome.windows.getCurrent();
        const tabs = await chrome.tabs.query({ windowId });
        return tabs
            .sort((a, b) => a.index - b.index)
            .map(tab => tab.id)
            .filter(id => ids.includes(id));
    }, Object.values(ids));
// The space's saved order of the test tabs, as the list shows it: tabs are listed newest first by default,
// so the saved list runs the other way round.
const savedOrder = () =>
    page.evaluate(async ids => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const saved = spaces.find(space => space.temporaryTabs.includes(ids[0])).temporaryTabs;
        return saved.filter(id => ids.includes(id)).reverse();
    }, Object.values(ids));
// What the list shows of the test tabs only (the window holds other tabs too).
const listedTestIds = async () => (await listedIds()).filter(id => Object.values(ids).includes(id));

async function reloadSidebar() {
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The list is drawn once the panel has started, so the last test row means it is ready to drag.
    await page.waitForSelector(row(ids.d));
}

// Start dragging `id` and hold it over `targetId` at `at` (a fraction of its height), without dropping.
const holdOver = (id, targetId, at) => holdDragOver(page, row(id), row(targetId), { at, holdMs: 0 });

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
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    const made = await page.evaluate(async base => {
        const { id: windowId } = await chrome.windows.getCurrent();
        const made = [];
        for (const name of ['a', 'b', 'c', 'd']) {
            made.push((await chrome.tabs.create({ url: `${base}/${name}`, windowId, active: false })).id);
        }
        for (let i = 0; i < 100; i++) {
            const tabs = await Promise.all(made.map(id => chrome.tabs.get(id)));
            if (tabs.every(tab => tab.status === 'complete' && tab.title)) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return made;
    }, base);
    [ids] = [{ a: made[0], b: made[1], c: made[2], d: made[3] }];
    await reloadSidebar();
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

describe('dragging tabs in the open tabs list', () => {
    test('a tab dropped above or below another lands there, and the order survives a reload', async () => {
        for (const id of Object.values(ids)) {
            expect(await page.$eval(row(id), el => el.draggable)).toBe(true);
        }

        const start = await listedIds();
        const up = moved(start, ids.d, { beforeId: ids.a });
        await holdOver(ids.d, ids.a, 0.15);
        await finishHeldDrag(page, { at: 0.15 });
        await waitForOrder(up);
        expect(await dragState()).toEqual(NO_DRAG_STATE);

        const down = moved(up, ids.a, { afterId: ids.c });
        await holdOver(ids.a, ids.c, 0.85);
        await finishHeldDrag(page, { at: 0.85 });
        await waitForOrder(down);
        expect(await dragState()).toEqual(NO_DRAG_STATE);

        // The list is redrawn from what was saved, so a reload shows the order was kept.
        await reloadSidebar();
        expect(await listedIds()).toEqual(down);
        expect(await savedOrder()).toEqual(await listedTestIds());
    });

    test('while a tab is held, only that row is marked as dragged, the others stay put, and a line shows', async () => {
        const before = await listedIds();
        await holdOver(ids.d, ids.b, 0.15);
        const during = await page.evaluate(() => ({
            dragging: [...document.querySelectorAll('.dragging')].map(el => Number(el.dataset.tabId)),
            line: document.querySelectorAll('.drop-line.visible').length
        }));
        expect(during.dragging).toEqual([ids.d]);
        expect(during.line).toBe(1);
        expect(await listedIds()).toEqual(before);

        const after = moved(before, ids.d, { beforeId: ids.b });
        await finishHeldDrag(page, { at: 0.15 });
        await waitForOrder(after);
        expect(await dragState()).toEqual(NO_DRAG_STATE);
    });

    test('dropping a tab where it already is changes nothing', async () => {
        await reloadSidebar();
        const before = await listedIds();
        const index = before.indexOf(ids.b);
        // Just below the row above it is exactly where it already sits.
        await holdOver(ids.b, before[index - 1], 0.85);
        await finishHeldDrag(page, { at: 0.85 });
        await expectStays(before);
        expect(await dragState()).toEqual(NO_DRAG_STATE);
        await reloadSidebar();
        expect(await listedIds()).toEqual(before);
        expect(await savedOrder()).toEqual(await listedTestIds());
    });

    test('a drag cancelled over another row keeps the order, in the list, in Chrome and in what is saved', async () => {
        await reloadSidebar();
        const before = await listedIds();
        const chromeBefore = await chromeOrder();
        const savedBefore = await savedOrder();

        await holdOver(ids.d, ids.a, 0.15);
        expect(await page.evaluate(() => document.querySelectorAll('.drop-line.visible').length)).toBe(1);
        // Dropped nowhere: the browser ends a cancelled drag with dragend alone.
        await finishHeldDrag(page, { drop: false });
        await expectStays(before);
        expect(await dragState()).toEqual(NO_DRAG_STATE);
        expect(await chromeOrder()).toEqual(chromeBefore);
        expect(await savedOrder()).toEqual(savedBefore);
        await reloadSidebar();
        expect(sameOrder(await listedIds(), before)).toBe(true);
    });
});

describe('dragging folders in the favorites', () => {
    // Drives the sidebar's own dragstart/dragover/drop/dragend handlers on a folder header.
    async function dragFolder(folderId, targetSelector) {
        await page.evaluate(
            ({ folderId, targetSelector }) => {
                const header = document.querySelector(
                    `.space.active .folder[data-bookmark-id="${folderId}"] > .folder-header`
                );
                const target = document.querySelector(targetSelector);
                const dataTransfer = new DataTransfer();
                header.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
                const rect = target.getBoundingClientRect();
                const point = { clientX: rect.left + 5, clientY: rect.top + 1 };
                target.dispatchEvent(
                    new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point })
                );
                target.dispatchEvent(
                    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point })
                );
                header.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
            },
            { folderId, targetSelector }
        );
    }

    // Pinned tab order in the saved space model, limited to the given tabs.
    async function savedPinnedOrder(tabIds) {
        return page.evaluate(async tabIds => {
            const { spaces = [] } = await chrome.storage.local.get('spaces');
            return spaces[0].spaceBookmarks.filter(id => tabIds.includes(id));
        }, tabIds);
    }

    async function waitForSavedPinnedOrder(expected) {
        await page
            .waitForFunction(
                async expected => {
                    const { spaces = [] } = await chrome.storage.local.get('spaces');
                    return (
                        JSON.stringify(spaces[0].spaceBookmarks.filter(id => expected.includes(id))) ===
                        JSON.stringify(expected)
                    );
                },
                { polling: 100, timeout: 5000 },
                expected
            )
            .catch(() => {});
        expect(await savedPinnedOrder(expected)).toEqual(expected);
    }

    async function bookmarkPosition(id) {
        return page.evaluate(async id => {
            const [node] = await chrome.bookmarks.get(id);
            return { parentId: node.parentId, index: node.index };
        }, id);
    }

    test('should reorder a folder above a sibling and nest it inside another folder', async () => {
        const folderIds = await page.evaluate(async () => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const parentId = spaces[0].bookmarkFolderId;
            const make = async title => (await chrome.bookmarks.create({ parentId, title })).id;
            const a = await make('Drag A'),
                b = await make('Drag B');
            // Pin an open tab between B and C, and one inside C, so moving C changes the saved pinned order.
            const pinIn = async (folderId, url) => {
                const bookmark = await chrome.bookmarks.create({ parentId: folderId, title: url, url });
                const tab = await chrome.tabs.create({ url, active: false });
                await chrome.runtime.sendMessage({
                    type: 'spaceStore',
                    action: 'assign',
                    spaceId: spaces[0].id,
                    tabId: tab.id,
                    pinned: true
                });
                const { pinnedTabStatesById = {} } = await chrome.storage.local.get('pinnedTabStatesById');
                pinnedTabStatesById[tab.id] = { pinnedUrl: url, bookmarkId: bookmark.id };
                await chrome.storage.local.set({ pinnedTabStatesById });
                return tab.id;
            };
            const tabX = await pinIn(parentId, 'https://www.example.com/?drag-x');
            const c = await make('Drag C');
            const tabC = await pinIn(c, 'https://www.example.com/?drag-c');
            return { parentId, a, b, c, tabX, tabC };
        });
        const folder = id => `.space.active .folder[data-bookmark-id="${id}"]`;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector(folder(folderIds.c));
        expect(await page.$eval(`${folder(folderIds.c)} > .folder-header`, el => el.draggable)).toBe(true);
        await waitForSavedPinnedOrder([folderIds.tabX, folderIds.tabC]);

        const before = await bookmarkPosition(folderIds.a);
        await dragFolder(folderIds.c, `${folder(folderIds.a)} > .folder-header`);
        await page.waitForFunction(
            async ({ a, c }) => {
                const [[nodeA], [nodeC]] = await Promise.all([chrome.bookmarks.get(a), chrome.bookmarks.get(c)]);
                return Math.abs(nodeA.index - nodeC.index) === 1;
            },
            { polling: 100, timeout: 5000 },
            folderIds
        );
        const reorderedA = await bookmarkPosition(folderIds.a);
        const reorderedC = await bookmarkPosition(folderIds.c);
        expect(reorderedC.parentId).toBe(folderIds.parentId);
        // Folders render in bookmark order whatever the invert setting.
        expect(reorderedC.index).toBe(reorderedA.index - 1);
        expect(reorderedA.index).toBe(before.index + 1);
        await waitForSavedPinnedOrder([folderIds.tabC, folderIds.tabX]);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector(folder(folderIds.c));
        const displayed = await page.$$eval('.space.active [data-tab-type="pinned"] > .folder', els =>
            els.map(el => el.dataset.bookmarkId)
        );
        expect(displayed.indexOf(folderIds.c)).toBe(displayed.indexOf(folderIds.a) - 1);

        await dragFolder(folderIds.c, `${folder(folderIds.b)} > .folder-content`);
        await page.waitForFunction(
            async ({ b, c }) => (await chrome.bookmarks.get(c))[0].parentId === b,
            { polling: 100, timeout: 5000 },
            folderIds
        );
        expect(await bookmarkPosition(folderIds.c)).toEqual({ parentId: folderIds.b, index: 0 });
        await page.waitForSelector(
            `${folder(folderIds.b)} > .folder-content > .folder[data-bookmark-id="${folderIds.c}"]`
        );
        await waitForSavedPinnedOrder([folderIds.tabC, folderIds.tabX]);

        // A folder cannot be dropped into its own child: nothing moves.
        await dragFolder(folderIds.b, `${folder(folderIds.c)} > .folder-content`);
        await new Promise(resolve => setTimeout(resolve, 500));
        expect((await bookmarkPosition(folderIds.c)).parentId).toBe(folderIds.b);
        expect((await bookmarkPosition(folderIds.b)).parentId).toBe(folderIds.parentId);
    });
});
