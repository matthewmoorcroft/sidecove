import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// A New Tab that was already open when the extension's worker started (Chrome's first tab, or
// one open while a build is installed, updated or reloaded) used to stay open, so "+ New Tab"
// left two. The worker is stopped and its session storage cleared, which is what it starts
// from after an install, an update, a reload or a browser start, with an empty New Tab shown.
let browser, page;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const tabs = () =>
    page.evaluate(async () =>
        (await chrome.tabs.query({})).map(t => ({ id: t.id, active: t.active, url: t.url || t.pendingUrl }))
    );
const isNewTabPage = tab => /^chrome:\/\/(newtab|new-tab-page)\/?$/.test(tab.url);

beforeAll(async () => {
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
});
afterAll(async () => {
    await browser?.close();
});

test('"+ New Tab" leaves one New Tab when one was already open as the extension started', async () => {
    const earlier = await page.evaluate(async () => (await chrome.tabs.create({ active: true })).id);
    await page.waitForFunction(
        async id => /^chrome:\/\/(newtab|new-tab-page)\/?$/.test((await chrome.tabs.get(id)).url),
        { polling: 100 },
        earlier
    );

    // Start the worker again with nothing remembered, the empty New Tab still shown.
    const session = await page.createCDPSession();
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
    await page.evaluate(() => chrome.storage.session.clear());
    // Any answer shows the worker is running again; the pause lets it finish looking at the tabs.
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' }));
    await wait(1000);
    expect((await tabs()).find(t => t.active).id).toBe(earlier);

    // The side panel page is in the background, so the empty New Tab is the one shown, as it
    // is when the real side panel is open.
    await page.$eval('.space.active .new-tab-btn', button => button.click());
    await page.waitForFunction(
        async earlier => !(await chrome.tabs.query({})).some(t => t.id === earlier),
        { polling: 100 },
        earlier
    );

    const newTabs = (await tabs()).filter(isNewTabPage);
    expect(newTabs).toHaveLength(1);
    expect(newTabs[0].active).toBe(true);
});
