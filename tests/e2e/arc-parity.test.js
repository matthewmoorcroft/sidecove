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

