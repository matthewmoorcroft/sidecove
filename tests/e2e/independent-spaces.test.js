import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar, createSpace } from './helpers/extension-helper.js';

// The modifier that opens a link in a new background tab.
const NEW_TAB_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

describe('Independent spaces', () => {
    let browser, extensionId, page, server, base;
    beforeAll(async () => {
        // The Work tab's page has a link, so its child can be opened the way a user opens one.
        server = createServer((req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(`<title>${req.url}</title><a id="child" href="/child">child</a>`);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
        ({ browser, extensionId } = await launchBrowserWithExtension());
    });
    afterAll(async () => {
        await browser?.close();
        if (server) await new Promise(resolve => server.close(resolve));
    });
    test('space membership survives native group edits, sidebar closure, and optional sync toggling', async () => {
        page = await openSidebar(browser, extensionId);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        expect(await page.evaluate(() => chrome.tabGroups.query({}))).toEqual([]);
        await page.close();
        page = await createSpace(browser, extensionId, 'Independent Work', 'blue');
        page.on('pageerror', error => errors.push(error.message));
        const setup = await page.evaluate(async url => {
            const request = async (action, extra = {}) =>
                (await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...extra })).spaces;
            const spaces = await request('get');
            const work = spaces.find(s => s.name === 'Independent Work');
            const tab = await chrome.tabs.create({ url, active: false });
            await request('assign', { tabId: tab.id, spaceId: work.id });
            const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
            await chrome.tabGroups.update(groupId, { title: 'Native only', color: 'red' });
            return { tabId: tab.id, spaceId: work.id, groupId, windowId: tab.windowId };
        }, `${base}/work`);
        await page.evaluate(async ({ tabId, groupId }) => {
            await chrome.tabs.ungroup(tabId);
            const recreated = await chrome.tabs.group({ tabIds: [tabId] });
            await chrome.tabGroups.update(recreated, { title: 'Still native', color: 'green' });
            await chrome.tabs.move(tabId, { index: -1 });
        }, setup);
        await page.waitForFunction(
            async ({ spaceId, tabId }) => {
                const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                return response.spaces.find(s => s.id === spaceId)?.temporaryTabs.includes(tabId);
            },
            { polling: 100 },
            setup
        );
        await page.close();
        const helper = await browser.newPage();
        await helper.goto(`chrome-extension://${extensionId}/options.html`);
        // The settings tab is listed like any other tab; keep it out of the space under test.
        const homeSpaceId = await helper.evaluate(async spaceId => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const other = spaces.find(s => s.id !== spaceId);
            const { id } = await chrome.tabs.getCurrent();
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: id, spaceId: other.id });
            return other.id;
        }, setup.spaceId);
        // Open the child as a user does, with a modifier-click on a link in the Work tab, while
        // the window's space is Home (as after picking Home in the sidebar). Only the opener can
        // then file it under Work, whichever tab Chrome made active when the sidebar closed.
        const work = await (await browser.waitForTarget(target => target.url() === `${base}/work`)).page();
        const windowSpace = spaceId =>
            helper.waitForFunction(
                async ({ windowId }, spaceId) =>
                    (await chrome.storage.session.get('activeSpaces')).activeSpaces?.[windowId] === spaceId,
                { polling: 100 },
                setup,
                spaceId
            );
        await work.bringToFront();
        await windowSpace(setup.spaceId);
        await helper.evaluate(
            ({ windowId }, spaceId) =>
                chrome.runtime.sendMessage({ type: 'spaceStore', action: 'activate', windowId, spaceId }),
            setup,
            homeSpaceId
        );
        await windowSpace(homeSpaceId);
        const { x, y } = await work.$eval('#child', el => {
            const box = el.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
        await work.keyboard.down(NEW_TAB_KEY);
        await work.mouse.click(x, y);
        await work.keyboard.up(NEW_TAB_KEY);
        const child = await (
            await helper.waitForFunction(
                async url => (await chrome.tabs.query({})).find(tab => (tab.url || tab.pendingUrl) === url)?.id,
                { polling: 100 },
                `${base}/child`
            )
        ).jsonValue();
        expect(await helper.evaluate(id => chrome.tabs.get(id).then(tab => tab.openerTabId), child)).toBe(setup.tabId);
        const filedUnder = await (
            await helper.waitForFunction(
                async child => {
                    const { spaces } = await chrome.storage.local.get('spaces');
                    return spaces.find(s => s.temporaryTabs.includes(child))?.name;
                },
                { polling: 100 },
                child
            )
        ).jsonValue();
        expect(filedUnder).toBe('Independent Work');
        await helper.bringToFront();
        const listed = () =>
            helper.evaluate(async spaceId => {
                const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                return response.spaces.find(s => s.id === spaceId).temporaryTabs;
            }, setup.spaceId);
        // The link rule decides where the child is listed; moving the tab listed last to the front
        // of Chrome's tab strip leaves Sidecove's order as it was.
        const order = await listed();
        expect([...order].sort()).toEqual([setup.tabId, child].sort());
        await helper.evaluate(async id => {
            await chrome.tabs.move(id, { index: 0 });
        }, order.at(-1));
        expect(await listed()).toEqual(order);
        expect(await helper.$eval('#syncTabGroups', el => el.checked)).toBe(false);
        await helper.$eval('#syncTabGroups', input => input.click());
        await helper.waitForFunction(
            async ({ tabId, child, order }) => {
                const a = await chrome.tabs.get(tabId),
                    b = await chrome.tabs.get(child);
                if (a.groupId === -1 || a.groupId !== b.groupId) return false;
                const members = await chrome.tabs.query({ groupId: a.groupId });
                return (
                    (await chrome.tabGroups.get(a.groupId)).title === 'Independent Work' &&
                    members.map(t => t.id).join(',') === order.join(',')
                );
            },
            { polling: 100 },
            { ...setup, child, order }
        );
        await helper.$eval('#syncTabGroups', input => input.click());
        await helper.waitForFunction(async () => !(await chrome.storage.sync.get('syncTabGroups')).syncTabGroups, {
            polling: 100
        });
        await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' }));
        await helper.evaluate(async ({ tabId }) => {
            const tab = await chrome.tabs.get(tabId);
            await chrome.tabGroups.update(tab.groupId, { title: 'Leave me alone' });
        }, setup);
        await new Promise(r => setTimeout(r, 500));
        expect(
            await helper.evaluate(async ({ tabId }) => {
                const tab = await chrome.tabs.get(tabId);
                return (await chrome.tabGroups.get(tab.groupId)).title;
            }, setup)
        ).toBe('Leave me alone');
        await helper.evaluate(
            async ({ tabId, child }) => {
                await chrome.tabs.remove([tabId, child]);
            },
            { ...setup, child }
        );
        await helper.waitForFunction(
            async spaceId => {
                const { spaces } = await chrome.storage.local.get('spaces');
                const space = spaces.find(s => s.id === spaceId);
                return space && space.temporaryTabs.length === 0;
            },
            { polling: 100 },
            setup.spaceId
        );
        page = await openSidebar(browser, extensionId);
        expect(await page.$(`[data-space-id="${setup.spaceId}"]`)).not.toBeNull();
        const homeId = await page.evaluate(
            async () => (await chrome.storage.local.get('spaces')).spaces.find(s => s.name === 'Home').id
        );
        await page.$eval(`#spaceSwitcher button[data-space-id="${homeId}"]`, button => button.click());
        const laterId = await helper.evaluate(async spaceId => {
            const tab = await chrome.tabs.create({ url: 'https://example.net/', active: false });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
            return tab.id;
        }, setup.spaceId);
        await page.$eval(`#spaceSwitcher button[data-space-id="${setup.spaceId}"]`, button => button.click());
        await page.waitForSelector(`.space.active .tab[data-tab-id="${laterId}"]`);
        expect(await page.$$eval(`.tab[data-tab-id="${laterId}"]`, tabs => tabs.length)).toBe(1);
        expect(errors).toEqual([]);
    });
});
