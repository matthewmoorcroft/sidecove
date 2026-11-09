import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowserWithExtension, openSidebar, createSpace } from './helpers/extension-helper.js';
import { turnOffFileAccess } from './helpers/file-access.js';

// Clean All hides the tabs it clears and mutes them while Undo is on offer, then closes them.
// "Allow access to file URLs" is off, as for most users: Chrome cannot reopen a local file then,
// so Undo has to bring back the very tabs that were cleared.
let server, base, browser, extensionId, page, folder, fileUrl, dialogs;
let spaceCount = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// The Undo window is 8 seconds and the worker adds half a second before it closes.
const AFTER_UNDO_WINDOW = 9500;

const ROWS = '.space.active [data-tab-type="temporary"] .tab[data-tab-id]';
const rows = p => p.$$eval(ROWS, els => els.map(el => ({ id: Number(el.dataset.tabId), url: el.dataset.url })));
const waitForRows = (p, count) =>
    p.waitForFunction(
        (selector, count) => document.querySelectorAll(selector).length === count,
        { polling: 100 },
        ROWS,
        count
    );
const openIds = p => p.evaluate(async () => (await chrome.tabs.query({})).map(t => t.id));
const muted = (p, ids) =>
    p.evaluate(
        ids =>
            Promise.all(
                ids.map(id =>
                    chrome.tabs.get(id).then(
                        t => t.mutedInfo.muted,
                        () => null
                    )
                )
            ),
        ids
    );
const archivedUrls = p =>
    p.evaluate(async () => ((await chrome.storage.local.get('archivedTabs')).archivedTabs || []).map(t => t.url));
const activeTabId = p =>
    p.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
const tabInfo = (p, id) =>
    p.evaluate(
        id =>
            chrome.tabs.get(id).then(
                t => ({ open: true, pinned: t.pinned }),
                () => ({ open: false })
            ),
        id
    );
const getSpaces = p =>
    p.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces);
const ownerName = async (p, tabId) =>
    (await getSpaces(p)).find(s => ['temporaryTabs', 'spaceBookmarks', 'pinnedTabs'].some(k => s[k].includes(tabId)))
        ?.name ?? null;

async function spaceIdOf(p, name) {
    return p.evaluate(
        async name =>
            (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces.find(s => s.name === name)
                .id,
        name
    );
}

async function openHttpTab(p, spaceId, name, { active = false } = {}) {
    return p.evaluate(
        async ({ url, spaceId, active }) => {
            const tab = await chrome.tabs.create({ url, active });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
            return tab.id;
        },
        { url: `${base}/${name}`, spaceId, active }
    );
}

// Chrome will not let the extension open a file URL without file access, which is the bug;
// a person opens it from the address bar, and the test does the same through the browser.
async function openFileTab(p, spaceId) {
    const filePage = await browser.newPage();
    await filePage.goto(fileUrl);
    const id = await p.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url.startsWith('file:')).id);
    await p.evaluate(
        (tabId, spaceId) => chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId, spaceId }),
        id,
        spaceId
    );
    return id;
}

// Go to the sidebar's own tab, which Clear never touches, and let the sidebar notice. Otherwise the
// tab opened last is the one shown, Clear steps off it, and a New Tab appears in the list.
async function leaveCleared(p) {
    await p.bringToFront();
    await sleep(500);
}

const clickClear = p => p.$eval('.space.active .clean-tabs-btn', button => button.click());
const clickUndo = p => p.$eval('#undoToast .undo-toast-button', button => button.click());

// A new space for each test, so one test's tabs never show in another's list.
async function newSpace() {
    const name = `Clean ${++spaceCount}`;
    const sidebar = await createSpace(browser, extensionId, name);
    await sidebar.setViewport({ width: 360, height: 800 });
    sidebar.on('dialog', async dialog => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
    });
    return { sidebar, spaceId: await spaceIdOf(sidebar, name) };
}

beforeAll(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'sidecove-clean-all-'));
    writeFileSync(path.join(folder, 'shopping-list.html'), '<title>shopping-list.html</title><p>milk</p>');
    fileUrl = `file://${path.join(folder, 'shopping-list.html')}`;
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1)}</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    ({ browser, extensionId } = await launchBrowserWithExtension());
    await turnOffFileAccess(browser, extensionId);
    // Opened after the reload so it has the worker that is running now.
    page = await openSidebar(browser, extensionId);
    expect(await page.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())).toBe(false);
}, 90000);

afterAll(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
    if (folder) rmSync(folder, { recursive: true, force: true });
});

beforeEach(() => {
    dialogs = [];
});

describe('Clean All with Undo', () => {
    test('Undo brings every tab back, a local file included, with no alert', async () => {
        const { sidebar, spaceId } = await newSpace();
        const ids = [
            await openHttpTab(sidebar, spaceId, 'flights'),
            await openFileTab(sidebar, spaceId),
            await openHttpTab(sidebar, spaceId, 'pancakes'),
            await openHttpTab(sidebar, spaceId, 'weather')
        ];
        await waitForRows(sidebar, 4);
        // Not on a cleared tab (the file tab opened last is the one shown), so no New Tab opens.
        await leaveCleared(sidebar);
        const before = await rows(sidebar);
        expect(before.map(r => r.id).sort()).toEqual([...ids].sort());
        expect(before.some(r => r.url.startsWith('file:'))).toBe(true);

        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        expect(await sidebar.$eval('#undoToast', toast => toast.textContent)).toContain('Closed 4 tabs');
        expect(await archivedUrls(sidebar)).toEqual(expect.arrayContaining(before.map(r => r.url)));

        await clickUndo(sidebar);
        await waitForRows(sidebar, 4);
        await sleep(300);
        // The same tabs, in the same order: nothing was reopened.
        expect(await rows(sidebar)).toEqual(before);
        for (const { url } of before) expect(await archivedUrls(sidebar)).not.toContain(url);
        expect(dialogs).toEqual([]);
        await sleep(AFTER_UNDO_WINDOW);
        expect(await openIds(sidebar)).toEqual(expect.arrayContaining(ids));
        await sidebar.close();
    }, 60000);

    test('the cleared tabs leave the list at once, stay open and muted, then sound returns as it was', async () => {
        const { sidebar, spaceId } = await newSpace();
        const a = await openHttpTab(sidebar, spaceId, 'sound-one');
        const b = await openHttpTab(sidebar, spaceId, 'sound-two');
        await waitForRows(sidebar, 2);
        // The user muted this one themselves, so it must still be muted after Undo.
        await sidebar.evaluate(id => chrome.tabs.update(id, { muted: true }), b);
        expect(await muted(sidebar, [a, b])).toEqual([false, true]);

        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        expect(await openIds(sidebar)).toEqual(expect.arrayContaining([a, b]));
        expect(await muted(sidebar, [a, b])).toEqual([true, true]);
        // Tab search does not offer them either.
        const found = await sidebar.evaluate(() => chrome.runtime.sendMessage({ action: 'searchTabs', query: '' }));
        expect(found.tabs.map(t => t.id)).not.toEqual(expect.arrayContaining([a]));
        // No button shows them again, only Undo.
        expect(await sidebar.$$('.space.active .tab[data-tab-id]')).toHaveLength(0);

        await clickUndo(sidebar);
        await waitForRows(sidebar, 2);
        expect(await muted(sidebar, [a, b])).toEqual([false, true]);
        await sidebar.close();
    }, 60000);

    test('the tabs close for good when the Undo window ends, and stay in Archived', async () => {
        const { sidebar, spaceId } = await newSpace();
        const ids = [await openHttpTab(sidebar, spaceId, 'late-one'), await openHttpTab(sidebar, spaceId, 'late-two')];
        await waitForRows(sidebar, 2);
        const urls = (await rows(sidebar)).map(r => r.url);
        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        await sleep(2000);
        expect(await openIds(sidebar)).toEqual(expect.arrayContaining(ids));

        await sidebar.waitForFunction(() => !document.getElementById('undoToast'), { timeout: 10000 });
        await sleep(1500);
        const open = await openIds(sidebar);
        for (const id of ids) expect(open).not.toContain(id);
        expect(await archivedUrls(sidebar)).toEqual(expect.arrayContaining(urls));
        await waitForRows(sidebar, 0);
        await sidebar.close();
    }, 60000);

    test('closing the sidebar inside the Undo window does not leave the tabs hidden', async () => {
        const { sidebar, spaceId } = await newSpace();
        const ids = [await openHttpTab(sidebar, spaceId, 'gone-one'), await openFileTab(sidebar, spaceId)];
        await waitForRows(sidebar, 2);
        await leaveCleared(sidebar);
        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        await sidebar.close();

        await sleep(AFTER_UNDO_WINDOW);
        const check = await openSidebar(browser, extensionId);
        const open = await openIds(check);
        for (const id of ids) expect(open).not.toContain(id);
        const stored = await check.evaluate(async () => ({
            hidden: (await chrome.storage.session.get('hiddenTabs')).hiddenTabs,
            pending: (await chrome.storage.session.get('pendingCleans')).pendingCleans
        }));
        expect(stored.hidden).toEqual([]);
        expect(stored.pending).toEqual([]);
        await check.close();
    }, 60000);

    test('reloading the sidebar inside the window keeps the tabs hidden until they close', async () => {
        const { sidebar, spaceId } = await newSpace();
        const id = await openHttpTab(sidebar, spaceId, 'reload-one');
        await waitForRows(sidebar, 1);
        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        await sidebar.reload({ waitUntil: 'domcontentloaded' });
        await sleep(2000);
        // Hidden after the reload too: the sidebar rebuilt its list without it.
        expect(await openIds(sidebar)).toContain(id);
        expect(await sidebar.$$(`.tab[data-tab-id="${id}"]`)).toHaveLength(0);
        await sleep(AFTER_UNDO_WINDOW - 2000);
        expect(await openIds(sidebar)).not.toContain(id);
        await sidebar.close();
    }, 60000);

    test('a second Clean All inside the window leaves the first to close on its own, and Undo answers the second', async () => {
        const { sidebar, spaceId } = await newSpace();
        const first = [
            await openHttpTab(sidebar, spaceId, 'first-one'),
            await openHttpTab(sidebar, spaceId, 'first-two')
        ];
        await waitForRows(sidebar, 2);
        await clickClear(sidebar);
        await waitForRows(sidebar, 0);

        const second = [
            await openHttpTab(sidebar, spaceId, 'second-one'),
            await openHttpTab(sidebar, spaceId, 'second-two')
        ];
        await waitForRows(sidebar, 2);
        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        await clickUndo(sidebar);
        await waitForRows(sidebar, 2);
        expect((await rows(sidebar)).map(r => r.id).sort()).toEqual([...second].sort());

        await sleep(AFTER_UNDO_WINDOW);
        const open = await openIds(sidebar);
        for (const id of first) expect(open).not.toContain(id);
        expect(open).toEqual(expect.arrayContaining(second));
        expect((await rows(sidebar)).map(r => r.id).sort()).toEqual([...second].sort());
        await sidebar.close();
    }, 60000);

    test('a hidden tab that Chrome closes itself does not stop Undo from bringing back the rest', async () => {
        const { sidebar, spaceId } = await newSpace();
        const ids = [
            await openHttpTab(sidebar, spaceId, 'chrome-one'),
            await openHttpTab(sidebar, spaceId, 'chrome-two'),
            await openHttpTab(sidebar, spaceId, 'chrome-three')
        ];
        await waitForRows(sidebar, 3);
        const urls = (await rows(sidebar)).map(r => r.url);
        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        await sidebar.evaluate(id => chrome.tabs.remove(id), ids[1]);
        await clickUndo(sidebar);
        await waitForRows(sidebar, 3);
        await sleep(300);
        // The two still open come back as the same tabs; the one Chrome closed is opened again.
        const back = await rows(sidebar);
        expect(back.map(r => r.url).sort()).toEqual([...urls].sort());
        expect(
            back
                .filter(r => ids.includes(r.id))
                .map(r => r.id)
                .sort()
        ).toEqual([ids[0], ids[2]].sort());
        expect(dialogs).toEqual([]);
        await sidebar.close();
    }, 60000);

    test('the tab you are on is left for a New Tab before it is hidden', async () => {
        const { sidebar, spaceId } = await newSpace();
        const keep = await openHttpTab(sidebar, spaceId, 'on-keep');
        const shown = await openHttpTab(sidebar, spaceId, 'on-it', { active: true });
        await waitForRows(sidebar, 2);
        expect(await activeTabId(sidebar)).toBe(shown);

        // Both rows are cleared, the shown tab with them, so a New Tab takes its place and is shown.
        await clickClear(sidebar);
        await waitForRows(sidebar, 1);
        const [newTab] = await rows(sidebar);
        expect(newTab.url).toMatch(/newtab|new-tab-page/);
        expect([shown, keep]).not.toContain(newTab.id);
        expect(await activeTabId(sidebar)).toBe(newTab.id);
        await sidebar.close();
    }, 60000);

    // Not the sidebar's Clear button: its page is a tab of the first window here, and this window has to
    // hold only ordinary tabs. The messages are the ones the sidebar sends.
    test('a window of only ordinary tabs keeps its New Tab when you pick a cleared tab in Chrome', async () => {
        const { sidebar, spaceId } = await newSpace();
        const win = await sidebar.evaluate(async base => {
            const created = await chrome.windows.create({
                url: [`${base}/win-one`, `${base}/win-two`],
                focused: false
            });
            return { id: created.id, tabIds: created.tabs.map(t => t.id) };
        }, base);
        await sidebar.evaluate(
            (tabIds, spaceId) =>
                Promise.all(
                    tabIds.map(tabId =>
                        chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId, spaceId })
                    )
                ),
            win.tabIds,
            spaceId
        );
        // What Clear does first: step off the tabs to a New Tab, then hide the rest.
        const newTab = await sidebar.evaluate(
            async windowId => (await chrome.tabs.create({ windowId, active: true })).id,
            win.id
        );
        await sleep(500);
        const started = await sidebar.evaluate(
            (tabIds, spaceId) =>
                chrome.runtime.sendMessage({ type: 'pendingClean', action: 'start', spaceId, tabIds, order: [] }),
            win.tabIds,
            spaceId
        );
        expect(started.success).toBe(true);
        await sleep(500);
        // Clicking a cleared tab in Chrome's own tab strip, or Cmd+1.
        await sidebar.evaluate(id => chrome.tabs.update(id, { active: true }), win.tabIds[0]);

        await sleep(AFTER_UNDO_WINDOW);
        const left = await sidebar.evaluate(async windowId => {
            const windows = await chrome.windows.getAll({ populate: true });
            return windows.find(w => w.id === windowId)?.tabs.map(t => t.id) ?? null;
        }, win.id);
        expect(left).toEqual([newTab]);
        await sidebar.evaluate(windowId => chrome.windows.remove(windowId), win.id);
        await sidebar.close();
    }, 60000);

    // Chrome's own tab strip can pin a tab (Puppeteer cannot click it), so the tests make the same
    // change to the tab. Clean All must never close a tab the user has since pinned.
    async function clearTwoAndPinOne() {
        const { sidebar, spaceId } = await newSpace();
        const pinned = await openHttpTab(sidebar, spaceId, 'pin-a');
        const other = await openHttpTab(sidebar, spaceId, 'pin-b');
        await waitForRows(sidebar, 2);
        await leaveCleared(sidebar);
        await clickClear(sidebar);
        await waitForRows(sidebar, 0);
        await sleep(1000);
        await sidebar.evaluate(id => chrome.tabs.update(id, { pinned: true }), pinned);
        await sleep(500);
        return { sidebar, spaceId, pinned, other };
    }

    test('a cleared tab pinned inside the Undo window is not closed when the window ends', async () => {
        const { sidebar, pinned, other } = await clearTwoAndPinOne();
        await sleep(AFTER_UNDO_WINDOW);
        expect((await tabInfo(sidebar, pinned)).open).toBe(true);
        expect((await tabInfo(sidebar, other)).open).toBe(false);
        // It is back with the pinned tabs, not in the tab list.
        expect((await tabInfo(sidebar, pinned)).pinned).toBe(true);
        const space = (await getSpaces(sidebar)).find(s => s.pinnedTabs.includes(pinned));
        expect(space.temporaryTabs).not.toContain(pinned);
        await sidebar.close();
    }, 60000);

    test('Undo after pinning a cleared tab puts it with the pinned tabs, not in the tab list', async () => {
        const { sidebar, spaceId, pinned } = await clearTwoAndPinOne();
        await clickUndo(sidebar);
        await sleep(1500);
        const space = (await getSpaces(sidebar)).find(s => s.id === spaceId);
        expect((await tabInfo(sidebar, pinned)).pinned).toBe(true);
        expect(space.temporaryTabs).not.toContain(pinned);
        expect(space.pinnedTabs).toContain(pinned);
        await sidebar.close();
    }, 60000);

    // Closing a window closes every tab in it; Sidecove keeps a note of those tabs so History or
    // Cmd+Shift+T puts them back in their space. Cleared tabs are not in any space, so they get none.
    test('closing the window inside the Undo window does not queue the cleared tabs to come back', async () => {
        const { sidebar: maker, spaceId } = await newSpace();
        const { id: windowId } = await maker.evaluate(() => chrome.windows.create({ url: 'about:blank' }));
        const urls = [`${base}/gone-window-1`, `${base}/gone-window-2`];
        const ids = [];
        for (const url of urls) {
            ids.push(
                await maker.evaluate(
                    async ({ url, windowId, spaceId }) => {
                        const tab = await chrome.tabs.create({ url, windowId, active: false });
                        await chrome.runtime.sendMessage({
                            type: 'spaceStore',
                            action: 'assign',
                            tabId: tab.id,
                            spaceId
                        });
                        return tab.id;
                    },
                    { url, windowId, spaceId }
                )
            );
        }
        // The window needs a sidebar of its own, so Clear runs in the window that is about to close.
        await maker.evaluate(
            (windowId, url) => chrome.tabs.create({ windowId, url, active: true }),
            windowId,
            `chrome-extension://${extensionId}/sidebar.html`
        );
        await sleep(1500);
        let windowSidebar = null;
        for (const p of await browser.pages()) {
            if (!p.url().endsWith('/sidebar.html')) continue;
            if ((await p.evaluate(async () => (await chrome.windows.getCurrent()).id)) === windowId) windowSidebar = p;
        }
        expect(windowSidebar).not.toBeNull();
        await windowSidebar.setViewport({ width: 360, height: 800 });
        await sleep(2000);
        await windowSidebar.waitForFunction(
            ids => ids.every(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)),
            { polling: 100, timeout: 10000 },
            ids
        );
        await clickClear(windowSidebar);
        await windowSidebar.waitForFunction(
            ids => ids.every(id => !document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)),
            { polling: 100, timeout: 10000 },
            ids
        );
        await sleep(1000);
        await maker.evaluate(id => chrome.windows.remove(id), windowId);
        await sleep(1500);

        // What Sidecove sees when the window is reopened: new tabs with those addresses. Another
        // space is the one in use, so any tab that lands in the cleared tabs' space was queued.
        const { sidebar: other } = await newSpace();
        const otherName = await other.$eval('.space.active .space-name', input => input.value);
        const reopened = await other.evaluate(async urls => {
            const win = await chrome.windows.create({ url: urls, focused: false });
            return { windowId: win.id, tabIds: win.tabs.map(t => t.id) };
        }, urls);
        await sleep(1500);
        for (const id of reopened.tabIds) expect(await ownerName(other, id)).toBe(otherName);
        await other.evaluate(id => chrome.windows.remove(id), reopened.windowId);
        await other.close();
        await maker.close();
    }, 90000);
});
