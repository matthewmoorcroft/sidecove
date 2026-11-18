import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { dragOnto } from './helpers/drag.js';

// A folder in the pinned area moves to another space whole: with its subfolders and favorites,
// its open tabs, its name, icon and order. Both ways Sidecove offers must do it: Move to Space in
// the folder's own menu, and dropping the folder on another space's chip.
let server, base, browser, page, home, music;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const spacesInStore = () =>
    page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces);
const folderRow = id => `.space.active .folder[data-bookmark-id="${id}"]`;
const bookmark = id => page.evaluate(async id => (await chrome.bookmarks.get(id))[0], id);
const childTitles = id =>
    page.evaluate(async id => (await chrome.bookmarks.getChildren(id)).map(child => child.title), id);
const switchTo = async spaceId => {
    await page.evaluate(
        spaceId => document.querySelector(`#spaceSwitcher button[data-space-id="${spaceId}"]`).click(),
        spaceId
    );
    await page.waitForSelector(`.space.active[data-space-id="${spaceId}"]`);
    await sleep(300);
};
const chip = name =>
    page.evaluateHandle(
        name =>
            [...document.querySelectorAll('#spaceSwitcher button[data-space-id]')].find(b =>
                b.textContent.includes(name)
            ),
        name
    );

// A folder with a favorite, a nested folder holding another favorite, in a known order.
async function makeFolder(spaceFolderId, title) {
    return page.evaluate(
        async ({ spaceFolderId, title, base }) => {
            const folder = await chrome.bookmarks.create({ parentId: spaceFolderId, title });
            await chrome.bookmarks.create({ parentId: folder.id, title: 'First', url: `${base}/${title}-first` });
            const nested = await chrome.bookmarks.create({ parentId: folder.id, title: 'Nested' });
            await chrome.bookmarks.create({ parentId: nested.id, title: 'Deep', url: `${base}/${title}-deep` });
            await chrome.bookmarks.create({ parentId: folder.id, title: 'Last', url: `${base}/${title}-last` });
            await chrome.storage.local.set({ [`folderIcon:${folder.id}`]: '🎧' });
            return { folder: folder.id, nested: nested.id };
        },
        { spaceFolderId, title, base }
    );
}

const openMenuOn = selector =>
    page.$eval(selector, el => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 }));
    });
const menuLabels = () =>
    page.$$eval('.context-menu:not(.submenu) > .context-menu-item', items =>
        items.map(item => item.firstChild.textContent.trim())
    );
const chooseMoveTo = async name => {
    await page.waitForSelector('.context-menu .with-submenu');
    const entry = await page.evaluateHandle(
        name =>
            [...document.querySelectorAll('.context-menu .submenu .context-menu-item')].find(item =>
                item.textContent.endsWith(name)
            ),
        name
    );
    await entry.evaluate(el => el.click());
};
const waitForParent = (id, parent) =>
    page.waitForFunction(
        async ({ id, parent }) => (await chrome.bookmarks.get(id))[0].parentId === parent,
        { polling: 100, timeout: 10000 },
        { id, parent }
    );

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1) || 'root'} page</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const launched = await launchBrowserWithExtension();
    browser = launched.browser;
    page = await openSidebar(browser, launched.extensionId);
    await page.$eval('#addSpaceBtn', button => button.click());
    await page.$eval('#newSpaceName', input => {
        input.value = 'Music';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('#createSpaceBtn', button => button.click());
    await page.waitForFunction(
        () => document.querySelector('#spaceSwitcher button.active')?.textContent.includes('Music'),
        {
            polling: 100
        }
    );
    const all = await spacesInStore();
    home = all.find(space => space.name !== 'Music');
    music = all.find(space => space.name === 'Music');
    await switchTo(home.id);
}, 60000);
afterAll(async () => {
    await browser?.close();
    server?.close();
});

describe('moving a pinned folder to another space', () => {
    test('the folder menu offers Move to Space and moves the folder whole', async () => {
        const ids = await makeFolder(home.bookmarkFolderId, 'MenuFolder');
        await page.waitForSelector(folderRow(ids.folder));
        const before = await childTitles(ids.folder);

        await openMenuOn(`${folderRow(ids.folder)} > .folder-header`);
        await page.waitForSelector('.context-menu .context-menu-item');
        expect(await menuLabels()).toContain('Move to Space');
        await chooseMoveTo('Music');

        await waitForParent(ids.folder, music.bookmarkFolderId);
        await page.waitForFunction(
            id => !document.querySelector(`.space.active .folder[data-bookmark-id="${id}"]`),
            {
                polling: 100
            },
            ids.folder
        );
        expect((await bookmark(ids.folder)).title).toBe('MenuFolder');
        expect(await childTitles(ids.folder)).toEqual(before);
        expect(await childTitles(ids.nested)).toEqual(['Deep']);

        await switchTo(music.id);
        await page.waitForSelector(folderRow(ids.folder));
        expect(await page.$eval(`${folderRow(ids.folder)} .folder-title`, el => el.textContent)).toBe('MenuFolder');
        expect(await page.$$eval(`${folderRow(ids.folder)} .tab`, rows => rows.length)).toBe(3);
        expect(await page.$eval(folderRow(ids.folder), el => el.dataset.folderIcon)).toBe('🎧');
        await switchTo(home.id);
        expect(await page.$(folderRow(ids.folder))).toBeNull();
    });

    test('a folder dropped on a space chip moves whole, and its open tab follows', async () => {
        const ids = await makeFolder(home.bookmarkFolderId, 'DropFolder');
        await page.waitForSelector(folderRow(ids.folder));
        // Open the first favorite so the folder holds a live tab.
        await page.$eval(`${folderRow(ids.folder)} .tab[data-url$="DropFolder-first"]`, row => row.click());
        const tabId = await page.waitForFunction(
            () => {
                const row = document.querySelector(
                    '.space.active .folder .tab[data-url$="DropFolder-first"][data-tab-id]'
                );
                return row ? Number(row.dataset.tabId) : false;
            },
            { polling: 100, timeout: 10000 }
        );
        const openTabId = await tabId.jsonValue();

        await dragOnto(page, folderRow(ids.folder), await chipSelector('Music'), { handle: ':scope > .folder-header' });
        await waitForParent(ids.folder, music.bookmarkFolderId);
        await page.waitForFunction(
            async ({ tabId, musicId }) => {
                const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                return spaces.find(space => space.id === musicId).spaceBookmarks.includes(tabId);
            },
            { polling: 100, timeout: 10000 },
            { tabId: openTabId, musicId: music.id }
        );
        expect(await childTitles(ids.folder)).toEqual(['First', 'Nested', 'Last']);
    });
});

async function chipSelector(name) {
    const id = await (await chip(name)).evaluate(button => button.dataset.spaceId);
    return `#spaceSwitcher button[data-space-id="${id}"]`;
}
