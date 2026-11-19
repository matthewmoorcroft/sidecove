import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// With Settings -> Sync spaces to Chrome tab groups on, a "Sign in with Google" popup or Google
// Meet's picture-in-picture window used to get a tab group. Those windows have no tab strip and
// the browser crashed. Only tabs of regular browser windows may be grouped.
let browser, sidebar, site, server, base;

const GROUP_WAIT_MS = 10000;

const windowsNow = () =>
    sidebar.evaluate(async () =>
        (await chrome.windows.getAll({ populate: true })).map(window => ({
            type: window.type,
            alwaysOnTop: window.alwaysOnTop,
            tabs: window.tabs.map(tab => ({ id: tab.id, url: tab.url, groupId: tab.groupId }))
        }))
    );

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>Page ${req.url.slice(1)}</title>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    sidebar = await openSidebar(browser, result.extensionId);
    await sidebar.evaluate(() => chrome.storage.sync.set({ syncTabGroups: true }));
    site = await browser.newPage();
    await site.goto(`${base}/meet`);
});

afterAll(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
});

test('a sign-in popup and a picture-in-picture window get no tab group', async () => {
    await site.evaluate(async () => {
        await documentPictureInPicture.requestWindow({ width: 300, height: 200 });
    });
    await site.evaluate(url => window.open(url, 'sign-in', 'popup,width=400,height=500'), `${base}/sign-in`);
    // A new tab in the regular window makes the sync run again after both windows exist.
    const control = await sidebar.evaluate(
        async url => (await chrome.tabs.create({ url, active: false })).id,
        `${base}/new-tab`
    );
    await sidebar.waitForFunction(
        async id => (await chrome.tabs.get(id)).groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE,
        { polling: 100, timeout: GROUP_WAIT_MS },
        control
    );

    const windows = await windowsNow();
    const popup = windows.find(window => window.type === 'popup');
    const pictureInPicture = windows.find(window => window.type === 'normal' && window.alwaysOnTop);
    expect(popup.tabs.map(tab => tab.groupId)).toEqual([-1]);
    expect(pictureInPicture.tabs.map(tab => tab.groupId)).toEqual([-1]);
    const regular = windows.find(window => window.type === 'normal' && !window.alwaysOnTop);
    expect(regular.tabs.find(tab => tab.id === control).groupId).not.toBe(-1);
});
