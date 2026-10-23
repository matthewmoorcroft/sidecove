import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// While a row is dragged, one line shows where it will land, starting at the indent of the
// level it lands at, and the folder that would receive it is highlighted. Each test drops
// where it hovered and checks the bookmark landed where the line said.
let browser, extensionId, page, space;
let ids = {};

const storedSpaces = () => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces);
const row = title => `.space.active [data-tab-type="pinned"] .tab[data-bookmark-id="${ids[title]}"]`;
const folder = title => `.space.active .folder[data-bookmark-id="${ids[title]}"]`;
const titleOf = id => Object.keys(ids).find(title => ids[title] === id);

// Top one, Outer { Inner one, Inner two, Nested { Deep one } }, Top two, Shut { Shut one }, Top three.
// Outer and Nested are open; Shut keeps the default collapsed state.
async function seedFavorites() {
    ids = await page.evaluate(async parentId => {
        const ids = {};
        for (const child of await chrome.bookmarks.getChildren(parentId)) await chrome.bookmarks.removeTree(child.id);
        const add = async (parent, title) => {
            ids[title] = (await chrome.bookmarks.create({ parentId: parent, title, url: `https://example.com/${title.replace(' ', '-')}` })).id;
        };
        const addFolder = async (parent, title) => (ids[title] = (await chrome.bookmarks.create({ parentId: parent, title })).id);
        await add(parentId, 'Top one');
        const outer = await addFolder(parentId, 'Outer');
        await add(outer, 'Inner one');
        await add(outer, 'Inner two');
        const nested = await addFolder(outer, 'Nested');
        await add(nested, 'Deep one');
        await add(parentId, 'Top two');
        const shut = await addFolder(parentId, 'Shut');
        await add(shut, 'Shut one');
        await add(parentId, 'Top three');
        await chrome.storage.local.set({ [`folderCollapsed:${outer}`]: false, [`folderCollapsed:${nested}`]: false });
        return ids;
    }, space.bookmarkFolderId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.space.active .space-name')?.value === 'Drops', { polling: 100 });
    for (const title of ['Top one', 'Inner two', 'Deep one', 'Top three']) await page.waitForSelector(row(title));
    await page.waitForSelector(`${folder('Shut')}.collapsed`);
}

// Start dragging a row and hover a point on another element, given as fractions of its box.
async function hover(sourceSelector, targetSelector, { x = 0.5, y = 0.5 } = {}) {
    return page.evaluate(({ sourceSelector, targetSelector, x, y }) => {
        const source = document.querySelector(sourceSelector);
        const target = document.querySelector(targetSelector);
        if (!source || !target) throw new Error(`missing ${!source ? sourceSelector : targetSelector}`);
        const r = target.getBoundingClientRect();
        const point = { clientX: r.left + r.width * x, clientY: r.top + r.height * y };
        const dataTransfer = new DataTransfer();
        window.__drag = { source, dataTransfer, point };
        const grip = source.classList.contains('folder') ? source.querySelector(':scope > .folder-header') : source;
        grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        document.elementFromPoint(point.clientX, point.clientY)
            .dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point }));
        return point;
    }, { sourceSelector, targetSelector, x, y });
}

// What the user sees while hovering: the visible drop lines and the highlighted folders.
const indicator = () => page.evaluate(() => {
    const lines = [...document.querySelectorAll('.drop-line')]
        .filter(line => getComputedStyle(line).display !== 'none' && line.getBoundingClientRect().height > 0)
        .map(line => {
            const r = line.getBoundingClientRect();
            return { left: r.left, right: r.right, y: r.top + r.height / 2 };
        });
    const folders = [...document.querySelectorAll('.folder.drop-target-folder')].map(f => f.dataset.bookmarkId);
    return { lines, folders };
}).then(({ lines, folders }) => ({ lines, folders: folders.map(titleOf) }));

async function drop() {
    await page.evaluate(() => {
        const { source, dataTransfer, point } = window.__drag;
        document.elementFromPoint(point.clientX, point.clientY)
            .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point }));
        const grip = source.classList.contains('folder') ? source.querySelector(':scope > .folder-header') : source;
        grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    });
}

const box = selector => page.$eval(selector, el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});

// Wait until a bookmark folder (the space folder when no title is given) holds these titles, in order.
const waitForChildren = (folderTitle, expected) => page.waitForFunction(async ({ id, expected }) =>
    JSON.stringify((await chrome.bookmarks.getChildren(id)).map(c => c.title)) === JSON.stringify(expected),
{ polling: 100, timeout: 5000 }, { id: folderTitle ? ids[folderTitle] : space.bookmarkFolderId, expected });

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    await page.$eval('#addSpaceBtn', button => button.click());
    await page.$eval('#newSpaceName', input => {
        input.value = 'Drops';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('#createSpaceBtn', button => button.click());
    await page.waitForFunction(() => document.querySelector('#spaceSwitcher button.active')?.textContent.includes('Drops'), { polling: 100 });
    space = (await storedSpaces()).find(s => s.name === 'Drops');
});

afterAll(async () => {
    await browser?.close();
});

beforeEach(seedFavorites);

describe('drop indicator', () => {
    test('between top-level rows: one line at the top-level indent, no folder highlighted', async () => {
        await hover(row('Top three'), row('Top two'), { y: 0.15 });
        const { lines, folders } = await indicator();
        const target = await box(row('Top two'));
        const outer = await box(folder('Outer'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(target.left, 0);
        expect(lines[0].y).toBeGreaterThanOrEqual(outer.bottom - 1);
        expect(lines[0].y).toBeLessThanOrEqual(target.top + 1);
        expect(folders).toEqual([]);

        await drop();
        await waitForChildren(null, ['Top one', 'Outer', 'Top three', 'Top two', 'Shut']);
        expect(await indicator()).toEqual({ lines: [], folders: [] });
    });

    test('inside a folder: the line starts at the folder content indent and the folder is highlighted', async () => {
        await hover(row('Top one'), row('Inner two'), { y: 0.15 });
        const { lines, folders } = await indicator();
        const inner = await box(row('Inner two'));
        const topLevel = await box(row('Top two'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(inner.left, 0);
        expect(lines[0].left).toBeGreaterThan(topLevel.left + 4);
        expect(lines[0].y).toBeLessThanOrEqual(inner.top + 1);
        expect(lines[0].y).toBeGreaterThanOrEqual((await box(row('Inner one'))).bottom - 1);
        expect(folders).toEqual(['Outer']);

        await drop();
        await waitForChildren('Outer', ['Inner one', 'Top one', 'Inner two', 'Nested']);
    });

    test('at the end of a nested folder: deeper indent, and only the innermost folder is highlighted', async () => {
        await hover(row('Top three'), row('Deep one'), { y: 0.85 });
        const { lines, folders } = await indicator();
        const deep = await box(row('Deep one'));
        const inner = await box(row('Inner one'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(deep.left, 0);
        expect(lines[0].left).toBeGreaterThan(inner.left + 4);
        expect(lines[0].y).toBeGreaterThanOrEqual(deep.bottom - 1);
        expect(folders).toEqual(['Nested']);

        await drop();
        await waitForChildren('Nested', ['Deep one', 'Top three']);
    });

    test('below the last row: the line shows at the end of the list instead of disappearing', async () => {
        await hover(row('Top one'), row('Top three'), { y: 0.85 });
        const { lines, folders } = await indicator();
        const last = await box(row('Top three'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(last.left, 0);
        expect(lines[0].y).toBeGreaterThanOrEqual(last.bottom - 1);
        expect(folders).toEqual([]);

        await drop();
        await waitForChildren(null, ['Outer', 'Top two', 'Shut', 'Top three', 'Top one']);
    });

    test('over a collapsed folder: no line, the folder is highlighted and the row goes inside it', async () => {
        await hover(row('Top two'), `${folder('Shut')} > .folder-header`, { y: 0.5 });
        const { lines, folders } = await indicator();
        expect(lines).toEqual([]);
        expect(folders).toEqual(['Shut']);

        // The drop opens the folder and, as on an open folder's header, lands at its top.
        await drop();
        await waitForChildren('Shut', ['Top two', 'Shut one']);
    });

    test('a folder dragged over another folder header shows a top-level line and no highlight', async () => {
        await hover(folder('Shut'), `${folder('Outer')} > .folder-header`, { y: 0.2 });
        const { lines, folders } = await indicator();
        const outer = await box(folder('Outer'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(outer.left, 0);
        expect(lines[0].y).toBeLessThanOrEqual(outer.top + 1);
        expect(folders).toEqual([]);

        await drop();
        await waitForChildren(null, ['Top one', 'Shut', 'Outer', 'Top two', 'Top three']);
    });

    test('a dragged selection shows the line at the end of the folder it joins', async () => {
        await page.bringToFront();
        for (const title of ['Top one', 'Top two']) {
            await page.$eval(row(title), el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true })));
        }
        await page.waitForFunction(() => document.querySelectorAll('.space.active .tab.selected').length === 2, { polling: 100 });
        await hover(row('Top one'), row('Inner one'), { y: 0.15 });
        const { lines, folders } = await indicator();
        const nested = await box(folder('Nested'));
        const inner = await box(row('Inner one'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(inner.left, 0);
        expect(lines[0].y).toBeGreaterThanOrEqual(nested.bottom - 1);
        expect(folders).toEqual(['Outer']);

        await drop();
        await waitForChildren('Outer', ['Inner one', 'Inner two', 'Nested', 'Top one', 'Top two']);
    });

    test('leaving the list or cancelling the drag clears the line and the highlight', async () => {
        await hover(row('Top one'), row('Inner two'), { y: 0.15 });
        expect((await indicator()).lines).toHaveLength(1);
        await page.evaluate(() => {
            const { source, dataTransfer } = window.__drag;
            source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        });
        expect(await indicator()).toEqual({ lines: [], folders: [] });
    });
});
