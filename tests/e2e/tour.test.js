import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// The guided tour's buttons stay readable in every space colour, light and dark, and
// stepping through it never makes an area scrollable, which shows a stray scroll bar.
let browser, extensionId, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];

async function startTour(step = 0) {
    await page.evaluate(async step => {
        const { id } = await chrome.windows.getCurrent();
        await chrome.runtime.sendMessage({ type: 'sidebarTour', action: 'start', windowId: id, runId: crypto.randomUUID(), step });
    }, step);
    await page.waitForFunction(step => !document.getElementById('sidecove-tour')?.hidden
        && document.getElementById('coach-progress')?.textContent.startsWith(`${step + 1} of`)
        && !document.getElementById('coach-next').disabled, { polling: 100 }, step);
}

async function setSpaceColor(color) {
    await page.evaluate(async color => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'patch', before: spaces, after: spaces.map((s, i) => i === 0 ? { ...s, color } : s) });
    }, color);
    await page.waitForFunction(color => document.querySelector('.space.active .space-color-select')?.value === color, { polling: 100 }, color);
    await sleep(100);
}

// WCAG contrast of each tour button's text against what is actually behind it.
const buttonContrast = () => page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = css => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
    const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));
    const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const card = document.getElementById('sidecove-tour');
    const sidebar = over(rgba(getComputedStyle(document.getElementById('sidebar-container')).backgroundColor), [255, 255, 255]);
    const surface = over(rgba(getComputedStyle(card).backgroundColor), sidebar);
    const retry = document.getElementById('coach-retry');
    const wasHidden = retry.hidden;
    retry.hidden = false;
    const result = {};
    for (const id of ['coach-next', 'coach-back', 'coach-skip', 'coach-retry']) {
        const style = getComputedStyle(document.getElementById(id));
        const background = over(rgba(style.backgroundColor), surface);
        result[id] = +ratio(over(rgba(style.color), background), background).toFixed(2);
    }
    retry.hidden = wasHidden;
    return result;
});

beforeAll(async () => {
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
});

afterAll(async () => {
    await browser?.close();
});

describe.each(['light', 'dark'])('tour in %s mode', scheme => {
    beforeAll(async () => {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
        await page.bringToFront();
        // Step 2, so Back is enabled and every button can be measured.
        await startTour(1);
    });

    test.each(COLORS)('every button meets 4.5:1 in the %s space', async color => {
        await setSpaceColor(color);
        const contrast = await buttonContrast();
        for (const [id, value] of Object.entries(contrast)) expect({ id, value: value >= 4.5 }).toEqual({ id, value: true });
    });

    test('a disabled button looks clearly different from an enabled one', async () => {
        await startTour(0);
        const look = await page.evaluate(() => ({
            back: { disabled: document.getElementById('coach-back').disabled, opacity: +getComputedStyle(document.getElementById('coach-back')).opacity },
            next: { disabled: document.getElementById('coach-next').disabled, opacity: +getComputedStyle(document.getElementById('coach-next')).opacity }
        }));
        expect(look.back.disabled).toBe(true);
        expect(look.next.disabled).toBe(false);
        expect(look.next.opacity).toBe(1);
        expect(look.back.opacity).toBeLessThanOrEqual(0.5);
    });

    test.each([300, 480])('Next never makes the card or the sidebar scrollable at %ipx', async width => {
        await page.setViewport({ width, height: 800 });
        await startTour(0);
        for (let step = 0; step < 6; step++) {
            const scrollable = await page.evaluate(() => new Promise(resolve => {
                // An area shows a scroll bar when it overflows along an axis it may scroll.
                const scrolls = (el, axis) => {
                    const overflow = getComputedStyle(el)[axis === 'x' ? 'overflowX' : 'overflowY'];
                    const extra = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
                    return ['auto', 'scroll'].includes(overflow) && extra > 0;
                };
                const card = document.getElementById('sidecove-tour');
                const sidebar = document.getElementById('sidebar-container');
                const found = new Set();
                const start = performance.now();
                const tick = () => {
                    if (scrolls(card, 'x')) found.add('card x');
                    if (scrolls(sidebar, 'x')) found.add('sidebar x');
                    if (scrolls(sidebar, 'y')) found.add('sidebar y');
                    performance.now() - start < 600 ? requestAnimationFrame(tick) : resolve([...found]);
                };
                requestAnimationFrame(tick);
                document.getElementById('coach-next').click();
            }));
            expect({ step, scrollable }).toEqual({ step, scrollable: [] });
        }
        await page.setViewport({ width: 360, height: 800 });
    });
});
