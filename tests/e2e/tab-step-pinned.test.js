import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Reported in issue 76: "Navigate to next/prev tab in space" skipped the pinned tabs and did
// nothing while a pinned tab was active. As in Arc, pinned tabs are part of every space's cycle:
// the top-bar favorites first, then the space's own tabs, wrapping at both ends.
let browser, page, server, base, ids;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = '.space.active .tab[data-tab-id]';

const activeTabId = () =>
    page.evaluate(
        async () => (await chrome.tabs.query({ active: true, windowId: (await chrome.windows.getCurrent()).id }))[0].id
    );

// What the panel shows, top to bottom, for this window: the top-bar favorites, then the space.
// With tabs from all windows on the panel also lists other windows' tabs, and the top bar shows
// other windows' favorites dimmed, with no tab here; the shortcuts stay here.
const shownOrder = () =>
    page.evaluate(
        async (rows, windowId) => {
            const shown = [
                ...[...document.querySelectorAll('#pinnedFavicons .pinned-favicon[data-tab-id]')],
                ...document.querySelectorAll(rows)
            ].map(el => Number(el.dataset.tabId));
            const here = [];
            for (const id of shown) if ((await chrome.tabs.get(id)).windowId === windowId) here.push(id);
            return here;
        },
        rows,
        ids.here
    );

const activate = id => page.evaluate(id => chrome.tabs.update(id, { active: true }), id);
const waitForActive = id =>
    page.waitForFunction(
        async id => {
            const [tab] = await chrome.tabs.query({ active: true, windowId: (await chrome.windows.getCurrent()).id });
            return tab.id === id;
        },
        { polling: 100, timeout: 5000 },
        id
    );

async function step(direction, expectedId) {
    const response = await page.evaluate(
        direction => chrome.runtime.sendMessage({ command: 'stepTabInSpace', direction }),
        direction
    );
    expect(response.success).toBe(true);
    await waitForActive(expectedId);
}

async function apply(settings) {
    await page.evaluate(settings => chrome.storage.sync.set(settings), settings);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(rows);
}

async function switchTo(spaceId, pins) {
    await page.evaluate(id => document.querySelector(`#spaceSwitcher button[data-space-id="${id}"]`).click(), spaceId);
    await page.waitForSelector(`.space.active[data-space-id="${spaceId}"]`);
    await page.waitForFunction(
        (pins, windowId) => {
            const shown = [...document.querySelectorAll('#pinnedFavicons .pinned-favicon')]
                .filter(el => Number(el.dataset.windowId) === windowId)
                .map(el => Number(el.dataset.tabId));
            return JSON.stringify(shown) === JSON.stringify(pins);
        },
        { polling: 100, timeout: 5000 },
        pins,
        ids.here
    );
    await sleep(500);
}

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    ids = await page.evaluate(async base => {
        const request = async (action, args = {}) => {
            const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...args });
            if (!response.success) throw new Error(response.error);
            return response.spaces;
        };
        const owned = async (tabId, spaceId) => {
            for (let i = 0; i < 50; i++) {
                const space = (await request('get')).find(
                    s =>
                        s.temporaryTabs.includes(tabId) ||
                        s.spaceBookmarks.includes(tabId) ||
                        s.pinnedTabs?.includes(tabId)
                );
                if (space && space.id === spaceId) return;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            throw new Error(`Tab ${tabId} never joined space ${spaceId}`);
        };
        const spaces = await request('get');
        const [folder] = await chrome.bookmarks.get(spaces[0].bookmarkFolderId);
        await chrome.bookmarks.create({ parentId: folder.parentId, title: 'Second' });
        const second = (await request('get')).find(space => space.name === 'Second').id;
        const first = spaces[0].id;
        const here = (await chrome.windows.getCurrent()).id;
        const create = async (spaceId, url, pinned = false) => {
            await request('activate', { windowId: here, spaceId });
            const tab = await chrome.tabs.create({ url, pinned, active: false });
            await owned(tab.id, spaceId);
            return tab.id;
        };
        const pinA = await create(first, `${base}/pin-a`, true);
        const pinB = await create(second, `${base}/pin-b`, true);
        const a1 = await create(first, `${base}/a1`);
        const a2 = await create(first, `${base}/a2`);
        const b1 = await create(second, `${base}/b1`);
        const b2 = await create(second, `${base}/b2`);
        await request('activate', { windowId: here, spaceId: first });
        // A pin in another window must never be walked to.
        const other = await chrome.windows.create({ url: `${base}/other`, focused: false });
        const otherPin = (
            await chrome.tabs.create({ windowId: other.id, url: `${base}/other-pin`, pinned: true, active: false })
        ).id;
        return { here, first, second, pinA, pinB, a1, a2, b1, b2, otherPin };
    }, base);
    await page.bringToFront();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(rows);
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

// Starts on the first entry and walks a full circle each way, so it passes every pinned tab and
// begins on one, which is the case that did nothing before.
async function walkCircle(shown) {
    await activate(shown[0]);
    await waitForActive(shown[0]);
    for (let i = 1; i <= shown.length; i++) await step('next', shown[i % shown.length]);
    for (let i = shown.length - 1; i >= 0; i--) await step('prev', shown[(i + shown.length) % shown.length]);
}

describe.each([
    ['on', true],
    ['off', false]
])('tabs from all windows %s', (_label, showTabsFromAllWindows) => {
    test('shared favorites: every space walks the pinned tabs, then its own tabs', async () => {
        await apply({ showTabsFromAllWindows, perSpacePinnedFavorites: false, invertTabOrder: false });
        for (const spaceId of [ids.first, ids.second]) {
            await switchTo(spaceId, [ids.pinA, ids.pinB]);
            const shown = await shownOrder();
            expect(shown.slice(0, 2)).toEqual([ids.pinA, ids.pinB]);
            expect(shown.length).toBeGreaterThanOrEqual(4);
            await walkCircle(shown);
        }
    });

    test('favorites for each space: a space walks its own pinned tabs, then its tabs', async () => {
        for (const [spaceId, pin] of [
            [ids.first, ids.pinA],
            [ids.second, ids.pinB]
        ]) {
            await apply({ showTabsFromAllWindows, perSpacePinnedFavorites: true, invertTabOrder: false });
            await switchTo(spaceId, [pin]);
            const shown = await shownOrder();
            expect(shown[0]).toBe(pin);
            expect(shown.length).toBeGreaterThanOrEqual(3);
            await walkCircle(shown);
        }
    });
});
