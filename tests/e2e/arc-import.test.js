import { fileURLToPath } from 'node:url';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Import from Arc, from the space menu to new spaces. The file is a made-up one with the
// structure Arc writes (tests/e2e/fixtures/arc/StorableSidebar.json).
const ARC_FILE = fileURLToPath(new URL('./fixtures/arc/StorableSidebar.json', import.meta.url));
const NOT_ARC_FILE = fileURLToPath(new URL('./fixtures/window-helper/manifest.json', import.meta.url));

let browser, page;

const request = action =>
    page.evaluate(async action => {
        const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action });
        if (!response.success) throw new Error(response.error);
        return response.spaces;
    }, action);

// The Sidecove folder's tree as titles: a folder is [title, children], a bookmark its title.
const sidecoveTree = () =>
    page.evaluate(async () => {
        const [root] = (await chrome.bookmarks.search({ title: 'Sidecove' })).filter(node => !node.url);
        const [tree] = await chrome.bookmarks.getSubTree(root.id);
        const shape = node => (node.url ? node.title : [node.title, (node.children || []).map(shape)]);
        return tree.children.map(shape);
    });

async function openImport() {
    await page.$eval('.space.active .import-arc-btn', el => el.click());
    await page.waitForSelector('.arc-import h2');
}

beforeAll(async () => {
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    // A space of the user's own that shares a name with one in the Arc file.
    await page.evaluate(async () => {
        const [root] = (await chrome.bookmarks.search({ title: 'Sidecove' })).filter(node => !node.url);
        await chrome.bookmarks.create({ parentId: root.id, title: 'Personal' });
    });
    await request('get');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#spaceSwitcher button');
});

afterAll(async () => {
    await browser?.close();
});

test('the space menu opens the import, which says where Arc keeps its file', async () => {
    await openImport();
    const text = await page.$eval('.arc-import', el => el.textContent);
    expect(text).toContain('~/Library/Application Support/Arc/StorableSidebar.json');
    expect(text).toContain('Command-Shift-G');
    expect(text).toContain('%LOCALAPPDATA%\\Packages');
    // Mac first, then Windows.
    expect(text.indexOf('On a Mac')).toBeLessThan(text.indexOf('On Windows'));
    await page.$$eval('.arc-import-actions button', buttons => buttons.at(-1).click());
    expect(await page.$('.arc-import')).toBeNull();
});

test('a file that is not Arc’s is refused with a clear message and changes nothing', async () => {
    const before = await sidecoveTree();
    await openImport();
    const input = await page.$('.arc-import input[type="file"]');
    await input.uploadFile(NOT_ARC_FILE);
    await page.waitForSelector('.arc-import .arc-import-error');
    expect(await page.$eval('.arc-import .arc-import-error', el => el.textContent)).toContain(
        "This file is not Arc's sidebar file."
    );
    expect(await sidecoveTree()).toEqual(before);
    await page.$$eval('.arc-import-actions button', buttons => buttons.at(-1).click());
});

test('chosen Arc spaces become new spaces with their pinned tabs, folders, colour and icon', async () => {
    const before = await request('get');
    await openImport();
    const input = await page.$('.arc-import input[type="file"]');
    await input.uploadFile(ARC_FILE);
    await page.waitForSelector('.arc-import .arc-import-space');
    const listed = await page.$$eval('.arc-import .arc-import-space', labels => labels.map(l => l.textContent));
    expect(listed).toEqual(['Work5 pinned tabs, 5 folders', 'Personal1 pinned tab', 'Ideas0 pinned tabs, 1 folder']);
    // Leave Ideas out.
    await page.$$eval('.arc-import .arc-import-space input', boxes => boxes[2].click());
    await page.$eval('.arc-import .arc-import-primary', el => el.click());
    await page.waitForSelector('.arc-import .arc-import-done', { timeout: 15000 });

    const summary = await page.$eval('.arc-import', el => el.textContent);
    expect(summary).toContain('Imported 2 spaces with 6 pinned tabs and 5 folders.');
    expect(summary).toContain('2 favorites are in the folder “Favorites from Arc”.');
    expect(summary).toContain('1 split view became separate pinned tabs');
    expect(summary).toContain('2 today tabs');

    // The user's own Personal space is untouched; the Arc one is added after it.
    const tree = await sidecoveTree();
    const own = tree.find(node => node[0] === 'Personal');
    expect(own).toEqual(['Personal', []]);
    expect(tree.map(node => node[0]).slice(-2)).toEqual(['Work', 'Personal (Arc)']);
    expect(tree.at(-2)).toEqual([
        'Work',
        [
            ['Favorites from Arc', ['Mail', 'Calendar']],
            'Example docs',
            ['Projects', ['My project', ['Level 2', [['Level 3', [['Level 4', ['Deep page']]]]]]]],
            'Left',
            'Right'
        ]
    ]);
    expect(tree.at(-1)).toEqual(['Personal (Arc)', ['Home page']]);

    const after = await request('get');
    const added = after.filter(space => !before.some(old => old.id === space.id));
    expect(added.map(space => [space.name, space.color, space.shade ?? null, space.icon ?? null])).toEqual([
        ['Work', 'blue', '#5c8ce6', 'symbol:briefcase'],
        ['Personal (Arc)', 'grey', null, '🏠']
    ]);

    // The sidebar shows the first imported space with its pinned tabs.
    await page.waitForFunction(
        id => document.querySelector('.space.active')?.dataset.spaceId === id,
        { polling: 100 },
        added[0].id
    );
    await page.waitForFunction(
        () =>
            [...document.querySelectorAll('.space.active .pinned-tabs .tab-title-display')].some(
                el => el.textContent === 'Example docs'
            ),
        { polling: 100, timeout: 10000 }
    );
    await page.$$eval('.arc-import-actions button', buttons => buttons.at(-1).click());
    expect(await page.$('.arc-import')).toBeNull();
});

test('importing the same file again adds new spaces rather than merging', async () => {
    await openImport();
    const input = await page.$('.arc-import input[type="file"]');
    await input.uploadFile(ARC_FILE);
    await page.waitForSelector('.arc-import .arc-import-space');
    await page.$$eval('.arc-import .arc-import-space input', boxes => [boxes[0], boxes[2]].forEach(b => b.click()));
    await page.$eval('.arc-import .arc-import-primary', el => el.click());
    await page.waitForSelector('.arc-import .arc-import-done', { timeout: 15000 });
    const names = (await sidecoveTree()).map(node => node[0]);
    expect(names.slice(-3)).toEqual(['Work', 'Personal (Arc)', 'Personal (Arc 2)']);
    await page.$$eval('.arc-import-actions button', buttons => buttons.at(-1).click());
});

test('with tab group sync on, folders inside folders join their top folder', async () => {
    await page.evaluate(() => chrome.storage.sync.set({ syncTabGroups: true }));
    try {
        await openImport();
        const input = await page.$('.arc-import input[type="file"]');
        await input.uploadFile(ARC_FILE);
        await page.waitForSelector('.arc-import .arc-import-space');
        await page.$$eval('.arc-import .arc-import-space input', boxes => [boxes[1], boxes[2]].forEach(b => b.click()));
        await page.$eval('.arc-import .arc-import-primary', el => el.click());
        await page.waitForSelector('.arc-import .arc-import-done', { timeout: 15000 });
        expect(await page.$eval('.arc-import', el => el.textContent)).toContain(
            'as Sync spaces to Chrome tab groups is on.'
        );
        const work = (await sidecoveTree()).at(-1);
        expect(work[0]).toBe('Work (Arc)');
        expect(work[1].find(node => node[0] === 'Projects')).toEqual(['Projects', ['My project', 'Deep page']]);
        await page.$$eval('.arc-import-actions button', buttons => buttons.at(-1).click());
    } finally {
        await page.evaluate(() => chrome.storage.sync.set({ syncTabGroups: false }));
    }
});
