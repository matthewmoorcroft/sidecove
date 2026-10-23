import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Arc-parity features in Sidecove 1.1. No internet dependency: pages come from a local server.
let server, base, browser, extensionId, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function createSpaceInPage(name, color = 'grey') {
    await page.$eval('#addSpaceBtn', button => button.click());
    await page.$eval('#newSpaceName', (input, name) => {
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, name);
    await page.$eval('#spaceColor', (select, color) => { select.value = color; }, color);
    await page.$eval('#createSpaceBtn', button => button.click());
    await page.waitForFunction(name => document.querySelector('#spaceSwitcher button.active')?.textContent.includes(name), { polling: 100 }, name);
}

const activeSpaceName = () => page.$eval('.space.active .space-name', input => input.value);
const spaceIds = () => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces.map(s => s.id));

async function openTab(path, spaceId) {
    return page.evaluate(async ({ url, spaceId }) => {
        const tab = await chrome.tabs.create({ url, active: false });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
        return tab.id;
    }, { url: `${base}/${path}`, spaceId });
}

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1) || 'root'} page</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
    // The side panel's real width.
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    for (const [name, color] of [['Work', 'blue'], ['Music', 'purple'], ['Reading', 'green']]) await createSpaceInPage(name, color);
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

describe('space navigation', () => {
    test('Ctrl+digit, Ctrl+9 and Ctrl+Shift+brackets switch spaces in the panel', async () => {
        const press = init => page.evaluate(init => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, ...init })), init);
        await press({ code: 'Digit2', key: '2' });
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Work', { polling: 100 });
        await press({ code: 'Digit9', key: '9' });
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Reading', { polling: 100 });
        await press({ shiftKey: true, code: 'BracketLeft', key: '{' });
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Music', { polling: 100 });
        await press({ code: 'Digit1', key: '1' });
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Home', { polling: 100 });
    });

    test('mouse side buttons switch spaces from the tab list, not just the chip bar', async () => {
        await page.$eval('.space.active [data-tab-type="temporary"]', list => list.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 4 })));
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Work', { polling: 100 });
        await page.$eval('.space.active .space-header', header => header.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 3 })));
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Home', { polling: 100 });
    });

    test('a keyboard command reaches the sidebar of its window', async () => {
        const helper = await browser.newPage();
        await helper.goto(`chrome-extension://${extensionId}/options.html`);
        const response = await helper.evaluate(async () => {
            const { id } = await chrome.windows.getCurrent();
            return chrome.runtime.sendMessage({ command: 'switchSpace', windowId: id, request: { slot: 3 } });
        });
        expect(response).toEqual({ handled: true });
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Music', { polling: 100 });
        await helper.close();
    });

    test('the active chip stays in view with many spaces', async () => {
        for (const name of ['Travel', 'Finance', 'Side project', 'Photos']) await createSpaceInPage(name);
        await sleep(600);
        const geometry = await page.evaluate(() => {
            const strip = document.getElementById('spaceSwitcher');
            const chip = strip.querySelector('button.active');
            const s = strip.getBoundingClientRect(), c = chip.getBoundingClientRect();
            return { overflow: strip.scrollWidth > strip.clientWidth, chipLeft: c.left, chipRight: c.right, stripLeft: s.left, stripRight: s.right };
        });
        expect(geometry.overflow).toBe(true);
        expect(geometry.chipLeft).toBeGreaterThanOrEqual(geometry.stripLeft);
        // The add-space button covers the last 48px of the strip.
        expect(geometry.chipRight).toBeLessThanOrEqual(geometry.stripRight - 40);
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, code: 'Digit1' })));
        await page.waitForFunction(() => {
            const strip = document.getElementById('spaceSwitcher');
            const s = strip.getBoundingClientRect(), c = strip.querySelector('button.active').getBoundingClientRect();
            return c.left >= s.left && strip.querySelector('button.active').textContent.includes('Home');
        }, { polling: 100 });
    });
});


describe('Clean All', () => {
    const tempRows = () => page.$$eval('.space.active [data-tab-type="temporary"] .tab[data-tab-id]', rows => rows.map(row => row.dataset.url));

    test('archives the closed tabs and Undo brings them back in order', async () => {
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, code: 'Digit2' })));
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Work', { polling: 100 });
        const [work] = (await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces)).filter(s => s.name === 'Work');
        for (const path of ['clean-one', 'clean-two', 'clean-three']) await openTab(path, work.id);
        await page.waitForFunction(() => document.querySelectorAll('.space.active [data-tab-type="temporary"] .tab[data-tab-id]').length === 3, { polling: 100 });
        const before = await tempRows();

        await page.$eval('.space.active .clean-tabs-btn', button => button.click());
        await page.waitForFunction(() => document.querySelectorAll('.space.active [data-tab-type="temporary"] .tab[data-tab-id]').length === 0, { polling: 100 });
        expect(await page.$eval('#undoToast', toast => toast.textContent)).toContain('Closed 3 tabs');
        const archived = await page.evaluate(async () => (await chrome.storage.local.get('archivedTabs')).archivedTabs.map(t => t.url));
        expect(archived).toEqual(expect.arrayContaining(before));

        await page.$eval('#undoToast .undo-toast-button', button => button.click());
        await page.waitForFunction(() => document.querySelectorAll('.space.active [data-tab-type="temporary"] .tab[data-tab-id]').length === 3, { polling: 100 });
        await sleep(300);
        expect(await tempRows()).toEqual(before);
        const after = await page.evaluate(async () => (await chrome.storage.local.get('archivedTabs')).archivedTabs.map(t => t.url));
        for (const url of before) expect(after).not.toContain(url);
    });
});

describe('tab menu and sound', () => {
    let tabId, homeId;
    const row = () => `.space.active .tab[data-tab-id="${tabId}"]`;
    async function menu(label) {
        await page.$eval(row(), el => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 }));
        });
        await page.waitForFunction(label => [...document.querySelectorAll('#tab-context-menu .context-menu-item')].some(i => i.textContent === label), { polling: 100 }, label);
        await page.evaluate(label => [...document.querySelectorAll('#tab-context-menu .context-menu-item')].find(i => i.textContent === label).click(), label);
    }

    beforeAll(async () => {
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, code: 'Digit1' })));
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Home', { polling: 100 });
        homeId = (await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces))[0].id;
        tabId = await openTab('menu-tab', homeId);
        await page.waitForSelector(row());
    });

    test('Mute Tab mutes it, shows a muted speaker, and the speaker unmutes it', async () => {
        await menu('Mute Tab');
        await page.waitForFunction(id => chrome.tabs.get(id).then(t => t.mutedInfo.muted), { polling: 100 }, tabId);
        await page.waitForSelector(`${row()} .tab-audio.muted:not([hidden])`);
        await page.$eval(`${row()} .tab-audio`, button => button.click());
        await page.waitForFunction(id => chrome.tabs.get(id).then(t => !t.mutedInfo.muted), { polling: 100 }, tabId);
        await page.waitForSelector(`${row()} .tab-audio[hidden]`);
        await menu('Mute Tab');
        await page.waitForSelector(`${row()} .tab-audio.muted:not([hidden])`);
        await menu('Unmute Tab');
        await page.waitForFunction(id => chrome.tabs.get(id).then(t => !t.mutedInfo.muted), { polling: 100 }, tabId);
    });

    test('Duplicate Tab opens a copy in the same space', async () => {
        const url = await page.$eval(row(), el => el.dataset.url);
        await menu('Duplicate Tab');
        await page.waitForFunction(url => document.querySelectorAll(`.space.active [data-tab-type="temporary"] .tab[data-url="${url}"]`).length === 2, { polling: 100 }, url);
        const owners = await page.evaluate(async url => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const tabs = (await chrome.tabs.query({})).filter(t => t.url === url);
            return tabs.map(t => spaces.find(s => s.temporaryTabs.includes(t.id))?.name);
        }, url);
        expect(owners).toEqual(['Home', 'Home']);
    });

    test('Copy Link puts the tab URL on the clipboard', async () => {
        await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${extensionId}`, ['clipboard-read', 'clipboard-sanitized-write']);
        await page.bringToFront();
        await menu('Copy Link');
        await page.waitForFunction(() => document.getElementById('urlCopyToast').classList.contains('show'), { polling: 100 });
        expect(await page.$eval('#urlCopyToast', toast => toast.textContent)).toBe('Copied link');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${base}/menu-tab`);
    });

    test('Rename Tab opens the title editor', async () => {
        await menu('Rename Tab');
        await page.waitForFunction(sel => getComputedStyle(document.querySelector(`${sel} .tab-title-input`)).display !== 'none', { polling: 100 }, row());
        await page.keyboard.press('Escape');
    });
});
