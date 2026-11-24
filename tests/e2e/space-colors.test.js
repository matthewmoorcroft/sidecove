import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { hexToRgb, hsvToHex } from '../../src/sidebar/features/space-colors/color-math.js';
import { nearestChromeColor, readableSurface } from '../../src/sidebar/features/space-colors/readable-surface.js';
import { PALETTE, wheelStops } from '../../src/sidebar/features/space-colors/space-palette.js';

// The space menu offers 11 colours with one click each, named on hover and ticked when chosen,
// and any colour through the Custom color circle beside them, kept readable in both modes
// (issue #67).
let browser, extensionId, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rgb = hex => `rgb(${hexToRgb(hex).join(', ')})`;
const scheme = value => page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]);
const MENU = '.space.active .space-options-dropdown';
const SWATCHES = `${MENU} .color-swatch:not(.custom-color-swatch)`;
const CUSTOM = `${MENU} .custom-color-swatch`;

const storedSpace = () =>
    page.evaluate(async () => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const id = document.querySelector('.space.active')?.dataset.spaceId;
        return spaces.find(s => String(s.id) === id);
    });

const registryEntry = folderId =>
    page.evaluate(
        async folderId => (await chrome.storage.local.get('spaceRegistry')).spaceRegistry[folderId],
        folderId
    );

// The colour the sidebar paints behind the space, once its 0.2s fade has finished.
const panelBackground = expected =>
    page.waitForFunction(
        expected => getComputedStyle(document.getElementById('sidebar-container')).backgroundColor === expected,
        { polling: 100, timeout: 5000 },
        expected
    );

const waitForStored = (color, shade) =>
    page.waitForFunction(
        async (color, shade) => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const id = document.querySelector('.space.active')?.dataset.spaceId;
            const space = spaces.find(s => String(s.id) === id);
            return space?.color === color && (space.shade ?? null) === shade;
        },
        { polling: 100, timeout: 5000 },
        color,
        shade
    );

async function openMenu() {
    await page.hover('.space.active .space-options');
    await page.waitForSelector(MENU, { visible: true });
}

async function closeMenu() {
    await page.keyboard.press('Escape');
    await page.mouse.move(5, 790);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForSelector(MENU, { hidden: true });
}

// The wheel's colours, and the box it is drawn in: border-box, so it shows no square seam.
const wheel = () =>
    page.$eval(CUSTOM, el => ({
        origin: getComputedStyle(el).backgroundOrigin,
        image: getComputedStyle(el).backgroundImage
    }));

async function openCustom() {
    await openMenu();
    await page.click(CUSTOM);
    await page.waitForSelector(`${MENU} .custom-color-picker`, { visible: true });
}

async function typeHex(hex) {
    await page.click(`${MENU} .custom-color-hex`, { clickCount: 3 });
    await page.keyboard.type(hex);
}

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
    await page.setViewport({ width: 360, height: 800 });
    await page.waitForSelector(`.space.active ${MENU.slice('.space.active '.length)} .color-swatch`);
});

afterAll(async () => {
    await browser?.close();
});

beforeEach(async () => {
    await page.bringToFront();
    await scheme('light');
});

test('the menu opens on 11 colours and a Custom color circle, each named on hover', async () => {
    await openMenu();
    const swatches = await page.$$eval(`${MENU} .color-swatch`, els =>
        els.map(el => ({ name: el.dataset.color, label: el.getAttribute('aria-label'), role: el.role }))
    );
    expect(swatches).toEqual([
        ...PALETTE.map(c => ({ name: c.name, label: c.label, role: 'button' })),
        { name: 'custom', label: 'Custom color', role: 'button' }
    ]);
    // All in one grid: the circle is in the second row with the swatches, not a row of its own.
    const rows = await page.$$eval(`${MENU} .color-swatch`, els => new Set(els.map(el => el.offsetTop)).size);
    expect(rows).toBe(2);

    await page.hover(CUSTOM);
    await page.waitForFunction(
        menu => document.querySelector(`${menu} .color-swatch-tip`)?.textContent === 'Custom color',
        { polling: 50, timeout: 3000 },
        MENU
    );
    for (const name of ['mint', 'indigo', 'blue']) {
        await page.hover(`${MENU} .color-swatch[data-color="${name}"]`);
        await page.waitForFunction(
            (menu, label) => {
                const tip = document.querySelector(`${menu} .color-swatch-tip`);
                return tip && !tip.hidden && tip.textContent === label;
            },
            { polling: 50, timeout: 3000 },
            MENU,
            PALETTE.find(c => c.name === name).label
        );
    }
    // Keyboard focus names the colour too.
    await page.focus(`${MENU} .color-swatch[data-color="mint"]`);
    expect(await page.$eval(`${MENU} .color-swatch-tip`, tip => !tip.hidden && tip.textContent)).toBe('Mint');
    // The grid is one Tab stop; arrow keys move in it, through the circle too, and Enter picks.
    expect(await page.$$eval(`${MENU} .color-swatch[tabindex="0"]`, els => els.length)).toBe(1);
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement.dataset.color)).toBe('custom');
    await page.keyboard.press('ArrowUp');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement.dataset.color)).toBe('blue');
    expect(await page.$eval(`${MENU} .color-swatch-tip`, tip => tip.textContent)).toBe('Blue');
    await page.keyboard.press('Enter');
    await waitForStored('blue', null);
    await closeMenu();
});

test('picking a palette colour paints it, ticks it, and stores its tab group colour', async () => {
    const before = await storedSpace();
    await openMenu();
    await page.click(`${MENU} .color-swatch[data-color="mint"]`);
    await waitForStored('green', 'mint');
    await panelBackground(rgb('#a9e7c8'));
    const marks = await page.$$eval(`${MENU} .color-swatch.selected`, els =>
        els.map(el => ({
            name: el.dataset.color,
            pressed: el.getAttribute('aria-pressed'),
            tick: getComputedStyle(el, '::after').borderRightWidth
        }))
    );
    expect(marks).toEqual([{ name: 'mint', pressed: 'true', tick: '2px' }]);
    // The durable record follows, so a space rebuilt from its bookmark folder keeps its colour.
    expect(await registryEntry(before.bookmarkFolderId)).toMatchObject({ color: 'green', shade: 'mint' });

    // One of Chrome's own colours needs no shade.
    await page.click(`${MENU} .color-swatch[data-color="blue"]`);
    await waitForStored('blue', null);
    await panelBackground(rgb('#8bb3f3'));
    expect(await page.$$eval(`${MENU} .color-swatch.selected`, els => els.map(el => el.dataset.color))).toEqual([
        'blue'
    ]);
    await closeMenu();
});

test('a custom colour typed as hex is kept readable and shown in the Custom color circle', async () => {
    await openCustom();
    await typeHex('#6A4C93');
    await waitForStored('purple', '#6a4c93');
    await panelBackground(rgb(readableSurface('#6a4c93', 'light')));
    const preview = await page.$eval(`${MENU} .custom-color-picker`, picker => ({
        light: getComputedStyle(picker.querySelector('.preview-light')).backgroundColor,
        dark: getComputedStyle(picker.querySelector('.preview-dark')).backgroundColor,
        group: picker.querySelector('.custom-color-group-select').selectedOptions[0].textContent,
        note: picker.querySelector('.custom-color-note').textContent
    }));
    expect(preview).toEqual({
        light: rgb(readableSurface('#6a4c93', 'light')),
        dark: rgb(readableSurface('#6a4c93', 'dark')),
        group: 'Auto (Purple)',
        note: expect.stringContaining('Light mode: lightened just enough for the text.')
    });

    // A tab group colour chosen by hand is kept.
    await page.select(`${MENU} .custom-color-group-select`, 'green');
    await waitForStored('green', '#6a4c93');

    await page.click(`${MENU} .custom-color-back`);
    await page.waitForSelector(`${MENU} .color-picker-grid`, { visible: true });
    const circle = await page.$eval(CUSTOM, el => ({
        selected: el.classList.contains('selected'),
        label: el.getAttribute('aria-label'),
        fill: getComputedStyle(el, '::before').backgroundColor
    }));
    expect(circle).toEqual({
        selected: true,
        label: 'Custom color #6A4C93',
        fill: rgb(readableSurface('#6a4c93', 'light'))
    });
    expect(await page.$$(`${SWATCHES}.selected`)).toHaveLength(0);
    // Its name, the longest, stays inside the panel although the circle is at the end of its row.
    await page.hover(CUSTOM);
    await page.waitForFunction(
        menu => document.querySelector(`${menu} .color-swatch-tip`)?.textContent === 'Custom color #6A4C93',
        { polling: 50, timeout: 3000 },
        MENU
    );
    // Inside the spaces list, which clips what overflows it, 8px in from the panel's edges.
    const tip = await page.$eval(`${MENU} .color-swatch-tip`, el => {
        const r = el.getBoundingClientRect();
        const list = document.getElementById('spacesList').getBoundingClientRect();
        return { left: r.left, right: r.right, listLeft: list.left, listRight: list.right };
    });
    expect(tip.left).toBeGreaterThanOrEqual(tip.listLeft);
    expect(tip.right).toBeLessThanOrEqual(tip.listRight);
    expect(await page.$eval('.space.active .space-color-select', select => select.value)).toBe('#6a4c93');
    await closeMenu();

    // It survives a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${MENU} .color-swatch`);
    await panelBackground(rgb(readableSurface('#6a4c93', 'light')));
});

test('a custom colour picked on the colour square, with the hue slider', async () => {
    await openCustom();
    // The previous test chose the tab group colour by hand; back to the nearest one.
    await page.select(`${MENU} .custom-color-group-select`, 'auto');
    await page.$eval(`${MENU} .custom-color-hue`, input => {
        input.value = '200';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const box = await (await page.$(`${MENU} .custom-color-square`)).boundingBox();
    // Three quarters saturation, nine tenths brightness.
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.1 + 1);
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.1);
    await page.mouse.up();
    const space = await storedSpace();
    const [r, g, b] = hexToRgb(space.shade);
    const [er, eg, eb] = hexToRgb(hsvToHex(200, 0.75, 0.9));
    // Within a step or two of where the pointer was.
    expect(Math.max(Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb))).toBeLessThan(8);
    expect(space.color).toBe(nearestChromeColor(space.shade));
    await panelBackground(rgb(readableSurface(space.shade, 'light')));
    expect(await page.$eval(`${MENU} .custom-color-hex`, input => input.value)).toBe(space.shade.toUpperCase());
    await closeMenu();
});

test('in dark mode the menu shows each colour’s dark version, and the space uses it', async () => {
    await scheme('dark');
    await openMenu();
    await page.click(`${MENU} .color-swatch[data-color="indigo"]`);
    await waitForStored('blue', 'indigo');
    await panelBackground(rgb('#2c2c64'));
    const swatches = await page.$$eval(SWATCHES, els =>
        Object.fromEntries(els.map(el => [el.dataset.color, getComputedStyle(el).backgroundColor]))
    );
    expect(swatches).toEqual(Object.fromEntries(PALETTE.map(c => [c.name, rgb(c.dark)])));
    expect(await page.$eval(`${MENU} .color-swatch.selected`, el => getComputedStyle(el, '::after').borderColor)).toBe(
        'rgb(236, 239, 241)'
    );
    await page.hover(`${MENU} .color-swatch[data-color="pink"]`);
    await page.waitForFunction(
        menu => document.querySelector(`${menu} .color-swatch-tip`)?.textContent === 'Pink',
        {
            polling: 50
        },
        MENU
    );

    // The wheel takes mid-tones in dark mode, so its colours can be told apart on the dark menu.
    expect(await wheel()).toEqual({
        origin: 'border-box',
        image: `conic-gradient(${wheelStops('dark').map(rgb).join(', ')})`
    });

    // A custom colour gets a deep version of its hue.
    await page.click(CUSTOM);
    await typeHex('#ffd000');
    await waitForStored('yellow', '#ffd000');
    await panelBackground(rgb(readableSurface('#ffd000', 'dark')));
    await closeMenu();

    // And the light swatches are back in light mode.
    await scheme('light');
    await openMenu();
    const light = await page.$$eval(SWATCHES, els =>
        Object.fromEntries(els.map(el => [el.dataset.color, getComputedStyle(el).backgroundColor]))
    );
    expect(light).toEqual(Object.fromEntries(PALETTE.map(c => [c.name, rgb(c.light)])));
    expect(await wheel()).toEqual({
        origin: 'border-box',
        image: `conic-gradient(${wheelStops('light').map(rgb).join(', ')})`
    });
    await closeMenu();
});

test('a space imported from an orange tab group is painted orange', async () => {
    await page.evaluate(async () => {
        const id = document.querySelector('.space.active').dataset.spaceId;
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        await chrome.runtime.sendMessage({
            type: 'spaceStore',
            action: 'patch',
            before: spaces,
            after: spaces.map(s => (String(s.id) === id ? { ...s, color: 'orange', shade: null } : s))
        });
    });
    await panelBackground(rgb('#ffc38c'));
    await openMenu();
    expect(await page.$$eval(`${MENU} .color-swatch.selected`, els => els.map(el => el.dataset.color))).toEqual([
        'orange'
    ]);
    await closeMenu();
});

test('the space chip’s Theme Color menu offers the same colours', async () => {
    await page.evaluate(() => chrome.storage.sync.set({ spaceSwitcherStyle: 'names' }));
    await page.waitForSelector('#spaceSwitcher:not(.icons-only) button.active');
    await page.$eval('#spaceSwitcher button.active', el => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 10, clientY: r.top + 5 }));
    });
    await page.waitForSelector('.context-menu', { visible: true });
    const labels = await page.$$eval('.context-menu .context-menu-item.with-submenu', items => {
        const theme = items.find(item => item.textContent.startsWith('Theme Color'));
        return [...theme.querySelectorAll('.context-menu.submenu .context-menu-item')].map(i => i.textContent);
    });
    expect(labels).toEqual(PALETTE.map(c => c.label));
    await page.$$eval('.context-menu .context-menu-item.with-submenu', items => {
        const theme = items.find(item => item.textContent.startsWith('Theme Color'));
        [...theme.querySelectorAll('.context-menu.submenu .context-menu-item')]
            .find(i => i.textContent === 'Indigo')
            .click();
    });
    await waitForStored('blue', 'indigo');
    await panelBackground(rgb('#acb3f6'));
    await page.evaluate(() => chrome.storage.sync.set({ spaceSwitcherStyle: 'icons' }));
    await sleep(200);
});
