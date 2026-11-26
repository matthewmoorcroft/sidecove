import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Archive Tab and Archived's restore, which the service worker carries out for the panel.
let server, base, browser, extensionId, page, homeId, workId;

const spaces = () =>
    page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces);
const archived = () =>
    page.evaluate(async () =>
        ((await chrome.storage.local.get('archivedTabs')).archivedTabs || []).map(t => [t.url, t.spaceId])
    );
const isOpen = tabId =>
    page.evaluate(
        id =>
            chrome.tabs.get(id).then(
                () => true,
                () => false
            ),
        tabId
    );

async function openTab(path, spaceId) {
    return page.evaluate(
        async ({ url, spaceId }) => {
            const tab = await chrome.tabs.create({ url, active: false });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
            return tab.id;
        },
        { url: `${base}/${path}`, spaceId }
    );
}

async function showSpace(name) {
    await page.evaluate(name => {
        [...document.querySelectorAll('#spaceSwitcher button')].find(b => b.textContent.includes(name)).click();
    }, name);
    await page.waitForFunction(
        name => document.querySelector('.space.active .space-name').value === name,
        { polling: 100 },
        name
    );
}

async function archiveFromMenu(tabId) {
    const row = `.space.active .tab[data-tab-id="${tabId}"]`;
    await page.waitForSelector(row);
    await page.$eval(row, el => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 }));
    });
    await page.waitForFunction(
        () =>
            [...document.querySelectorAll('#tab-context-menu .context-menu-item')].some(
                i => i.textContent === 'Archive Tab'
            ),
        { polling: 100 }
    );
    await page.evaluate(() =>
        [...document.querySelectorAll('#tab-context-menu .context-menu-item')]
            .find(i => i.textContent === 'Archive Tab')
            .click()
    );
    await page.waitForFunction(
        id =>
            chrome.tabs.get(id).then(
                () => false,
                () => true
            ),
        { polling: 100 },
        tabId
    );
}

// Opens Archived and clicks the entry for `url` (the newest one, when there are several).
async function restoreFromArchived(url) {
    await page.$eval('.space.active #archive-button', el => el.click());
    await page.waitForFunction(
        url =>
            [...document.querySelectorAll('.space.active .archived-tabs-popup .archived-item')].some(item =>
                item.title.includes(url)
            ),
        { polling: 100 },
        url
    );
    await page.evaluate(url => {
        [...document.querySelectorAll('.space.active .archived-tabs-popup .archived-item')]
            .find(item => item.title.includes(url))
            .click();
    }, url);
    await page.$eval('.space.active #archive-button', el => el.click());
}

const ownersOf = url =>
    page.evaluate(async url => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const tabs = (await chrome.tabs.query({})).filter(t => t.url === url);
        return tabs.map(t => spaces.find(s => s.temporaryTabs.includes(t.id))?.name).sort();
    }, url);

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
        input.value = 'Work';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('#createSpaceBtn', button => button.click());
    await page.waitForFunction(
        () => document.querySelector('#spaceSwitcher button.active')?.textContent.includes('Work'),
        {
            polling: 100
        }
    );
    [homeId, workId] = (await spaces()).map(s => s.id);
    await showSpace('Home');
});

afterAll(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

test('Archive Tab closes the tab into Archived, and clicking it there reopens it in its space', async () => {
    const tabId = await openTab('archive-me', homeId);
    await archiveFromMenu(tabId);
    expect(await archived()).toContainEqual([`${base}/archive-me`, homeId]);

    await showSpace('Work');
    await restoreFromArchived(`${base}/archive-me`);
    await page.waitForFunction(
        url => chrome.tabs.query({}).then(tabs => tabs.some(t => t.url === url)),
        { polling: 100 },
        `${base}/archive-me`
    );
    expect(await ownersOf(`${base}/archive-me`)).toEqual(['Home']);
    expect(await archived()).not.toContainEqual([`${base}/archive-me`, homeId]);
});

test('two tabs archived at the same moment both stay in Archived', async () => {
    const first = await openTab('together-one', homeId);
    const second = await openTab('together-two', workId);
    await page.evaluate(
        ids =>
            Promise.all(ids.map(tabId => chrome.runtime.sendMessage({ type: 'archive', action: 'archiveTab', tabId }))),
        [first, second]
    );
    expect(await isOpen(first)).toBe(false);
    expect(await isOpen(second)).toBe(false);
    expect(await archived()).toEqual(
        expect.arrayContaining([
            [`${base}/together-one`, homeId],
            [`${base}/together-two`, workId]
        ])
    );
});
