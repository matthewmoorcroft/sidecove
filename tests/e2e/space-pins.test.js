import { launchBrowserWithExtension, openSidebar, openOptionsPage } from './helpers/extension-helper.js';
import { dragOnto } from './helpers/drag.js';

let browser, page, options, first, second, pinA, pinB;
const visiblePins = () =>
    page.$$eval('#pinnedFavicons .pinned-favicon', els => els.map(el => Number(el.dataset.tabId)));
const waitForPins = ids =>
    page.waitForFunction(
        ids => {
            const visible = [...document.querySelectorAll('#pinnedFavicons .pinned-favicon')].map(el =>
                Number(el.dataset.tabId)
            );
            return JSON.stringify(visible) === JSON.stringify(ids);
        },
        { polling: 100 },
        ids
    );
const switchTo = async id => {
    await page.evaluate(id => document.querySelector(`#spaceSwitcher button[data-space-id="${id}"]`).click(), id);
    await page.waitForSelector(`.space.active[data-space-id="${id}"]`);
    // Allow Chrome's activation event from the selected space's last tab to settle.
    await new Promise(resolve => setTimeout(resolve, 300));
};

const dropPinOnChip = (tabId, spaceId) =>
    dragOnto(
        page,
        `#pinnedFavicons .pinned-favicon[data-tab-id="${tabId}"]`,
        `#spaceSwitcher button[data-space-id="${spaceId}"]`
    );

beforeAll(async () => {
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    options = await openOptionsPage(browser, result.extensionId);
    ({ first, second, pinA, pinB } = await page.evaluate(async () => {
        const request = async (action, args = {}) => {
            const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...args });
            if (!response.success) throw new Error(response.error);
            return response.spaces;
        };
        const spaces = await request('get');
        const [folder] = await chrome.bookmarks.get(spaces[0].bookmarkFolderId);
        await chrome.bookmarks.create({ parentId: folder.parentId, title: 'Other pins' });
        const next = await request('get');
        const first = spaces[0].id;
        const second = next.find(space => space.name === 'Other pins').id;
        const { id: windowId } = await chrome.windows.getCurrent();
        await request('activate', { windowId, spaceId: first });
        const a = await chrome.tabs.create({ url: 'https://example.com/#pin-a', pinned: true, active: false });
        await request('get');
        await request('activate', { windowId, spaceId: second });
        const b = await chrome.tabs.create({ url: 'https://example.org/#pin-b', pinned: true, active: false });
        await request('get');
        return { first, second, pinA: a.id, pinB: b.id };
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#spaceSwitcher button');
});
afterAll(async () => {
    await browser?.close();
});

test('favorites are shared by default and activating a shared pin keeps the selected space', async () => {
    expect(await options.$eval('#perSpacePinnedFavorites', input => input.checked)).toBe(false);
    await switchTo(second);
    await waitForPins([pinA, pinB]);
    await page.evaluate(id => chrome.tabs.update(id, { active: true }), pinA);
    await page.waitForFunction(
        async second => {
            const { activeSpaces } = await chrome.storage.session.get('activeSpaces');
            const { id } = await chrome.windows.getCurrent();
            return activeSpaces[id] === second;
        },
        { polling: 100 },
        second
    );
    expect(await page.$eval('.space.active', el => el.dataset.spaceId)).toBe(second);
    await switchTo(first);
    await waitForPins([pinA, pinB]);
    // Use the actual Settings control to enable the opt-in behavior in the open panel.
    await options.$eval('#perSpacePinnedFavorites', input => input.click());
    await waitForPins([pinA]);
});

test('the top bar follows the selected space and keeps its pins after panel reload', async () => {
    await switchTo(first);
    await waitForPins([pinA]);
    expect(await visiblePins()).toEqual([pinA]);
    await switchTo(second);
    await waitForPins([pinB]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPins([pinB]);
    // Activating another space's pin in Chrome also selects its owning space.
    await page.evaluate(id => chrome.tabs.update(id, { active: true }), pinA);
    await waitForPins([pinA]);
    await page.waitForSelector(`.space.active[data-space-id="${first}"]`);
});

test('toggling sharing preserves assignments and the saved option', async () => {
    await options.$eval('#perSpacePinnedFavorites', input => input.click());
    await waitForPins([pinA, pinB]);
    await switchTo(second);
    await waitForPins([pinA, pinB]);
    await options.reload({ waitUntil: 'domcontentloaded' });
    await options.waitForSelector('#perSpacePinnedFavorites');
    expect(await options.$eval('#perSpacePinnedFavorites', input => input.checked)).toBe(false);
    await options.$eval('#perSpacePinnedFavorites', input => input.click());
    await waitForPins([pinB]);
    await switchTo(first);
    await waitForPins([pinA]);
});

test('with separate favorites, a pin dropped on a space chip stays pinned and moves to that space', async () => {
    // Separate favorites on, with the first space selected so only pinA shows.
    if (!(await options.$eval('#perSpacePinnedFavorites', input => input.checked)))
        await options.$eval('#perSpacePinnedFavorites', input => input.click());
    await switchTo(first);
    await waitForPins([pinA]);
    try {
        await dropPinOnChip(pinA, second);
        await waitForPins([]);
        await switchTo(second);
        await waitForPins([pinA, pinB]);
        expect(await page.evaluate(id => chrome.tabs.get(id).then(tab => tab.pinned), pinA)).toBe(true);
        const owner = await page.evaluate(async id => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return spaces.find(space => space.pinnedTabs.includes(id))?.id;
        }, pinA);
        expect(owner).toBe(second);
    } finally {
        // Put the pin back so the tests below start from the same assignments.
        await page.evaluate(
            async ({ id, spaceId }) => {
                const response = await chrome.runtime.sendMessage({
                    type: 'spaceStore',
                    action: 'assignPin',
                    tabId: id,
                    spaceId
                });
                if (!response.success) throw new Error(response.error);
            },
            { id: pinA, spaceId: first }
        );
        await switchTo(first);
        await waitForPins([pinA]);
    }
});

test('unpinning removes the icon and returns the tab to its space', async () => {
    await page.evaluate(id => chrome.tabs.update(id, { pinned: false }), pinA);
    await waitForPins([]);
    await page.waitForSelector(`.space.active .tab[data-tab-id="${pinA}"]`);
    await switchTo(second);
    await waitForPins([pinB]);
    // Closing a favorite's tab keeps the saved favorite, dimmed, since Show tabs and favorites
    // from all windows is on by default.
    await page.evaluate(id => chrome.tabs.remove(id), pinB);
    await page.waitForFunction(
        () =>
            !document.querySelector('#pinnedFavicons .pinned-favicon:not(.saved-favorite)') &&
            document.querySelectorAll('#pinnedFavicons .saved-favorite').length === 1,
        { polling: 100 }
    );
});
