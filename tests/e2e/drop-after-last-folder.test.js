import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Issue #93: when the last pin is a folder, a tab could not be pinned after it. Below the folder
// there was no drop target at all, so aiming just under it landed on the folder itself and the tab
// went inside. A drop just below the last pinned row now pins after it, folder open or closed.
let server, base, browser, extensionId, page, space;
let ids = {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const storedSpaces = () =>
    page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces);
const folder = title => `.space.active .folder[data-bookmark-id="${ids[title]}"]`;
const pinnedRows = () =>
    '.space.active [data-tab-type="pinned"] > .tab, .space.active [data-tab-type="pinned"] > .folder';

// Top one, Last folder { Inner one, Inner two }. The folder is the last pin; it is closed unless asked open.
async function seedFavorites({ open }) {
    ids = await page.evaluate(
        async ({ parentId, open }) => {
            const ids = {};
            for (const child of await chrome.bookmarks.getChildren(parentId))
                await chrome.bookmarks.removeTree(child.id);
            const add = async (parent, title) =>
                (ids[title] = (
                    await chrome.bookmarks.create({ parentId: parent, title, url: `https://example.com/${title}` })
                ).id);
            await add(parentId, 'Top one');
            const last = await chrome.bookmarks.create({ parentId, title: 'Last folder' });
            ids['Last folder'] = last.id;
            await add(last.id, 'Inner one');
            await add(last.id, 'Inner two');
            await chrome.storage.local.set({ [`folderCollapsed:${last.id}`]: !open });
            return ids;
        },
        { parentId: space.bookmarkFolderId, open }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.space.active .space-name')?.value === 'Drops', {
        polling: 100
    });
    await page.waitForSelector(`${folder('Last folder')}${open ? ':not(.collapsed)' : '.collapsed'}`);
    await sleep(300);
}

// An open tab in the temporary section, the one a user drags up to pin.
async function openTab(name) {
    const tabId = await page.evaluate(
        async url => (await chrome.tabs.create({ url, active: false })).id,
        `${base}/${name}`
    );
    const selector = `.space.active [data-tab-type="temporary"] .tab[data-tab-id="${tabId}"]`;
    await page.waitForSelector(selector);
    return selector;
}

const box = selector =>
    page.$eval(selector, el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });

// Hold a drag of `sourceSelector` at a point `below` pixels under the last pinned row.
async function hoverBelowLastPin(sourceSelector, below) {
    return page.evaluate(
        ({ sourceSelector, below, rows }) => {
            const source = document.querySelector(sourceSelector);
            const last = [...document.querySelectorAll(rows)].at(-1);
            const r = last.getBoundingClientRect();
            const point = { clientX: r.left + r.width / 2, clientY: r.bottom + below };
            const dataTransfer = new DataTransfer();
            window.__drag = { source, dataTransfer, point };
            const grip = source.classList.contains('folder') ? source.querySelector(':scope > .folder-header') : source;
            grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
            document
                .elementFromPoint(point.clientX, point.clientY)
                .dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point }));
        },
        { sourceSelector, below, rows: pinnedRows() }
    );
}

async function drop() {
    await page.evaluate(() => {
        const { source, dataTransfer, point } = window.__drag;
        document
            .elementFromPoint(point.clientX, point.clientY)
            .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point }));
        const grip = source.classList.contains('folder') ? source.querySelector(':scope > .folder-header') : source;
        grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    });
}

// What the user sees while hovering: the visible drop lines and the highlighted folder.
const indicator = () =>
    page.evaluate(() => ({
        lines: [...document.querySelectorAll('.drop-line')]
            .filter(line => getComputedStyle(line).display !== 'none' && line.getBoundingClientRect().height > 0)
            .map(line => {
                const r = line.getBoundingClientRect();
                return { left: r.left, y: r.top + r.height / 2 };
            }),
        highlighted: [...document.querySelectorAll('.folder.drop-target-folder')].map(f => f.dataset.bookmarkId)
    }));

// Whether the pinned list itself is what a pointer at this height would hit.
const pinnedListAt = y =>
    page.evaluate(y => {
        const list = document.querySelector('.space.active [data-tab-type="pinned"]');
        const x = list.getBoundingClientRect().left + 40;
        return document.elementFromPoint(x, y) === list;
    }, y);

const titles = parentId =>
    page.evaluate(async id => (await chrome.bookmarks.getChildren(id)).map(child => child.title), parentId);
const waitForTitles = (parentId, expected) =>
    page.waitForFunction(
        async ({ id, expected }) =>
            JSON.stringify((await chrome.bookmarks.getChildren(id)).map(c => c.title)) === JSON.stringify(expected),
        { polling: 100, timeout: 5000 },
        { id: parentId, expected }
    );

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1) || 'root'} page</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
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
    await page.waitForFunction(
        () => document.querySelector('#spaceSwitcher button.active')?.textContent.includes('Drops'),
        { polling: 100 }
    );
    space = (await storedSpaces()).find(s => s.name === 'Drops');
}, 60000);

afterAll(async () => {
    await browser?.close();
    server?.close();
});

describe('dropping just below the last pinned folder', () => {
    test('a closed folder: the tab is pinned after it, not inside it', async () => {
        await seedFavorites({ open: false });
        const tab = await openTab('after-closed');
        await hoverBelowLastPin(tab, 6);
        const { lines, highlighted } = await indicator();
        const last = await box(folder('Last folder'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(last.left, 0);
        expect(lines[0].y).toBeGreaterThanOrEqual(last.bottom - 1);
        expect(highlighted).toEqual([]);

        // The reach stops at the gap: just below it is the open tabs section, not the pinned list.
        expect(await pinnedListAt(last.bottom + 14)).toBe(false);
        expect(await pinnedListAt(last.bottom + 6)).toBe(true);

        await drop();
        await waitForTitles(space.bookmarkFolderId, ['Top one', 'Last folder', 'after-closed page']);
        // Once the drag is over, nothing extends the list.
        await page.waitForSelector('.space.active [data-tab-type="pinned"] > .tab');
        const list = await box('.space.active [data-tab-type="pinned"]');
        expect(await pinnedListAt(list.bottom + 6)).toBe(false);
        expect(await titles(ids['Last folder'])).toEqual(['Inner one', 'Inner two']);
    });

    test('an open folder: the tab is pinned after it, not inside it', async () => {
        await seedFavorites({ open: true });
        const tab = await openTab('after-open');
        await hoverBelowLastPin(tab, 6);
        const { lines, highlighted } = await indicator();
        const last = await box(folder('Last folder'));
        expect(lines).toHaveLength(1);
        expect(lines[0].left).toBeCloseTo(last.left, 0);
        expect(lines[0].y).toBeGreaterThanOrEqual(last.bottom - 1);
        expect(highlighted).toEqual([]);

        await drop();
        await waitForTitles(space.bookmarkFolderId, ['Top one', 'Last folder', 'after-open page']);
        expect(await titles(ids['Last folder'])).toEqual(['Inner one', 'Inner two']);
    });

    test('a pinned folder dragged below the last folder moves to the end', async () => {
        await seedFavorites({ open: false });
        await page.evaluate(async parentId => {
            const first = await chrome.bookmarks.create({ parentId, title: 'First folder', index: 0 });
            await chrome.bookmarks.create({ parentId: first.id, title: 'Only', url: 'https://example.com/only' });
        }, space.bookmarkFolderId);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.space.active .folder.collapsed');
        await sleep(300);
        const firstFolder = await page.$eval('.space.active .folder', el => el.dataset.bookmarkId);
        await hoverBelowLastPin(`.space.active .folder[data-bookmark-id="${firstFolder}"]`, 6);
        await drop();
        await waitForTitles(space.bookmarkFolderId, ['Top one', 'Last folder', 'First folder']);
    });

    test('a drop on the closed folder itself still goes inside it', async () => {
        await seedFavorites({ open: false });
        const tab = await openTab('into-closed');
        await hoverBelowLastPin(tab, -10);
        expect((await indicator()).highlighted).toEqual([ids['Last folder']]);

        await drop();
        await waitForTitles(ids['Last folder'], ['into-closed page', 'Inner one', 'Inner two']);
        expect(await titles(space.bookmarkFolderId)).toEqual(['Top one', 'Last folder']);
    });
});
