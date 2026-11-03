import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Updating keeps every space, favorite and setting. An unpacked extension's ID comes from its
// folder, so the update replaces the files in one folder and reuses the profile.
// SIDECOVE_PREVIOUS_BUILD lists earlier builds' dist/ folders, separated by the path
// delimiter; CI sets it to the latest release and to 1.1.0. Without it, the current build
// is installed first, relabelled as FALLBACK_PREVIOUS_VERSION.
const FALLBACK_PREVIOUS_VERSION = '1.1.0';
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const manifestVersion = dir => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version;
const currentVersion = manifestVersion(dist);
const previousBuilds = (process.env.SIDECOVE_PREVIOUS_BUILD || '').split(path.delimiter).filter(Boolean);
// CI always provides real release builds; relabelling the current build there would hide a broken setup.
if (!previousBuilds.length && process.env.CI) {
    throw new Error('SIDECOVE_PREVIOUS_BUILD is empty in CI: the workflow did not build any earlier release.');
}
if (!previousBuilds.length) {
    console.warn(`SIDECOVE_PREVIOUS_BUILD is not set, so this relabels the current build as ${FALLBACK_PREVIOUS_VERSION} instead of installing a release.`);
}

const parts = version => version.split('.').map(Number);
const newer = (a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
};
// Chrome only runs its update path for a higher version. Until the version is bumped for the
// next release, the latest release has this build's version, so the update is labelled one step up.
// A build older than the release would be a downgrade, which proves nothing about updating.
const updateVersion = previous => {
    if (newer(currentVersion, previous)) return currentVersion;
    if (newer(previous, currentVersion)) {
        throw new Error(`This build (${currentVersion}) is older than release ${previous}; update the branch from main.`);
    }
    const next = parts(previous);
    if (next.length < 4) next.push(1);
    else next[3]++;
    return next.join('.');
};

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
const snapshot = page =>
    page.evaluate(async () => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const [root] = (await chrome.bookmarks.search({ title: 'Sidecove' })).filter(node => !node.url);
        const tree = async id =>
            Promise.all(
                (await chrome.bookmarks.getChildren(id)).map(async node =>
                    node.url
                        ? { title: node.title, url: node.url }
                        : { title: node.title, children: await tree(node.id) }
                )
            );
        return {
            spaces: spaces.map(({ id, name, color, bookmarkFolderId }) => ({ id, name, color, bookmarkFolderId })),
            bookmarks: root ? await tree(root.id) : null,
            settings: await chrome.storage.sync.get(null)
        };
    });

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecove-upgrade-'));
    extensionDir = path.join(root, 'extension');
    profileDir = path.join(root, 'profile');
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const cases = previousBuilds.length
    ? previousBuilds.map(dir => [manifestVersion(dir), dir])
    : [[`${FALLBACK_PREVIOUS_VERSION} (relabelled current build)`, null]];

test.each(cases)('a profile from %s keeps its spaces, favorites and settings after updating', async (_, previous) => {
    install(previous || dist, previous ? null : FALLBACK_PREVIOUS_VERSION);
    const previousVersion = manifestVersion(extensionDir);
    let { browser, extensionId } = await launchBrowserWithExtension({
        extensionPath: extensionDir,
        userDataDir: profileDir
    });
    let page, before;
    try {
        page = await openSidebar(browser, extensionId);
        expect(await page.evaluate(() => chrome.runtime.getManifest().version)).toBe(previousVersion);
        await page.$eval('#addSpaceBtn', button => button.click());
        await page.$eval('#newSpaceName', input => {
            input.value = 'Work';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.$eval('#spaceColor', select => {
            select.value = 'blue';
        });
        await page.$eval('#createSpaceBtn', button => button.click());
        await page.waitForFunction(
            () => document.querySelector('#spaceSwitcher button.active')?.textContent.includes('Work'),
            { polling: 100 }
        );
        await page.evaluate(async () => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const work = spaces.find(space => space.name === 'Work');
            const folder = await chrome.bookmarks.create({ parentId: work.bookmarkFolderId, title: 'Projects' });
            await chrome.bookmarks.create({ parentId: folder.id, title: 'Roadmap', url: 'https://example.com/roadmap' });
            await chrome.bookmarks.create({ parentId: work.bookmarkFolderId, title: 'Docs', url: 'https://example.com/docs' });
            await chrome.storage.sync.set({ defaultSpaceName: 'Work', autoArchiveEnabled: true, autoArchiveIdleMinutes: 90 });
        });
        before = await snapshot(page);
        expect(before.spaces.map(space => space.name)).toEqual(expect.arrayContaining(['Home', 'Work']));
    } finally {
        await browser.close();
    }

    const updatedVersion = updateVersion(previousVersion);
    install(dist, updatedVersion);
    ({ browser, extensionId } = await launchBrowserWithExtension({
        extensionPath: extensionDir,
        userDataDir: profileDir
    }));
    try {
        page = await openSidebar(browser, extensionId);
        expect(await page.evaluate(() => chrome.runtime.getManifest().version)).toBe(updatedVersion);
        expect(await snapshot(page)).toEqual(before);
        const chips = await page.$$eval('#spaceSwitcher button[data-space-id]', buttons =>
            buttons.map(button => button.textContent.trim())
        );
        expect(chips.some(text => text.endsWith('Work'))).toBe(true);
    } finally {
        await browser.close();
    }
});
