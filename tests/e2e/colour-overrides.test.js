import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// A custom colour from Settings must show in the colour pickers, not only in the
// sidebar background (upstream issue #39).
let browser, extensionId;

beforeAll(async () => { ({ browser, extensionId } = await launchBrowserWithExtension()); });
afterAll(async () => { await browser?.close(); });

const swatchColours = page => page.evaluate(() => ({
    create: getComputedStyle(document.querySelector('#createSpaceColorSwatch [data-color="blue"]')).backgroundColor,
    menu: getComputedStyle(document.querySelector('.space.active #spaceOptionColorSwatch [data-color="blue"]')).backgroundColor,
    grey: getComputedStyle(document.querySelector('#createSpaceColorSwatch [data-color="grey"]')).backgroundColor
}));

test('swatches keep their default colours and follow a colour override', async () => {
    const page = await openSidebar(browser, extensionId);
    expect(await swatchColours(page)).toEqual({ create: 'rgb(96, 165, 250)', menu: 'rgb(96, 165, 250)', grey: 'rgb(156, 163, 175)' });

    await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: { blue: '#ff8800' } }));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#createSpaceColorSwatch [data-color="blue"]')).backgroundColor === 'rgb(255, 136, 0)', { polling: 100 });
    expect(await swatchColours(page)).toEqual({ create: 'rgb(255, 136, 0)', menu: 'rgb(255, 136, 0)', grey: 'rgb(156, 163, 175)' });

    await page.reload();
    await page.waitForSelector('.space.active #spaceOptionColorSwatch');
    expect((await swatchColours(page)).menu).toBe('rgb(255, 136, 0)');
});

// Light and dark mode have separate overrides, so a colour picked for light mode
// never sits behind dark-mode text.
const spaceBackground = page => page.evaluate(() => getComputedStyle(document.getElementById('sidebar-container')).getPropertyValue('--space-bg-color').trim());

test('dark mode uses its own override and ignores the light-mode one', async () => {
    const page = await openSidebar(browser, extensionId);
    await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: { blue: '#ff8800', grey: '#ff8800' }, colorOverridesDarkMode: { blue: '#112233' } }));
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.reload();
    await page.waitForSelector('.space.active #spaceOptionColorSwatch');

    // Swatches: blue follows the dark-mode override; grey has none, so it keeps its default.
    expect(await swatchColours(page)).toEqual({ create: 'rgb(17, 34, 51)', menu: 'rgb(17, 34, 51)', grey: 'rgb(156, 163, 175)' });
    const darkVars = await page.evaluate(() => ({
        blue: getComputedStyle(document.documentElement).getPropertyValue('--chrome-blue-color').trim(),
        grey: getComputedStyle(document.documentElement).getPropertyValue('--chrome-grey-color').trim()
    }));
    expect(darkVars).toEqual({ blue: '#112233', grey: '#546E7A' });

    // Switching the system theme with the sidebar open refreshes the space background.
    const darkBackground = await spaceBackground(page);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.waitForFunction(previous => getComputedStyle(document.getElementById('sidebar-container')).getPropertyValue('--space-bg-color').trim() !== previous, { polling: 100 }, darkBackground);
    expect((await swatchColours(page)).create).toBe('rgb(255, 136, 0)');

    await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: null, colorOverridesDarkMode: null }));
    await page.emulateMediaFeatures([]);
});
