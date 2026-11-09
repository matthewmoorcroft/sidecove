import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Issue #66: the Theme Color submenu of the space menu was cut off at the panel's edge.
let browser, extensionId, page;

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
});
afterAll(async () => {
    await browser?.close();
});

// Opens the space menu on the active space's chip, hovers Theme Color and reports where the
// submenu ended up next to the panel's edges.
async function openThemeColorSubmenu(width) {
    await page.setViewport({ width, height: 700 });
    await page.$eval('#spaceSwitcher button', el => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 }));
    });
    await page.waitForSelector('#tab-context-menu .with-submenu');
    const item = await page.$('#tab-context-menu .with-submenu');
    await item.hover();
    await page.waitForFunction(
        () => {
            const submenu = document.querySelector('#tab-context-menu .submenu');
            return submenu && getComputedStyle(submenu).display === 'block' && submenu.style.left !== undefined;
        },
        { polling: 100 }
    );
    // Placement runs on the next frame after the hover.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.evaluate(() => {
        const submenu = document.querySelector('#tab-context-menu .submenu').getBoundingClientRect();
        const item = document.querySelector('#tab-context-menu .with-submenu').getBoundingClientRect();
        return {
            left: submenu.left,
            right: submenu.right,
            top: submenu.top,
            bottom: submenu.bottom,
            itemRight: item.right,
            itemLeft: item.left,
            width: window.innerWidth,
            height: window.innerHeight
        };
    });
}

const closeMenu = () => page.evaluate(() => document.getElementById('tab-context-menu')?.remove());

test('Theme Color submenu opens to the right when the panel is wide enough', async () => {
    const box = await openThemeColorSubmenu(700);
    expect(box.left).toBeGreaterThanOrEqual(box.itemRight - 1);
    expect(box.right).toBeLessThanOrEqual(box.width);
    await closeMenu();
});

test.each([260, 200])('Theme Color submenu stays inside a %ipx panel', async width => {
    const box = await openThemeColorSubmenu(width);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.width);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    await closeMenu();
});
