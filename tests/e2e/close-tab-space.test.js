import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar, getBackgroundServiceWorker } from './helpers/extension-helper.js';

// Reported by a user from Arc: closing a tab moved Sidecove to another space whenever Chrome
// picked a tab of that space to show next. As in Arc, a close keeps you in your space.
let server, base, browser, extensionId, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const activeSpaceName = () => page.$eval('.space.active .space-name', input => input.value);
const spaceByName = name =>
    page.evaluate(
        async name =>
            (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces.find(s => s.name === name),
        name
    );
const activeTabId = () =>
    page.evaluate(async () => {
        const { id: windowId } = await chrome.windows.getCurrent();
        return (await chrome.tabs.query({ windowId, active: true }))[0]?.id;
    });
const activateTab = tabId => page.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
const closeTab = tabId => page.evaluate(id => chrome.tabs.remove(id), tabId);
const urlOf = tabId => page.evaluate(async id => (await chrome.tabs.get(id)).url, tabId);
const isOpen = tabId =>
    page.evaluate(
        id =>
            chrome.tabs.get(id).then(
                () => true,
                () => false
            ),
        tabId
    );
const isMuted = tabId => page.evaluate(async id => (await chrome.tabs.get(id)).mutedInfo.muted, tabId);
const archivedUrls = () =>
    page.evaluate(async () => ((await chrome.storage.local.get('archivedTabs')).archivedTabs || []).map(t => t.url));
// The Undo window is 8 seconds and the worker adds half a second before it closes.
const AFTER_UNDO_WINDOW = 9500;

async function createSpaceInPage(name) {
    await page.$eval('#addSpaceBtn', button => button.click());
    await page.$eval(
        '#newSpaceName',
        (input, name) => {
            input.value = name;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        name
    );
    await page.$eval('#createSpaceBtn', button => button.click());
    await page.waitForFunction(
        name => document.querySelector('#spaceSwitcher button.active')?.textContent.includes(name),
        { polling: 100 },
        name
    );
}

async function showSpace(name) {
    await page.evaluate(name => {
        const chip = [...document.querySelectorAll('#spaceSwitcher button')].find(b => b.textContent.includes(name));
        chip.click();
    }, name);
    await page.waitForFunction(
        name => document.querySelector('.space.active .space-name').value === name,
        { polling: 100 },
        name
    );
    await sleep(300);
}

async function openTab(path, spaceName, openerTabId) {
    const space = await spaceByName(spaceName);
    const tabId = await page.evaluate(
        async ({ url, spaceId, openerTabId }) => {
            const tab = await chrome.tabs.create({ url, active: false, openerTabId });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
            return tab.id;
        },
        { url: `${base}/${path}`, spaceId: space.id, openerTabId }
    );
    return tabId;
}

// A New Tab nobody has typed into, in the given space.
async function openEmptyTab(spaceName) {
    const space = await spaceByName(spaceName);
    return page.evaluate(async spaceId => {
        const tab = await chrome.tabs.create({ active: false });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
        return tab.id;
    }, space.id);
}

// Space A holds the tabs under test. A tab of space B was visited last, then the user came
// back to A, so a close in A is the case where Chrome may show a tab of B next.
async function setUp(a, b, pathsInA, pathsInB = ['b-1', 'b-2']) {
    await createSpaceInPage(a);
    await createSpaceInPage(b);
    const tabsInB = [];
    for (const path of pathsInB) tabsInB.push(await openTab(`${a}-${path}`, b));
    const tabsInA = [];
    for (const path of pathsInA) tabsInA.push(await openTab(`${a}-${path}`, a));
    await activateTab(tabsInB.at(-1));
    await sleep(500);
    await showSpace(a);
    return { tabsInA, tabsInB };
}

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1) || 'root'} page</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

// A fresh browser per test: a close that moved to another space must not shape the next one.
beforeEach(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
});

afterEach(async () => {
    await browser?.close();
});

afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
});

const displayedTabs = () =>
    page.$$eval('.space.active [data-tab-type="temporary"] .tab[data-tab-id]', rows =>
        rows.map(row => Number(row.dataset.tabId))
    );

describe('closing a tab keeps the space you are in', () => {
    // Chrome returns to the tab a closed tab was opened from, which can sit in another space.
    test('a tab opened from another space closes: stay, and show the next tab down the list', async () => {
        const { tabsInA, tabsInB } = await setUp('Alpha', 'Beta', ['one']);
        const two = await openTab('Alpha-two', 'Alpha', tabsInB[0]);
        const three = await openTab('Alpha-three', 'Alpha');
        await activateTab(two);
        await sleep(500);
        // New tabs join the top of the list.
        expect(await displayedTabs()).toEqual([three, two, tabsInA[0]]);

        // Close it from the sidebar, as a user does.
        await page.waitForSelector(`.tab[data-tab-id="${two}"] .tab-close`);
        await page.$eval(`.tab[data-tab-id="${two}"] .tab-close`, button => button.click());
        await sleep(1500);

        expect(await activeSpaceName()).toBe('Alpha');
        expect(await activeTabId()).toBe(tabsInA[0]);
        // Beta still remembers the tab the user last visited there, not the one Chrome picked.
        expect((await spaceByName('Beta')).lastTab).toBe(tabsInB.at(-1));
        // The service worker still has Alpha as this window's space (a new sidebar opens on it).
        const { activeSpaces } = await page.evaluate(() => chrome.storage.session.get('activeSpaces'));
        const { id: windowId } = await page.evaluate(() => chrome.windows.getCurrent());
        expect(activeSpaces[windowId]).toBe((await spaceByName('Alpha')).id);
    });

    test('a tab in the middle closes: show the next one down the list, whatever Chrome would pick', async () => {
        const { tabsInA } = await setUp('Iota', 'Kappa', ['one', 'two', 'three']);
        await activateTab(tabsInA[1]);
        await sleep(500);
        // Chrome would show the tab to its right, which the list draws above it.
        expect(await displayedTabs()).toEqual([tabsInA[2], tabsInA[1], tabsInA[0]]);

        await closeTab(tabsInA[1]);
        await sleep(1500);

        expect(await activeSpaceName()).toBe('Iota');
        expect(await activeTabId()).toBe(tabsInA[0]);
    });

    test('the last tab of the list closes: stay, and show the tab above it', async () => {
        const { tabsInB } = await setUp('Gamma', 'Delta', []);
        const one = await openTab('Gamma-one', 'Gamma', tabsInB[0]);
        const two = await openTab('Gamma-two', 'Gamma');
        await activateTab(one);
        await sleep(500);
        expect(await displayedTabs()).toEqual([two, one]);

        await closeTab(one);
        await sleep(1500);

        expect(await activeSpaceName()).toBe('Gamma');
        expect(await activeTabId()).toBe(two);
    });

    test('the only tab of the space closes: stay in the space with a new tab', async () => {
        const { tabsInA, tabsInB } = await setUp('Epsilon', 'Zeta', ['only']);
        await activateTab(tabsInA[0]);
        await sleep(500);

        await closeTab(tabsInA[0]);
        await sleep(2000);

        expect(await activeSpaceName()).toBe('Epsilon');
        const epsilon = await spaceByName('Epsilon');
        expect(epsilon.temporaryTabs).toHaveLength(1);
        expect(await activeTabId()).toBe(epsilon.temporaryTabs[0]);
        expect(await urlOf(epsilon.temporaryTabs[0])).toMatch(/newtab|new-tab-page|about:blank/);
        expect((await spaceByName('Zeta')).temporaryTabs).toEqual(expect.arrayContaining(tabsInB));
    });

    // Cmd+W on an empty New Tab used to leave the pick to Chrome, which shows the tab to its right.
    test('an empty New Tab in the middle of the list closes: stay, and show the next tab down the list', async () => {
        await createSpaceInPage('Nu');
        await createSpaceInPage('Xi');
        const one = await openTab('Nu-one', 'Nu');
        const empty = await openEmptyTab('Nu');
        // Opened between the New Tab and the next tab of Nu, so Chrome would show it.
        const other = await openTab('Xi-one', 'Xi');
        const three = await openTab('Nu-three', 'Nu');
        await activateTab(other);
        await sleep(500);
        await showSpace('Nu');
        await activateTab(empty);
        await sleep(500);
        expect(await displayedTabs()).toEqual([three, empty, one]);

        await closeTab(empty);
        await sleep(1500);

        expect(await activeSpaceName()).toBe('Nu');
        expect(await activeTabId()).toBe(one);
    });

    // Chrome's "Switch to this tab" (address bar) shows the chosen tab and then closes the New Tab
    // the user was on. That is not a close to stay in the space for; the chosen tab stays shown.
    test('"Switch to this tab" from an empty New Tab keeps the tab that was chosen', async () => {
        const { tabsInA } = await setUp('Lambda', 'Mu', ['store', 'one', 'two']);
        const newTab = await page.evaluate(async () => (await chrome.tabs.create({ active: true })).id);
        await page.waitForFunction(
            async id => /^chrome:\/\/(newtab|new-tab-page)\/?$/.test((await chrome.tabs.get(id)).url),
            { polling: 100 },
            newTab
        );
        await sleep(500);
        // The tab below the New Tab is the one a close would show next.
        expect((await displayedTabs()).slice(0, 2)).toEqual([newTab, tabsInA[2]]);

        // Not awaited between the two calls, the order Chrome uses.
        await page.evaluate(
            (chosen, empty) => {
                chrome.tabs.update(chosen, { active: true });
                chrome.tabs.remove(empty);
            },
            tabsInA[0],
            newTab
        );
        await sleep(1500);

        expect(await activeTabId()).toBe(tabsInA[0]);
        expect(await urlOf(tabsInA[0])).toContain('Lambda-store');
        expect(await activeSpaceName()).toBe('Lambda');
        expect(
            await page.evaluate(
                id =>
                    chrome.tabs.get(id).then(
                        () => true,
                        () => false
                    ),
                newTab
            )
        ).toBe(false);
    });

    test('opening a tab of another space on purpose still switches to that space', async () => {
        const { tabsInB } = await setUp('Eta', 'Theta', ['one', 'two']);
        await activateTab(tabsInB[0]);
        await page.waitForFunction(() => document.querySelector('.space.active .space-name').value === 'Theta', {
            polling: 100
        });
        expect(await activeSpaceName()).toBe('Theta');
    });
});

// Clear keeps the tabs it clears open, hidden and muted, for the length of its Undo toast.
describe('tabs that Clear is hiding', () => {
    const waitForRows = count =>
        page.waitForFunction(
            count =>
                document.querySelectorAll('.space.active [data-tab-type="temporary"] .tab[data-tab-id]').length ===
                count,
            { polling: 100 },
            count
        );

    // A space with a pinned tab you are on and two listed tabs, which sit right of the pinned
    // tab in Chrome's strip. The list is then cleared.
    async function clearWhileOnPinnedTab() {
        await createSpaceInPage('Hide');
        const pin = await openTab('pin', 'Hide');
        await page.evaluate(id => chrome.tabs.update(id, { pinned: true }), pin);
        const one = await openTab('one', 'Hide');
        const two = await openTab('two', 'Hide');
        await waitForRows(2);
        await page.evaluate(ids => chrome.tabs.move(ids, { index: 1 }), [one, two]);
        await activateTab(pin);
        await sleep(800);
        await page.$eval('.space.active .clean-tabs-btn', button => button.click());
        await waitForRows(0);
        await sleep(800);
        return { pin, one, two };
    }

    test('closing the tab you are on does not show a hidden tab: stay in the space with a new tab', async () => {
        const { pin, one, two } = await clearWhileOnPinnedTab();
        expect(await activeTabId()).toBe(pin);

        await closeTab(pin);
        await sleep(1500);

        const shown = await activeTabId();
        expect([one, two]).not.toContain(shown);
        expect(await activeSpaceName()).toBe('Hide');
        expect((await spaceByName('Hide')).temporaryTabs).toContain(shown);
    });

    // Cmd+1 to 9, or a click in Chrome's tab strip, picks a cleared tab on purpose: it is
    // brought back on its own, as an Undo for that one tab.
    test('picking a cleared tab in Chrome brings that one tab back into the list', async () => {
        const { one, two } = await clearWhileOnPinnedTab();
        const oneUrl = await urlOf(one);
        const twoUrl = await urlOf(two);
        expect(await isMuted(one)).toBe(true);

        await activateTab(one);
        await sleep(1500);

        expect(await activeTabId()).toBe(one);
        expect(await displayedTabs()).toEqual([one]);
        expect(await isMuted(one)).toBe(false);
        expect(await archivedUrls()).not.toContain(oneUrl);

        await sleep(AFTER_UNDO_WINDOW);
        expect(await isOpen(one)).toBe(true);
        expect(await isOpen(two)).toBe(false);
        expect(await archivedUrls()).toContain(twoUrl);
        expect(await activeTabId()).toBe(one);
        expect(await displayedTabs()).toEqual([one]);
    });
});

describe('the most recent tab shortcut', () => {
    // Puppeteer cannot press an extension shortcut, so the command is fired in the service worker.
    async function pressRecentTab() {
        const worker = await getBackgroundServiceWorker(browser);
        await worker.evaluate(() => chrome.commands.onCommand.dispatch('RecentTabInSpace'));
        await sleep(1500);
    }

    test('on a favorite shared from another space it stays in the space you are in', async () => {
        expect(
            (await page.evaluate(() => chrome.storage.sync.get('perSpacePinnedFavorites'))).perSpacePinnedFavorites
        ).not.toBe(true);
        await createSpaceInPage('Pi');
        await createSpaceInPage('Rho');
        const favourite = await openTab('Pi-favourite', 'Pi');
        await page.evaluate(id => chrome.tabs.update(id, { pinned: true }), favourite);
        await sleep(500);
        const first = await openTab('Rho-one', 'Rho');
        const second = await openTab('Rho-two', 'Rho');
        await showSpace('Rho');
        await activateTab(first);
        await sleep(500);
        await activateTab(second);
        await sleep(500);
        // The favorite is owned by Pi but shown in every space's bar.
        await activateTab(favourite);
        await sleep(500);
        expect(await activeSpaceName()).toBe('Rho');

        await pressRecentTab();

        expect(await activeTabId()).toBe(second);
        expect(await activeSpaceName()).toBe('Rho');
    });
});
