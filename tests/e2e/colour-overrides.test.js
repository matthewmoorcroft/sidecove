import { launchBrowserWithExtension, openSidebar, openOptionsPage } from './helpers/extension-helper.js';

// A custom colour from Settings must show in the colour pickers, not only in the
// sidebar background (upstream issue #39).
let browser, extensionId;

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
});
afterAll(async () => {
    await browser?.close();
});

const swatchColours = page =>
    page.evaluate(() => ({
        create: getComputedStyle(document.querySelector('#createSpaceColorSwatch [data-color="blue"]')).backgroundColor,
        menu: getComputedStyle(document.querySelector('.space.active #spaceOptionColorSwatch [data-color="blue"]'))
            .backgroundColor,
        grey: getComputedStyle(document.querySelector('#createSpaceColorSwatch [data-color="grey"]')).backgroundColor
    }));

// Swatches show each colour as a space in it looks (issue #67): its light surface here.
test('swatches show the space colours and follow a colour override', async () => {
    const page = await openSidebar(browser, extensionId);
    expect(await swatchColours(page)).toEqual({
        create: 'rgb(139, 179, 243)',
        menu: 'rgb(139, 179, 243)',
        grey: 'rgb(204, 204, 204)'
    });

    await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: { blue: '#ff8800' } }));
    await page.waitForFunction(
        () =>
            getComputedStyle(document.querySelector('#createSpaceColorSwatch [data-color="blue"]')).backgroundColor ===
            'rgb(255, 136, 0)',
        { polling: 100 }
    );
    expect(await swatchColours(page)).toEqual({
        create: 'rgb(255, 136, 0)',
        menu: 'rgb(255, 136, 0)',
        grey: 'rgb(204, 204, 204)'
    });

    await page.reload();
    await page.waitForSelector('.space.active #spaceOptionColorSwatch [data-color="blue"]');
    await page.waitForSelector('#createSpaceColorSwatch [data-color="blue"]');
    expect((await swatchColours(page)).menu).toBe('rgb(255, 136, 0)');
});

// Issue #14: each colour has a light and a dark value, and the sidebar uses the one for
// the system theme. A colour without a dark value keeps the built-in dark default.
const DARK_DEFAULT_BLUE = 'rgb(0, 43, 74)';
const setScheme = (page, value) => page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]);
// Swatches and the sidebar background fade over 0.2s, so wait for the colour to arrive.
const waitForSwatch = (page, expected) =>
    page.waitForFunction(
        expected =>
            getComputedStyle(document.querySelector('#createSpaceColorSwatch [data-color="blue"]')).backgroundColor ===
            expected,
        { polling: 100 },
        expected
    );
// The colour --chrome-blue-color resolves to under the page's current colour scheme.
const resolveBlue = () => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--chrome-blue-color');
    document.body.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
};
const waitForBlue = (page, expected) =>
    page.waitForFunction(`(${resolveBlue})() === ${JSON.stringify(expected)}`, { polling: 100 });

test('a light override does not reach dark mode, and a dark override does not reach light mode', async () => {
    const page = await openSidebar(browser, extensionId);
    try {
        await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: { blue: '#ff8800' } }));
        await setScheme(page, 'light');
        await waitForBlue(page, 'rgb(255, 136, 0)');
        await waitForSwatch(page, 'rgb(255, 136, 0)');

        // Only a light value is set, so dark mode keeps the built-in dark colour.
        await setScheme(page, 'dark');
        await waitForBlue(page, DARK_DEFAULT_BLUE);

        await page.evaluate(() => chrome.storage.sync.set({ colorOverridesDark: { blue: '#123456' } }));
        await waitForBlue(page, 'rgb(18, 52, 86)');
        await waitForSwatch(page, 'rgb(18, 52, 86)');

        await setScheme(page, 'light');
        await waitForBlue(page, 'rgb(255, 136, 0)');
        await waitForSwatch(page, 'rgb(255, 136, 0)');
    } finally {
        await setScheme(page, 'light');
        await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: null, colorOverridesDark: null }));
    }
});

test('the built-in dark colours are the dark surfaces tinted with each space colour', async () => {
    const page = await openSidebar(browser, extensionId);
    try {
        await setScheme(page, 'dark');
        const colours = await page.evaluate(() => {
            const probe = document.createElement('div');
            document.body.append(probe);
            const read = name => {
                probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue(
                    `--chrome-${name}-color`
                );
                return getComputedStyle(probe).backgroundColor;
            };
            const result = Object.fromEntries(
                ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'].map(name => [name, read(name)])
            );
            probe.remove();
            return result;
        });
        expect(colours).toEqual({
            grey: 'rgb(37, 45, 48)',
            blue: 'rgb(0, 43, 74)',
            red: 'rgb(79, 10, 16)',
            yellow: 'rgb(64, 49, 0)',
            green: 'rgb(0, 51, 16)',
            pink: 'rgb(84, 24, 62)',
            purple: 'rgb(66, 33, 89)',
            cyan: 'rgb(1, 61, 68)'
        });
    } finally {
        await setScheme(page, 'light');
    }
});

test('the sidebar background follows a change of system theme without a reload', async () => {
    const page = await openSidebar(browser, extensionId);
    try {
        const dark = {
            grey: 'rgb(37, 45, 48)',
            blue: 'rgb(0, 43, 74)',
            red: 'rgb(79, 10, 16)',
            yellow: 'rgb(64, 49, 0)',
            green: 'rgb(0, 51, 16)',
            pink: 'rgb(84, 24, 62)',
            purple: 'rgb(66, 33, 89)',
            cyan: 'rgb(1, 61, 68)'
        };
        const background = () =>
            page.evaluate(() => ({
                color: document.querySelector('.space.active .space-color-select').value,
                background: getComputedStyle(document.getElementById('sidebar-container')).backgroundColor
            }));
        await setScheme(page, 'light');
        const light = await background();
        await setScheme(page, 'dark');
        await page.waitForFunction(
            expected => getComputedStyle(document.getElementById('sidebar-container')).backgroundColor === expected,
            { polling: 100 },
            dark[light.color]
        );
    } finally {
        await setScheme(page, 'light');
    }
});

test('Settings shows a Light and a Dark picker for each colour, each with its own Reset', async () => {
    const page = await openOptionsPage(browser, extensionId);
    try {
        await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: null, colorOverridesDark: null }));
        await page.reload();
        await page.waitForSelector('#colorBlueDark');
        expect(
            await page.evaluate(() => ({
                pickers: document.querySelectorAll('.color-picker').length,
                lightResets: document.querySelectorAll('.color-reset-btn[data-mode="light"]').length,
                darkResets: document.querySelectorAll('.color-reset-btn[data-mode="dark"]').length,
                darkBlue: document.getElementById('colorBlueDark').value
            }))
        ).toEqual({ pickers: 16, lightResets: 8, darkResets: 8, darkBlue: '#002b4a' });
        expect(
            await page.evaluate(() =>
                ['Grey', 'Blue', 'Red', 'Yellow', 'Green', 'Pink', 'Purple', 'Cyan'].map(
                    name => document.getElementById(`color${name}Dark`).value
                )
            )
        ).toEqual(['#252d30', '#002b4a', '#4f0a10', '#403100', '#003310', '#54183e', '#422159', '#013d44']);

        const pick = (id, value) =>
            page.evaluate(
                (id, value) => {
                    const picker = document.getElementById(id);
                    picker.value = value;
                    picker.dispatchEvent(new Event('input', { bubbles: true }));
                },
                id,
                value
            );
        // Clicked in the page: Puppeteer's click scrolls first, which can hang for a Reset below the fold.
        const clickReset = mode =>
            page.evaluate(
                mode => document.querySelector(`.color-reset-btn[data-color="blue"][data-mode="${mode}"]`).click(),
                mode
            );
        const stored = () => page.evaluate(() => chrome.storage.sync.get(['colorOverrides', 'colorOverridesDark']));
        const waitForStored = expected =>
            page.waitForFunction(
                async expected => {
                    const stored = await chrome.storage.sync.get(['colorOverrides', 'colorOverridesDark']);
                    return JSON.stringify(stored) === JSON.stringify(expected);
                },
                { polling: 100 },
                expected
            );

        await pick('colorBlue', '#ff8800');
        await pick('colorBlueDark', '#123456');
        await waitForStored({ colorOverrides: { blue: '#ff8800' }, colorOverridesDark: { blue: '#123456' } });

        // Resetting the dark picker leaves the light value alone.
        await clickReset('dark');
        await waitForStored({ colorOverrides: { blue: '#ff8800' }, colorOverridesDark: null });
        expect(await page.evaluate(() => document.getElementById('colorBlueDark').value)).toBe('#002b4a');

        await clickReset('light');
        await waitForStored({ colorOverrides: null, colorOverridesDark: null });
        expect(await stored()).toEqual({ colorOverrides: null, colorOverridesDark: null });
    } finally {
        await page.evaluate(() => chrome.storage.sync.set({ colorOverrides: null, colorOverridesDark: null }));
        await page.close();
    }
});
