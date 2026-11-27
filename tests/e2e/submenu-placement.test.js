import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// Issue #66: the Theme Color choices of the space menu were cut off at the panel's edge. They are
// now a popover, which stays inside the panel whatever its width.
let browser, extensionId, page;

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
});
afterAll(async () => {
    await browser?.close();
});

// Opens the space menu on the first chip, chooses Theme Color and reports where the popover ended
// up next to the panel's edges. `pick` opens the custom colour picker in it first.
async function openThemeColor(width, pick = false) {
    await page.setViewport({ width, height: 700 });
    await page.$eval('#spaceSwitcher button', el => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 }));
    });
    await page.waitForSelector('#tab-context-menu');
    await page.$$eval('#tab-context-menu .context-menu-item', items =>
        items.find(item => item.textContent.startsWith('Theme Color')).click()
    );
    await page.waitForSelector('#spaceColorPopover', { visible: true });
    if (pick) await page.click('#spaceColorPopover .custom-color-swatch');
    // Placement runs on the next frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return page.evaluate(() => {
        const r = document.getElementById('spaceColorPopover').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
    });
}

const closePopover = () => page.evaluate(() => document.getElementById('spaceColorPopover')?.remove());

test.each([700, 260, 200])('the Theme Color popover stays inside a %ipx panel', async width => {
    const box = await openThemeColor(width);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.width);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    await closePopover();
});

test('the Theme Color popover stays inside a narrow panel with the custom colour picker open', async () => {
    const box = await openThemeColor(260, true);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.width);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    await closePopover();
});
