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

// Drag and drop is dispatched as DOM events so it works while Chrome focuses other tabs.
async function dragOnto(sourceSelector, targetSelector, { handle = null } = {}) {
    await page.evaluate(({ sourceSelector, targetSelector, handle }) => {
        const source = document.querySelector(sourceSelector);
        const grip = handle ? source.querySelector(handle) : source;
        const target = document.querySelector(targetSelector);
        if (!source || !target) throw new Error(`missing ${!source ? sourceSelector : targetSelector}`);
        const dataTransfer = new DataTransfer();
        const r = target.getBoundingClientRect();
        const point = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point }));
        grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    }, { sourceSelector, targetSelector, handle });
}

const storedSpaces = () => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces);
const chip = name => page.evaluate(name => {
    const button = [...document.querySelectorAll('#spaceSwitcher button[data-space-id]')].find(b => b.textContent.trim().endsWith(name));
    return `#spaceSwitcher button[data-space-id="${button.dataset.spaceId}"]`;
}, name);

describe('moving things between spaces', () => {
    let home, music;
    beforeAll(async () => {
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, code: 'Digit1' })));
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Home', { polling: 100 });
        const all = await storedSpaces();
        home = all.find(s => s.name === 'Home');
        music = all.find(s => s.name === 'Music');
    });

    test('a tab dropped on a space chip moves to that space', async () => {
        const tabId = await openTab('chip-tab', home.id);
        await page.waitForSelector(`.space.active .tab[data-tab-id="${tabId}"]`);
        await dragOnto(`.space.active .tab[data-tab-id="${tabId}"]`, await chip('Music'));
        await page.waitForFunction(async ({ tabId, musicId }) => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return spaces.find(s => s.id === musicId).temporaryTabs.includes(tabId);
        }, { polling: 100 }, { tabId, musicId: music.id });
        expect(await page.$(`.space.active .tab[data-tab-id="${tabId}"]`)).toBeNull();
        expect(await page.$eval('.space.active .space-name', input => input.value)).toBe('Home');
    });

    test('a favorite and a folder dropped on a chip keep their bookmarks in the new space', async () => {
        const ids = await page.evaluate(async ({ homeFolder, base }) => {
            const favorite = await chrome.bookmarks.create({ parentId: homeFolder, title: 'Chip favorite', url: `${base}/chip-favorite` });
            const folder = await chrome.bookmarks.create({ parentId: homeFolder, title: 'Chip folder' });
            const inner = await chrome.bookmarks.create({ parentId: folder.id, title: 'Inside', url: `${base}/inside` });
            return { favorite: favorite.id, folder: folder.id, inner: inner.id };
        }, { homeFolder: home.bookmarkFolderId, base });
        await page.waitForSelector(`.space.active .tab.bookmark-only[data-bookmark-id="${ids.favorite}"]`);
        await page.waitForSelector(`.space.active .folder[data-bookmark-id="${ids.folder}"]`);

        await dragOnto(`.space.active .tab.bookmark-only[data-bookmark-id="${ids.favorite}"]`, await chip('Music'));
        await page.waitForFunction(async ({ id, parent }) => (await chrome.bookmarks.get(id))[0].parentId === parent, { polling: 100 }, { id: ids.favorite, parent: music.bookmarkFolderId });

        await dragOnto(`.space.active .folder[data-bookmark-id="${ids.folder}"]`, await chip('Music'), { handle: ':scope > .folder-header' });
        await page.waitForFunction(async ({ id, parent }) => (await chrome.bookmarks.get(id))[0].parentId === parent, { polling: 100 }, { id: ids.folder, parent: music.bookmarkFolderId });
        expect(await page.evaluate(async id => (await chrome.bookmarks.get(id))[0].parentId, ids.inner)).toBe(ids.folder);
        await page.waitForFunction(id => !document.querySelector(`.space.active .folder[data-bookmark-id="${id}"]`), { polling: 100 }, ids.folder);
    });

    test('a Chrome-pinned favicon dropped on a chip is unpinned into that space', async () => {
        const tabId = await page.evaluate(async url => (await chrome.tabs.create({ url, pinned: true, active: false })).id, `${base}/pinned-chip`);
        await page.waitForSelector(`#pinnedFavicons .pinned-favicon[data-tab-id="${tabId}"]`);
        await dragOnto(`#pinnedFavicons .pinned-favicon[data-tab-id="${tabId}"]`, await chip('Music'));
        await page.waitForFunction(async ({ tabId, musicId }) => {
            const tab = await chrome.tabs.get(tabId);
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return !tab.pinned && spaces.find(s => s.id === musicId).temporaryTabs.includes(tabId);
        }, { polling: 100 }, { tabId, musicId: music.id });
        await sleep(1200);
        const owner = (await storedSpaces()).find(s => s.temporaryTabs.includes(tabId) || s.spaceBookmarks.includes(tabId));
        expect(owner.name).toBe('Music');
    });
});

describe('multi-select and folders', () => {
    let reading;
    const rowOf = id => `.space.active .tab[data-tab-id="${id}"]`;
    const click = (selector, modifiers = {}) => page.$eval(selector, (el, modifiers) =>
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...modifiers })), modifiers);
    const selectedIds = () => page.$$eval('.space.active .tab.selected', rows => rows.map(r => Number(r.dataset.tabId)));
    async function bulk(selector, label) {
        await page.$eval(selector, el => {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 }));
        });
        await page.waitForFunction(label => [...document.querySelectorAll('#tab-context-menu .context-menu-item')].some(i => i.textContent === label), { polling: 100 }, label);
        await page.evaluate(label => [...document.querySelectorAll('#tab-context-menu .context-menu-item')].find(i => i.textContent === label).click(), label);
    }
    async function openTabs(names) {
        // The first Cmd-click also selects the active tab; keep the sidebar itself active so
        // each test starts from an empty selection.
        await page.bringToFront();
        const ids = [];
        for (const name of names) ids.push(await openTab(name, reading.id));
        for (const id of ids) await page.waitForSelector(rowOf(id));
        return ids;
    }
    const folderOf = id => page.evaluate(async id => {
        const { pinnedTabStatesById = {} } = await chrome.storage.local.get('pinnedTabStatesById');
        const bookmarkId = pinnedTabStatesById[id]?.bookmarkId;
        return bookmarkId ? (await chrome.bookmarks.get(bookmarkId))[0].parentId : null;
    }, id);

    // A new folder opens its name editor, which pauses refreshes until it closes.
    afterEach(async () => { await page.evaluate(() => document.activeElement?.blur?.()); });

    beforeAll(async () => {
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, code: 'Digit4' })));
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Reading', { polling: 100 });
        reading = (await storedSpaces()).find(s => s.name === 'Reading');
    });

    test('Cmd-click toggles, Shift-click selects a run, Escape and a plain click clear', async () => {
        const ids = await openTabs(['sel-a', 'sel-b', 'sel-c', 'sel-d']);
        const order = await page.$$eval('.space.active [data-tab-type="temporary"] .tab[data-tab-id]', rows => rows.map(r => Number(r.dataset.tabId)));
        await click(rowOf(order[0]), { metaKey: true });
        await click(rowOf(order[2]), { metaKey: true });
        expect(await selectedIds()).toEqual([order[0], order[2]]);
        await click(rowOf(order[3]), { shiftKey: true });
        expect(await selectedIds()).toEqual([order[2], order[3]]);
        await click(rowOf(order[0]), { shiftKey: true });
        expect(await selectedIds()).toEqual(order.slice(0, 3));
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
        expect(await selectedIds()).toEqual([]);
        await click(rowOf(order[1]), { ctrlKey: true });
        await click(rowOf(order[3]), { ctrlKey: true });
        expect(await selectedIds()).toEqual([order[1], order[3]]);
        await click(rowOf(order[1]));
        expect(await selectedIds()).toEqual([]);
        // The plain click opened that tab; the side panel stays visible in real use.
        await page.bringToFront();
        await page.evaluate(ids => chrome.tabs.remove(ids), ids);
    });

    test('New Folder with selected tabs makes them favorites in a new folder and opens it for naming', async () => {
        const [a, b] = await openTabs(['folder-a', 'folder-b']);
        await click(rowOf(a), { metaKey: true });
        await click(rowOf(b), { metaKey: true });
        await bulk(rowOf(a), 'New Folder with 2 Tabs');
        await page.waitForFunction(() => document.activeElement?.classList.contains('folder-name'), { polling: 100 });
        const folderId = await page.evaluate(() => document.activeElement.closest('.folder').dataset.bookmarkId);
        expect(await folderOf(a)).toBe(folderId);
        expect(await folderOf(b)).toBe(folderId);
        expect((await page.evaluate(id => chrome.bookmarks.get(id), folderId))[0].parentId).toBe(reading.bookmarkFolderId);
        const stored = (await storedSpaces()).find(s => s.id === reading.id);
        expect(stored.spaceBookmarks).toEqual(expect.arrayContaining([a, b]));
        await page.keyboard.type('Reading list');
        await page.keyboard.press('Enter');
        await page.waitForFunction(id => chrome.bookmarks.get(id).then(([n]) => n.title === 'Reading list'), { polling: 100 }, folderId);
    });

    test('holding a tab over a favorite and dropping makes a folder of the two', async () => {
        const favorite = await page.evaluate(async ({ parentId, url }) => (await chrome.bookmarks.create({ parentId, title: 'Merge target', url })).id,
            { parentId: reading.bookmarkFolderId, url: `${base}/merge-target` });
        const target = `.space.active .tab.bookmark-only[data-bookmark-id="${favorite}"]`;
        await page.waitForSelector(target);
        const [tab] = await openTabs(['merge-tab']);
        await page.evaluate(({ source, target }) => {
            const from = document.querySelector(source), to = document.querySelector(target);
            window.__dt = new DataTransfer();
            const r = to.getBoundingClientRect();
            window.__point = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
            from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }));
            to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, ...window.__point }));
        }, { source: rowOf(tab), target });
        await sleep(650);
        await page.evaluate(({ source, target }) => {
            const from = document.querySelector(source), to = document.querySelector(target);
            to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, ...window.__point }));
            if (!to.classList.contains('merge-target')) throw new Error('merge target was not armed');
            to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt, ...window.__point }));
            from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt }));
        }, { source: rowOf(tab), target });
        await page.waitForFunction(async ({ favorite, parent }) => {
            const [node] = await chrome.bookmarks.get(favorite);
            return node.parentId !== parent;
        }, { polling: 100 }, { favorite, parent: reading.bookmarkFolderId });
        const folderId = (await page.evaluate(id => chrome.bookmarks.get(id), favorite))[0].parentId;
        expect(await folderOf(tab)).toBe(folderId);
        const children = await page.evaluate(id => chrome.bookmarks.getChildren(id), folderId);
        expect(children.map(c => c.title)).toEqual(['Merge target', 'merge-tab page']);
        await page.keyboard.press('Escape');
    });

    test('a dragged selection moves together onto a space chip', async () => {
        const [a, b] = await openTabs(['bulk-a', 'bulk-b']);
        await click(rowOf(a), { metaKey: true });
        await click(rowOf(b), { metaKey: true });
        await dragOnto(rowOf(a), await chip('Travel'));
        await page.waitForFunction(async ({ a, b }) => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const travel = spaces.find(s => s.name === 'Travel');
            return travel.temporaryTabs.includes(a) && travel.temporaryTabs.includes(b);
        }, { polling: 100 }, { a, b });
        expect(await selectedIds()).toEqual([]);
    });

    test('a dragged selection moves together to the top of the temporary tabs', async () => {
        const ids = await openTabs(['order-a', 'order-b', 'order-c', 'order-d']);
        const order = await page.$$eval('.space.active [data-tab-type="temporary"] .tab[data-tab-id]', rows => rows.map(r => Number(r.dataset.tabId)));
        const [first, second, third, fourth] = order;
        await click(rowOf(second), { metaKey: true });
        await click(rowOf(fourth), { metaKey: true });
        await page.evaluate(({ source, target }) => {
            const from = document.querySelector(source), to = document.querySelector(target);
            const dataTransfer = new DataTransfer();
            const r = to.getBoundingClientRect();
            const point = { clientX: r.left + r.width / 2, clientY: r.top + 2 };
            from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
            to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point }));
            to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point }));
            from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        }, { source: rowOf(fourth), target: rowOf(first) });
        const expected = [second, fourth, first, third, ...order.slice(4)];
        await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.space.active [data-tab-type="temporary"] .tab[data-tab-id]')]
            .map(r => Number(r.dataset.tabId))) === JSON.stringify(expected), { polling: 100 }, expected);
        expect(await selectedIds()).toEqual([]);
        await page.evaluate(ids => chrome.tabs.remove(ids), ids);
    });

    test('Close on a selection closes the tabs and Undo reopens them', async () => {
        const [a, b] = await openTabs(['close-a', 'close-b']);
        await click(rowOf(a), { metaKey: true });
        await click(rowOf(b), { metaKey: true });
        await bulk(rowOf(a), 'Close 2 Tabs');
        await page.waitForFunction(({ a, b }) => !document.querySelector(`.tab[data-tab-id="${a}"]`) && !document.querySelector(`.tab[data-tab-id="${b}"]`), { polling: 100 }, { a, b });
        await page.$eval('#undoToast .undo-toast-button', button => button.click());
        await page.waitForFunction(base => [`${base}/close-a`, `${base}/close-b`].every(url =>
            document.querySelector(`.space.active [data-tab-type="temporary"] .tab[data-url="${url}"]`)), { polling: 100 }, base);
    });
});

describe('tab search', () => {
    const results = () => page.$$eval('#tabSearchResults .search-result', rows => rows.map(r => ({
        title: r.querySelector('.tab-title-display').textContent, space: r.querySelector('.search-result-space').textContent
    })));
    async function search(text) {
        await page.bringToFront();
        await page.$eval('#tabSearchInput', input => { input.value = ''; input.focus(); });
        await page.type('#tabSearchInput', text);
    }

    test('Cmd+F focuses search, and results cover every space with the space named', async () => {
        await page.bringToFront();
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, metaKey: true, code: 'KeyF', key: 'f' })));
        expect(await page.evaluate(() => document.activeElement.id)).toBe('tabSearchInput');
        await search('chip-tab');
        await page.waitForFunction(() => document.querySelectorAll('#tabSearchResults .search-result').length > 0, { polling: 100 });
        expect(await results()).toEqual([{ title: 'chip-tab page', space: 'Music' }]);
        expect(await page.$eval('#spacesList', list => getComputedStyle(list).display)).toBe('none');
    });

    test('Enter opens the highlighted tab and switches to its space', async () => {
        await search('chip-tab');
        await page.waitForFunction(() => document.querySelector('#tabSearchResults .search-result.highlighted'), { polling: 100 });
        await page.keyboard.press('Enter');
        await page.waitForFunction(async base => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url === `${base}/chip-tab`, { polling: 100 }, base);
        await page.bringToFront();
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Music', { polling: 100 });
        expect(await page.$eval('#tabSearchInput', input => input.value)).toBe('');
        expect(await page.$eval('#spacesList', list => getComputedStyle(list).display)).not.toBe('none');
    });

    test('a closed favorite opens as its bound tab, and Escape clears the search', async () => {
        await search('chip favorite');
        await page.waitForFunction(() => document.querySelectorAll('#tabSearchResults .search-result.bookmark-only').length === 1, { polling: 100 });
        await page.$eval('#tabSearchResults .search-result.bookmark-only', row => row.click());
        await page.waitForFunction(async base => {
            const { pinnedTabStatesById = {} } = await chrome.storage.local.get('pinnedTabStatesById');
            const tabs = await chrome.tabs.query({ url: `${base}/chip-favorite` });
            return tabs.some(t => pinnedTabStatesById[t.id]?.bookmarkId);
        }, { polling: 100 }, base);
        await search('nothing-matches-this');
        await page.waitForSelector('#tabSearchResults .tab-search-empty');
        await page.keyboard.press('Escape');
        expect(await page.$eval('#tabSearchResults', el => el.hidden)).toBe(true);
    });
});

describe('space icons and compact chips', () => {
    const activeChip = () => page.$eval('#spaceSwitcher button.active', b => ({ icon: b.querySelector('.space-chip-icon')?.textContent || null, name: b.querySelector('.space-chip-name').textContent }));

    test('choosing an icon shows it on the header and chip and survives a reload', async () => {
        await page.bringToFront();
        await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, code: 'Digit3' })));
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Music', { polling: 100 });
        await page.$eval('.space.active .space-icon-button', button => button.click());
        await page.waitForSelector('#spaceIconPicker .space-icon-choice');
        await page.evaluate(() => [...document.querySelectorAll('#spaceIconPicker .space-icon-choice')].find(b => b.textContent === '🎵').click());
        await page.waitForFunction(() => document.querySelector('#spaceSwitcher button.active .space-chip-icon')?.textContent === '🎵', { polling: 100 });
        expect(await page.$eval('.space.active .space-icon-button', b => b.textContent)).toBe('🎵');
        expect(await activeChip()).toEqual({ icon: '🎵', name: 'Music' });
        await page.waitForFunction(async () => (await chrome.storage.local.get('spaces')).spaces.find(s => s.name === 'Music')?.icon === '🎵', { polling: 100 });
        const registryIcon = await page.evaluate(async () => {
            const { spaces } = await chrome.storage.local.get('spaces');
            const music = spaces.find(s => s.name === 'Music');
            return (await chrome.storage.local.get('spaceRegistry')).spaceRegistry[music.bookmarkFolderId].icon;
        });
        expect(registryIcon).toBe('🎵');
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#spaceSwitcher button.active .space-chip-icon')?.textContent === '🎵', { polling: 100 });
    });

    test('a typed emoji can be used, a word cannot, and the icon can be removed', async () => {
        await page.$eval('.space.active .space-icon-button', button => button.click());
        await page.waitForSelector('#spaceIconPicker .space-icon-custom');
        await page.type('#spaceIconPicker .space-icon-custom', 'Jazz');
        await page.keyboard.press('Enter');
        expect(await page.$eval('#spaceIconPicker .space-icon-custom', input => input.classList.contains('invalid'))).toBe(true);
        await page.$eval('#spaceIconPicker .space-icon-custom', input => { input.value = ''; });
        await page.type('#spaceIconPicker .space-icon-custom', '🎷');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#spaceSwitcher button.active .space-chip-icon')?.textContent === '🎷', { polling: 100 });
        await page.$eval('.space.active .space-icon-button', button => button.click());
        await page.$eval('#spaceIconPicker .space-icon-remove', button => button.click());
        await page.waitForFunction(() => !document.querySelector('#spaceSwitcher button.active .space-chip-icon'), { polling: 100 });
        expect(await page.$eval('#spaceSwitcher button.active', b => b.textContent)).toBe('Music');
        await page.waitForFunction(async () => (await chrome.storage.local.get('spaces')).spaces.find(s => s.name === 'Music')?.icon === null, { polling: 100 });
    });

    test('chips shrink to icons or initials when the names do not fit, and grow back with room', async () => {
        expect(await page.$eval('#spaceSwitcher', strip => strip.classList.contains('compact'))).toBe(true);
        const shown = await page.$$eval('#spaceSwitcher button[data-space-id]', buttons => buttons.map(b => [b.dataset.initial, getComputedStyle(b.querySelector('.space-chip-name')).display]));
        expect(shown[0]).toEqual(['H', 'none']);
        await page.setViewport({ width: 1400, height: 800 });
        await page.waitForFunction(() => !document.getElementById('spaceSwitcher').classList.contains('compact'), { polling: 100 });
        await page.setViewport({ width: 360, height: 800 });
        await page.waitForFunction(() => document.getElementById('spaceSwitcher').classList.contains('compact'), { polling: 100 });
    });
});
