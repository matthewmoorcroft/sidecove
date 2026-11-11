import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Issue #77: the "Move to Space" submenu showed only each space's name, not its icon.
let browser, page, first, withIcon, plain, tabId;

const switchTo = async id => {
    await page.evaluate(id => document.querySelector(`#spaceSwitcher button[data-space-id="${id}"]`).click(), id);
    await page.waitForSelector(`.space.active[data-space-id="${id}"]`);
    await new Promise(resolve => setTimeout(resolve, 300));
};

beforeAll(async () => {
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    ({ first, withIcon, plain, tabId } = await page.evaluate(async () => {
        const request = async (action, args = {}) => {
            const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...args });
            if (!response.success) throw new Error(response.error);
            return response.spaces;
        };
        const spaces = await request('get');
        const [folder] = await chrome.bookmarks.get(spaces[0].bookmarkFolderId);
        await chrome.bookmarks.create({ parentId: folder.parentId, title: 'Reading' });
        await chrome.bookmarks.create({ parentId: folder.parentId, title: 'Plain' });
        const next = await request('get');
        const first = spaces[0].id;
        const { id: windowId } = await chrome.windows.getCurrent();
        await request('activate', { windowId, spaceId: first });
        const tab = await chrome.tabs.create({ url: 'https://example.com/#move-me', active: false });
        await request('get');
        return {
            first,
            withIcon: next.find(space => space.name === 'Reading').id,
            plain: next.find(space => space.name === 'Plain').id,
            tabId: tab.id
        };
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#spaceSwitcher button');
    // Give Reading an icon through the same picker a user uses.
    await switchTo(withIcon);
    await page.$eval('.space.active .space-icon-button', button => button.click());
    await page.waitForSelector('#spaceIconPicker .space-icon-choice');
    await page.evaluate(() =>
        [...document.querySelectorAll('#spaceIconPicker .space-icon-choice')].find(b => b.textContent === '🎵').click()
    );
    await page.waitForFunction(
        () => document.querySelector('#spaceSwitcher button.active .space-chip-icon')?.textContent === '🎵',
        { polling: 100 }
    );
    await switchTo(first);
});
afterAll(async () => {
    await browser?.close();
});

const openMenu = () =>
    page.evaluate(id => {
        const row = document.querySelector(`.space.active .tab[data-tab-id="${id}"]`);
        const r = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 }));
    }, tabId);

const submenuEntries = () =>
    page.$$eval('#tab-context-menu .with-submenu .submenu .context-menu-item', items =>
        items.map(item => ({
            text: item.textContent,
            icon: item.querySelector('.context-menu-space-icon')?.textContent || null,
            iconHidden: item.querySelector('.context-menu-space-icon')?.getAttribute('aria-hidden') || null,
            name: item.querySelector('.context-menu-space-icon') ? item.lastElementChild.textContent : item.textContent
        }))
    );

test('the Move to Space entry shows the space icon before its name, and a space without one is unchanged', async () => {
    await page.waitForSelector(`.space.active .tab[data-tab-id="${tabId}"]`);
    await openMenu();
    await page.waitForSelector('#tab-context-menu .with-submenu .submenu .context-menu-item');
    const entries = await submenuEntries();
    expect(entries.find(e => e.name === 'Reading')).toEqual({
        text: '🎵Reading',
        icon: '🎵',
        iconHidden: 'true',
        name: 'Reading'
    });
    expect(entries.find(e => e.name === 'Plain')).toEqual({
        text: 'Plain',
        icon: null,
        iconHidden: null,
        name: 'Plain'
    });
});

test('choosing the entry still moves the tab into that space', async () => {
    await page.evaluate(() =>
        [...document.querySelectorAll('#tab-context-menu .submenu .context-menu-item')]
            .find(item => item.textContent.endsWith('Reading'))
            .click()
    );
    await page.waitForSelector(`.space.active[data-space-id="${withIcon}"] .tab[data-tab-id="${tabId}"]`, {
        timeout: 10000
    });
    expect(await page.$(`.space[data-space-id="${first}"] .tab[data-tab-id="${tabId}"]`)).toBeNull();
});
