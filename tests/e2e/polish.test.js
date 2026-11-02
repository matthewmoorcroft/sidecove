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

test('an open favorite closes with −, a closed favorite is removed with ×, and an ordinary tab closes with ×', async () => {
    const { tabId, bookmarkId, closedId } = await page.evaluate(async () => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const parentId = spaces[0].bookmarkFolderId;
        const closed = await chrome.bookmarks.create({ parentId, title: 'Closed favorite', url: 'https://example.com/closed-favorite' });
        const open = await chrome.bookmarks.create({ parentId, title: 'Open favorite', url: 'about:blank#open-favorite' });
        const tab = await chrome.tabs.create({ url: 'about:blank#open-favorite', active: false });
        await chrome.storage.local.set({ pinnedTabStatesById: { ...(await chrome.storage.local.get('pinnedTabStatesById')).pinnedTabStatesById, [tab.id]: { bookmarkId: open.id, pinnedUrl: open.url } } });
        const after = spaces.map((s, i) => i === 0 ? { ...s, spaceBookmarks: [...s.spaceBookmarks, tab.id], temporaryTabs: s.temporaryTabs.filter(id => id !== tab.id) } : s);
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'patch', before: spaces, after });
        return { tabId: tab.id, bookmarkId: open.id, closedId: closed.id };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const button = selector => page.waitForSelector(selector).then(() => page.$eval(selector, b => ({ text: b.textContent, title: b.title })));
    expect(await button(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${tabId}"] .tab-close`)).toEqual({ text: '−', title: 'Close Tab, Keep Favorite' });
    expect(await button(`.space.active .bookmark-only[data-bookmark-id="${closedId}"] .tab-remove`)).toEqual({ text: '×', title: 'Remove Favorite' });
    expect(await button('.space.active [data-tab-type="temporary"] .tab[data-tab-id] .tab-close')).toEqual({ text: '×', title: 'Close Tab' });
    await page.evaluate(async ({ tabId, bookmarkId, closedId }) => {
        await chrome.tabs.remove(tabId);
        await chrome.bookmarks.remove(bookmarkId);
        await chrome.bookmarks.remove(closedId);
    }, { tabId, bookmarkId, closedId });
});

// As in Arc: a plain row with a grey plus and text, no button box, lined up with the tabs.
test('New Tab is a plain row lined up with the tabs, and readable in every space colour', async () => {
    await page.bringToFront();
    const tabId = await page.evaluate(async () => (await chrome.tabs.create({ url: 'about:blank#new-tab-row', active: false })).id);
    await page.waitForSelector(`.space.active .tab[data-tab-id="${tabId}"] .tab-favicon`);
    await page.mouse.move(350, 5);
    const look = await page.evaluate(id => {
        const button = document.getElementById('newTabBtn');
        const style = getComputedStyle(button);
        const plus = button.querySelector('span').getBoundingClientRect();
        const icon = document.querySelector(`.space.active .tab[data-tab-id="${id}"] .tab-favicon`).getBoundingClientRect();
        return { background: style.backgroundColor, border: style.borderTopWidth, weight: style.fontWeight, plusLeft: plus.left, iconLeft: icon.left, height: button.getBoundingClientRect().height };
    }, tabId);
    expect(look.background).toBe('rgba(0, 0, 0, 0)');
    expect(look.border).toBe('0px');
    expect(look.weight).toBe('400');
    expect(Math.abs(look.plusLeft - look.iconLeft)).toBeLessThanOrEqual(1.5);
    expect(look.height).toBeLessThanOrEqual(40);

    // Never harder to read than a tab title, and at least 4.5:1 wherever tab titles are.
    const measure = () => page.evaluate(id => {
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        const rgba = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
        const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));
        const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const dark = matchMedia('(prefers-color-scheme: dark)').matches;
        const bg = over(rgba(getComputedStyle(document.getElementById('sidebar-container')).backgroundColor), dark ? [0, 0, 0] : [255, 255, 255]);
        const text = el => ratio(over(rgba(getComputedStyle(el).color), bg), bg);
        return { newTab: text(document.getElementById('newTabBtn')), title: text(document.querySelector(`.space.active .tab[data-tab-id="${id}"] .tab-title-display`)) };
    }, tabId);
    const original = await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces[0].color);
    const short = [];
    for (const scheme of ['light', 'dark']) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
        for (const color of ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan']) {
            await page.evaluate(async color => {
                const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'patch', before: spaces, after: spaces.map((s, i) => i === 0 ? { ...s, color } : s) });
            }, color);
            await page.waitForFunction(color => document.querySelector('.space.active .space-color-select')?.value === color, { polling: 100 }, color);
            await sleep(100);
            const { newTab, title } = await measure();
            if (newTab + 0.01 < Math.min(4.5, title)) short.push({ scheme, color, newTab: +newTab.toFixed(2), title: +title.toFixed(2) });
        }
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.evaluate(async color => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'patch', before: spaces, after: spaces.map((s, i) => i === 0 ? { ...s, color } : s) });
    }, original);
    await page.evaluate(id => chrome.tabs.remove(id), tabId);
    expect(short).toEqual([]);
});

// Chrome keeps Cmd/Ctrl+Shift+C for DevTools and will not make it an extension's default
// (a person can still choose it on chrome://extensions/shortcuts), so the default is
// Alt+Shift+C, beside Sidecove's Alt+S and Alt+D. Off macOS, Chrome declines some Alt
// defaults (in CI on Linux it declines Alt+D as well), so the default is checked on macOS.
test('Copy current tab URL has a default shortcut on macOS', async () => {
    const { commands, os } = await page.evaluate(async () => ({ commands: await chrome.commands.getAll(), os: (await chrome.runtime.getPlatformInfo()).os }));
    const copy = commands.find(command => command.name === 'copyCurrentUrl');
    expect(copy).toBeDefined();
    if (os === 'mac') expect(copy.shortcut).toMatch(/^(⌥⇧C|Alt\+Shift\+C)$/);
});

test('the install guide offers Arc\'s Copy URL key for anyone who wants it', async () => {
    const guide = await browser.newPage();
    await guide.goto(`chrome-extension://${extensionId}/installation-onboarding.html`, { waitUntil: 'domcontentloaded' });
    await guide.waitForFunction(() => [...document.querySelectorAll('#shortcuts .shortcut-card')].some(card => card.textContent.includes('Copy current URL')), { polling: 100 });
    const card = await guide.evaluate(() => {
        const copy = [...document.querySelectorAll('#shortcuts .shortcut-card')].find(card => card.textContent.includes('Copy current URL'));
        return { key: copy.querySelector('.shortcut-key').textContent, tip: copy.querySelector('.shortcut-tip')?.textContent || '' };
    });
    await guide.close();
    expect(card.key).toMatch(/^(⌥|Alt)\+Shift\+C$/);
    expect(card.tip).toMatch(/Arc.*(⌘|Ctrl)\+Shift\+C/);
});

test('Settings switches the space bar between icons and names', async () => {
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
    await options.waitForSelector('#spaceSwitcherStyle');
    expect(await options.$eval('#spaceSwitcherStyle', select => select.value)).toBe('icons');
    await options.select('#spaceSwitcherStyle', 'names');
    await page.waitForSelector('#spaceSwitcher:not(.icons-only)');
    await options.select('#spaceSwitcherStyle', 'icons');
    await page.waitForSelector('#spaceSwitcher.icons-only');
    await options.close();
});

test('a space switch takes the new colours in its first frame, with nothing fading from the old space', async () => {
    await page.bringToFront();
    // Two spaces in different colours.
    for (const [name, color] of [['Switch A', 'blue'], ['Switch B', 'red']]) {
        await page.$eval('#addSpaceBtn', b => b.click());
        await page.$eval('#newSpaceName', (el, name) => { el.value = name; el.dispatchEvent(new Event('input', { bubbles: true })); }, name);
        await page.$eval('#spaceColor', (el, color) => { el.value = color; }, color);
        await page.$eval('#createSpaceBtn', b => b.click());
        await page.waitForFunction(name => document.querySelector('.space.active .space-name')?.value === name, { polling: 100 }, name);
    }
    await sleep(600);
    await page.bringToFront();
    const frames = await page.evaluate(() => new Promise(resolve => {
        const container = document.getElementById('sidebar-container');
        const old = getComputedStyle(container).backgroundColor;
        const before = container.style.getPropertyValue('--space-bg-color');
        new MutationObserver((_, observer) => {
            if (container.style.getPropertyValue('--space-bg-color') === before) return;
            observer.disconnect();
            requestAnimationFrame(() => {
                const first = getComputedStyle(container).backgroundColor;
                setTimeout(() => resolve({ old, first, settled: getComputedStyle(container).backgroundColor }), 600);
            });
        }).observe(container, { attributes: true, attributeFilter: ['style'] });
        [...document.querySelectorAll('#spaceSwitcher button')].find(b => b.title === 'Switch A').click();
    }));
    expect(frames.settled).not.toBe(frames.old);
    expect(frames.first).toBe(frames.settled);
});
