import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Rough edges fixed in the 1.2.0 polish pass, checked in the real sidebar.
let browser, extensionId, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
    // The side panel's real width.
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
});

afterAll(async () => {
    await browser?.close();
});

test('Tab skips the closed New Space form and archive list, so the sidebar never scrolls away', async () => {
    await page.bringToFront();
    // Start keyboard navigation from the bottom of the panel, below the space chips.
    await page.mouse.click(350, 795);
    const visited = [];
    for (let i = 0; i < 16; i++) {
        await page.keyboard.press('Tab');
        visited.push(await page.evaluate(() => {
            const el = document.activeElement;
            return {
                hidden: Boolean(el.closest('.add-space-input-container:not(.visible), .archived-tabs-popup:not(.visible)')),
                id: el.id || el.className,
                scrollTop: document.getElementById('sidebar-container').scrollTop
            };
        }));
    }
    expect(visited.filter(step => step.hidden)).toEqual([]);
    expect(visited.map(step => step.scrollTop)).toEqual(visited.map(() => 0));

    // The form still takes focus once it is opened.
    await page.$eval('#addSpaceBtn', button => button.click());
    await page.focus('#newSpaceName');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('newSpaceName');
    await page.$eval('#addSpaceBtn', button => button.click());
});

test('a favorite\'s remove button shows when it has keyboard focus', async () => {
    const parentId = await page.evaluate(async () => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        await chrome.bookmarks.create({ parentId: spaces[0].bookmarkFolderId, title: 'Keyboard favorite', url: 'https://example.com/keyboard' });
        return spaces[0].bookmarkFolderId;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.space.active .bookmark-only .tab-remove');
    // Let the refresh after loading settle so it does not replace the focused row.
    await sleep(1000);
    await page.bringToFront();
    await page.focus('#tabSearchInput');
    let focused = false;
    for (let i = 0; i < 20 && !focused; i++) {
        await page.keyboard.press('Tab');
        focused = await page.evaluate(() => document.activeElement.classList.contains('tab-remove'));
    }
    expect(focused).toBe(true);
    // The focused button itself fades in.
    await page.waitForFunction(() => document.activeElement.classList.contains('tab-remove')
        && getComputedStyle(document.activeElement).opacity === '1', { polling: 50, timeout: 2000 });
    await page.evaluate(async parentId => {
        for (const child of await chrome.bookmarks.getChildren(parentId)) {
            if (child.title === 'Keyboard favorite') await chrome.bookmarks.remove(child.id);
        }
    }, parentId);
});

test('a favorite that wraps onto a new row keeps the same width as the others (upstream #42)', async () => {
    const ids = await page.evaluate(async () => {
        // Seven tiles always leave a partial last row at this width.
        const created = [];
        for (let i = 0; i < 7; i++) created.push((await chrome.tabs.create({ url: `about:blank#tile-${i}`, pinned: true, active: false })).id);
        return created;
    });
    await page.waitForFunction(count => document.querySelectorAll('#pinnedFavicons .pinned-favicon').length >= count, { polling: 100 }, ids.length);
    const tiles = await page.$$eval('#pinnedFavicons .pinned-favicon', tiles => tiles.map(tile => {
        const r = tile.getBoundingClientRect();
        return { width: Math.round(r.width), top: Math.round(r.top) };
    }));
    const rows = [...new Set(tiles.map(tile => tile.top))];
    expect(rows.length).toBeGreaterThan(1);
    const widths = tiles.map(tile => tile.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    await page.evaluate(ids => chrome.tabs.remove(ids), ids);
});
