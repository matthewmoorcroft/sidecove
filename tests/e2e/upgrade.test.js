import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Updating from 1.1.0 keeps every space, favorite and setting. An unpacked extension's ID
// comes from its folder, so the update replaces the files in one folder and reuses the
// profile. SIDECOVE_PREVIOUS_BUILD can point at a real 1.1.0 build; otherwise the current
// build is installed first under version 1.1.0.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
let root, extensionDir, profileDir;

function install(from, version = null) {
    fs.rmSync(extensionDir, { recursive: true, force: true });
    fs.cpSync(from, extensionDir, { recursive: true });
    if (version) {
        const manifestPath = path.join(extensionDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version }, null, 2));
    }
}

// Everything a user would lose: spaces, the bookmark tree under Sidecove, and settings.
const snapshot = page => page.evaluate(async () => {
    const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
    const [root] = (await chrome.bookmarks.search({ title: 'Sidecove' })).filter(node => !node.url);
    const tree = async id => Promise.all((await chrome.bookmarks.getChildren(id)).map(async node =>
        node.url ? { title: node.title, url: node.url } : { title: node.title, children: await tree(node.id) }));
    return {
        spaces: spaces.map(({ id, name, color, bookmarkFolderId }) => ({ id, name, color, bookmarkFolderId })),
        bookmarks: root ? await tree(root.id) : null,
        settings: await chrome.storage.sync.get(null)
    };
});

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecove-upgrade-'));
    extensionDir = path.join(root, 'extension');
    profileDir = path.join(root, 'profile');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

test('a 1.1.0 profile keeps its spaces, favorites and settings after updating', async () => {
    const previous = process.env.SIDECOVE_PREVIOUS_BUILD;
    install(previous || dist, previous ? null : '1.1.0');
    let { browser, extensionId } = await launchBrowserWithExtension({ extensionPath: extensionDir, userDataDir: profileDir });
    let page = await openSidebar(browser, extensionId);
    expect(await page.evaluate(() => chrome.runtime.getManifest().version)).toBe('1.1.0');
    await page.$eval('#addSpaceBtn', button => button.click());
    await page.$eval('#newSpaceName', input => {
        input.value = 'Work';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('#spaceColor', select => { select.value = 'blue'; });
    await page.$eval('#createSpaceBtn', button => button.click());
    await page.waitForFunction(() => document.querySelector('#spaceSwitcher button.active')?.textContent.includes('Work'), { polling: 100 });
    await page.evaluate(async () => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const work = spaces.find(space => space.name === 'Work');
        const folder = await chrome.bookmarks.create({ parentId: work.bookmarkFolderId, title: 'Projects' });
        await chrome.bookmarks.create({ parentId: folder.id, title: 'Roadmap', url: 'https://example.com/roadmap' });
        await chrome.bookmarks.create({ parentId: work.bookmarkFolderId, title: 'Docs', url: 'https://example.com/docs' });
        await chrome.storage.sync.set({ defaultSpaceName: 'Work', autoArchiveEnabled: true, autoArchiveIdleMinutes: 90 });
    });
    const before = await snapshot(page);
    expect(before.spaces.map(space => space.name)).toEqual(expect.arrayContaining(['Home', 'Work']));
    await browser.close();

    install(dist);
    ({ browser, extensionId } = await launchBrowserWithExtension({ extensionPath: extensionDir, userDataDir: profileDir }));
    try {
        page = await openSidebar(browser, extensionId);
        expect(await page.evaluate(() => chrome.runtime.getManifest().version)).toBe('1.2.0');
        expect(await snapshot(page)).toEqual(before);
        const chips = await page.$$eval('#spaceSwitcher button[data-space-id]', buttons => buttons.map(button => button.textContent.trim()));
        expect(chips.some(text => text.endsWith('Work'))).toBe(true);
    } finally {
        await browser.close();
    }
});
