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
