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

test('the welcome screens send feedback to the Sidecove issues page and show no email address', async () => {
    for (const file of ['installation-onboarding.html', 'onboarding.html']) {
        const welcome = await browser.newPage();
        await welcome.goto(`chrome-extension://${extensionId}/${file}`, { waitUntil: 'domcontentloaded' });
        const found = await welcome.evaluate(() => ({
            feedback: [...document.querySelectorAll('a')].some(a => a.href === 'https://github.com/matthewmoorcroft/sidecove/issues'),
            emails: (document.body.innerText.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).concat([...document.querySelectorAll('a[href^="mailto:"]')].map(a => a.href))
        }));
        await welcome.close();
        expect({ file, ...found }).toEqual({ file, feedback: true, emails: [] });
    }
});

test.each(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'])('in dark mode a hovered tab and folder keep their titles readable in the %s space', async color => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    const { tabId, folderId } = await page.evaluate(async color => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'patch', before: spaces, after: spaces.map((s, i) => i === 0 ? { ...s, color } : s) });
        const folder = await chrome.bookmarks.create({ parentId: spaces[0].bookmarkFolderId, title: 'Hover folder' });
        const tab = await chrome.tabs.create({ url: 'about:blank#hover', active: false });
        return { tabId: tab.id, folderId: folder.id };
    }, color);
    const rows = {
        tab: [`.space.active .tab[data-tab-id="${tabId}"]`, '.tab-title-display'],
        folder: [`.space.active .folder[data-bookmark-id="${folderId}"] > .folder-header`, '.folder-title']
    };
    await page.waitForFunction((color, selectors) => document.querySelector('.space.active .space-color-select')?.value === color
        && selectors.every(selector => document.querySelector(selector)), { polling: 100 }, color, Object.values(rows).map(([row]) => row));
    // Let the refresh after the change settle so it does not replace the hovered row.
    await sleep(1000);
    await page.bringToFront();
    const contrast = {};
    for (const [name, [row, title]] of Object.entries(rows)) {
        await page.hover(row);
        await sleep(300);
        // WCAG contrast of the title against the hovered row, measured from computed colours.
        contrast[name] = await page.evaluate((row, title) => {
            const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
            const rgba = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
            const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));
            const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
            const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
            const rowElement = document.querySelector(row);
            if (!rowElement.matches(':hover')) return 'not hovered';
            const sidebar = over(rgba(getComputedStyle(document.getElementById('sidebar-container')).backgroundColor), [0, 0, 0]);
            const background = over(rgba(getComputedStyle(rowElement).backgroundColor), sidebar);
            return +ratio(over(rgba(getComputedStyle(rowElement.querySelector(title)).color), background), background).toFixed(2);
        }, row, title);
    }
    await page.mouse.move(350, 795);
    await page.evaluate(async ({ tabId, folderId }) => {
        await chrome.tabs.remove(tabId);
        await chrome.bookmarks.removeTree(folderId);
    }, { tabId, folderId });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    for (const [name, value] of Object.entries(contrast)) expect({ name, value: value >= 4.5 }).toEqual({ name, value: true });
});
