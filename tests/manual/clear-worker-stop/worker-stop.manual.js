// Manual check, not part of `npm run test:e2e`: the Jest config only picks up tests/e2e.
// See README.md in this folder for how to run it. It stops the service worker once
// while Clear's 8-second Undo window is ending, then wakes it and looks at what is left.
import { createServer } from 'node:http';
import { launchBrowserWithExtension, createSpace } from '../../e2e/helpers/extension-helper.js';

const ATTEMPTS = Number(process.env.WORKER_STOP_ATTEMPTS || 1);
// The widened build waits 3 s once the close is due; the stop lands in the middle of that wait.
const STOP_AFTER_MS = Number(process.env.WORKER_STOP_AFTER_MS || 1500);
const ROWS = '.space.active [data-tab-type="temporary"] .tab[data-tab-id]';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let server, base, browser, extensionId, page;

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1)}</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);
    await sleep(1500);
}, 60000);

afterAll(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
});

const session = keys => page.evaluate(keys => chrome.storage.session.get(keys), keys);
const isOpen = id =>
    page.evaluate(
        id =>
            chrome.tabs.get(id).then(
                () => true,
                () => false
            ),
        id
    );

test('a worker stop as the Undo window ends never leaves cleared tabs hidden and muted', async () => {
    const cdp = await page.createCDPSession();
    await cdp.send('ServiceWorker.enable');
    const left = [];
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const name = `Stop ${attempt}`;
        const sidebar = await createSpace(browser, extensionId, name);
        await sidebar.setViewport({ width: 360, height: 800 });
        const spaceId = await sidebar.evaluate(
            async name =>
                (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces.find(
                    s => s.name === name
                ).id,
            name
        );
        const ids = [];
        for (const n of [1, 2]) {
            ids.push(
                await sidebar.evaluate(
                    async ({ url, spaceId }) => {
                        const tab = await chrome.tabs.create({ url, active: false });
                        await chrome.runtime.sendMessage({
                            type: 'spaceStore',
                            action: 'assign',
                            tabId: tab.id,
                            spaceId
                        });
                        return tab.id;
                    },
                    { url: `${base}/stop-${attempt}-${n}`, spaceId }
                )
            );
        }
        await sidebar.waitForFunction((s, n) => document.querySelectorAll(s).length === n, { polling: 100 }, ROWS, 2);
        await sidebar.bringToFront();
        await sleep(400);
        await sidebar.$eval('.space.active .clean-tabs-btn', button => button.click());
        await sidebar.waitForFunction((s, n) => document.querySelectorAll(s).length === n, { polling: 100 }, ROWS, 0);
        const { pendingCleans = [] } = await session('pendingCleans');
        const batch = pendingCleans.find(b => b.tabs.some(t => ids.includes(t.tabId)));
        await sidebar.close();
        // Stop the worker while it is inside the widened gap.
        await sleep(Math.max(0, batch.closeAt + STOP_AFTER_MS - Date.now()));
        await cdp.send('ServiceWorker.stopAllWorkers');
        await sleep(500);
        // Wake the worker; a batch it still has on record is finished now (the widened build waits 3 s again).
        await page.evaluate(() => chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' }));
        await sleep(5000);
        for (const id of ids) if (await isOpen(id)) left.push({ attempt, id });
    }
    expect(left).toEqual([]);
}, 600000);
