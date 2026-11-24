import { createServer } from 'node:http';
import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { lowContrastText } from './helpers/contrast.js';
import { PALETTE, choiceForKey } from '../../src/sidebar/features/space-colors/space-palette.js';

// In dark mode every piece of text Sidecove shows meets WCAG AA contrast (4.5:1, or 3:1 for
// large text; placeholders count as normal text) in every space colour: the sidebar at rest,
// a folder being named, hovered and selected rows, menus, popups, the tour, and the settings
// and onboarding pages. Disabled controls and emoji are left out (see helpers/contrast.js).
// The space colours are the 11 of the colour menu and custom colours at the extremes of what
// the picker allows (issue #67). Each is checked in light mode too. Light mode has shortfalls
// of its own in the eight original colours (placeholders, hints, faded titles) that are not
// about the space colour, so there no other colour may make any text less readable than it
// already is in the worst of those eight.
let server, base, browser, extensionId, page;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const CUSTOM_EXTREMES = ['#ffffff', '#000000', '#ff0000', '#ffff00', '#00ff00', '#0000ff', '#ff00ff', '#00ffff'];
const ORIGINAL = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'];
const COLORS = [
    ...ORIGINAL,
    ...PALETTE.map(colour => colour.name).filter(n => !ORIGINAL.includes(n)),
    ...CUSTOM_EXTREMES
];
const MODES = ['dark', 'light'];
const scheme = (target, value) => target.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]);
const dark = target => scheme(target, 'dark');
const fixture = {};
// Each test walks every space colour in both modes, so it gets longer than the default 60 seconds.
const SLOW = 900000;

const activeSpace = () =>
    page.evaluate(async () => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const id = document.querySelector('.space.active')?.dataset.spaceId;
        return spaces.find(s => String(s.id) === id);
    });

async function setSpaceColor(color) {
    await page.evaluate(async choice => {
        const id = document.querySelector('.space.active').dataset.spaceId;
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        await chrome.runtime.sendMessage({
            type: 'spaceStore',
            action: 'patch',
            before: spaces,
            after: spaces.map(s => (String(s.id) === id ? { ...s, ...choice } : s))
        });
    }, choiceForKey(color));
    await page.waitForFunction(
        color => document.querySelector('.space.active .space-color-select')?.value === color,
        { polling: 100 },
        color
    );
    await sleep(150);
}

async function openTab(path, spaceId) {
    const id = await page.evaluate(
        async ({ url, spaceId }) => {
            const tab = await chrome.tabs.create({ url, active: false });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
            return tab.id;
        },
        { url: `${base}/${path}`, spaceId }
    );
    await page.waitForSelector(`.space.active .tab[data-tab-id="${id}"]`);
    return id;
}

async function openContextMenu(selector) {
    await page.$eval(selector, el => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 8 }));
    });
    await page.waitForSelector('.context-menu', { visible: true });
}

async function closeMenus() {
    await page.keyboard.press('Escape');
    await page.mouse.click(350, 640);
    await page.evaluate(() => document.querySelectorAll('.context-menu').forEach(menu => menu.remove()));
    await sleep(100);
}

// In light mode a shortfall counts when it is worse than the same text in the worst of the
// original eight colours, or that text falls short in none of them.
const lightRegressions = shortfalls => {
    // A colour without a stylesheet variable adds a class to the panel; the text is the same.
    const key = s => JSON.stringify([s.open, s.step, s.where.replaceAll('.space-shade', ''), s.kind, s.content]);
    const worstToday = new Map();
    for (const s of shortfalls.filter(s => ORIGINAL.includes(s.color)))
        worstToday.set(key(s), Math.min(worstToday.get(key(s)) ?? Infinity, s.ratio));
    return shortfalls.filter(s => !ORIGINAL.includes(s.color) && s.ratio < (worstToday.get(key(s)) ?? s.needed) - 0.05);
};

// Collects every shortfall in every colour and mode, so a failure lists them all at once.
async function auditEachColor(run) {
    const found = [];
    for (const mode of MODES) {
        await scheme(page, mode);
        const inMode = [];
        for (const color of COLORS) {
            await setSpaceColor(color);
            for (const shortfall of await run(color)) inMode.push({ mode, color, ...shortfall });
        }
        found.push(...(mode === 'light' ? lightRegressions(inMode) : inMode));
    }
    await dark(page);
    return found;
}

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>${req.url.slice(1) || 'root'} page</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    ({ browser, extensionId } = await launchBrowserWithExtension());
    page = await openSidebar(browser, extensionId);
    await page.setViewport({ width: 360, height: 800 });
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    await dark(page);
    // Colours are read as they settle, not part way through a hover or theme transition, so
    // two colours can be compared.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });

    // A second space, so the switcher has an inactive chip.
    const first = await activeSpace();
    // Created with the New Space form. On a busy machine a click can land before the form is
    // ready, so it is clicked again until the store has the space, never twice once it does.
    const hasWork = () =>
        page.evaluate(async () =>
            (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces.some(
                s => s.name === 'Work'
            )
        );
    for (let attempt = 0; attempt < 20 && !(await hasWork()); attempt++) {
        await page.$eval('#addSpaceInputContainer', form => {
            if (!form.classList.contains('visible')) document.getElementById('addSpaceBtn').click();
        });
        await page.$eval('#newSpaceName', input => {
            input.value = 'Work';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.$eval('#createSpaceBtn', button => button.click());
        await sleep(1000);
    }
    await page.waitForFunction(
        () => [...document.querySelectorAll('#spaceSwitcher button')].some(b => b.textContent.includes('Work')),
        { polling: 100, timeout: 60000 }
    );
    // Back to the first space; the chip can miss a click while the switcher redraws.
    await page.waitForFunction(
        name => {
            const space = document.querySelector('.space.active .space-name');
            if (space?.value === name) return true;
            [...document.querySelectorAll('#spaceSwitcher button')].find(b => b.textContent.includes(name))?.click();
            return false;
        },
        { polling: 300, timeout: 60000 },
        first.name
    );

    // Open tabs, a closed favourite, and a named folder holding a favourite.
    fixture.tabs = [
        await openTab('alpha', first.id),
        await openTab('beta', first.id),
        await openTab('gamma', first.id)
    ];
    fixture.folderId = await page.evaluate(
        async ({ parentId, url }) => {
            await chrome.bookmarks.create({ parentId, title: 'Closed favourite', url: `${url}/closed` });
            const folder = await chrome.bookmarks.create({ parentId, title: 'Reading' });
            await chrome.bookmarks.create({ parentId: folder.id, title: 'Inside the folder', url: `${url}/inside` });
            return folder.id;
        },
        { parentId: first.bookmarkFolderId, url: base }
    );
    await page.waitForSelector(`.space.active .folder[data-bookmark-id="${fixture.folderId}"]`);
    await page.evaluate(
        async ({ spaceId, url }) =>
            chrome.storage.local.set({
                archivedTabs: [{ url: `${url}/archived`, name: 'An archived tab', spaceId, archivedAt: Date.now() }]
            }),
        { spaceId: first.id, url: base }
    );
}, SLOW);

afterAll(async () => {
    await browser?.close();
    server?.close();
}, SLOW);

beforeEach(async () => {
    await page.bringToFront();
    await dark(page);
}, SLOW);

test(
    'the sidebar at rest is readable in every space colour',
    async () => {
        await page.mouse.move(350, 795);
        expect(await auditEachColor(() => lowContrastText(page))).toEqual([]);
    },
    SLOW
);

test(
    "a new folder's name box and its Untitled placeholder are readable, focused and unfocused",
    async () => {
        const found = await auditEachColor(async () => {
            const before = await page.$$eval('.space.active .folder', els => els.map(el => el.dataset.bookmarkId));
            await page.$eval('.space.active .new-folder-btn', el => el.click());
            await page.waitForFunction(() => document.activeElement?.classList.contains('folder-name'), {
                polling: 100
            });
            const header = '.space.active .folder-header:has(.folder-name:focus)';
            const shortfalls = await lowContrastText(page, [header]);
            await page.keyboard.type('Plans');
            shortfalls.push(...(await lowContrastText(page, [header])));
            // The pointer resting on the folder while it is named adds the hover shade.
            await page.hover(header);
            for (let i = 0; i < 'Plans'.length; i++) await page.keyboard.press('Backspace');
            shortfalls.push(...(await lowContrastText(page, [header])));
            await page.keyboard.type('Plans');
            shortfalls.push(...(await lowContrastText(page, [header])));
            await page.keyboard.press('Escape');
            await sleep(100);
            await page.evaluate(async before => {
                for (const el of document.querySelectorAll('.space.active .folder'))
                    if (el.dataset.bookmarkId && !before.includes(el.dataset.bookmarkId))
                        await chrome.bookmarks.removeTree(el.dataset.bookmarkId);
            }, before);
            return shortfalls;
        });
        // Unfocused: the name box as a rename leaves it, without the focus style.
        found.push(
            ...(await auditEachColor(async () => {
                const header = `.space.active .folder[data-bookmark-id="${fixture.folderId}"] > .folder-header`;
                await page.$eval(header, el => {
                    el.querySelector('.folder-title').style.display = 'none';
                    const input = el.querySelector('.folder-name');
                    input.style.display = 'inline-block';
                    input.value = '';
                });
                const shortfalls = await lowContrastText(page, [header]);
                await page.$eval(header, el => {
                    el.querySelector('.folder-name').value = 'Reading';
                });
                shortfalls.push(...(await lowContrastText(page, [header])));
                await page.$eval(header, el => {
                    el.querySelector('.folder-title').style.display = '';
                    el.querySelector('.folder-name').style.display = '';
                });
                return shortfalls;
            }))
        );
        expect(found).toEqual([]);
    },
    SLOW
);

test(
    'hovered rows and buttons are readable in every space colour',
    async () => {
        const targets = [
            `.space.active .tab[data-tab-id="${fixture.tabs[0]}"]`,
            `.space.active .folder[data-bookmark-id="${fixture.folderId}"] > .folder-header`,
            '.space.active .tab.bookmark-only',
            '.space.active .new-tab-btn',
            '.space.active .clean-tabs-btn',
            '#spaceSwitcher button:not(.active)',
            '#addSpaceBtn'
        ];
        const found = await auditEachColor(async () => {
            const shortfalls = [];
            for (const target of targets) {
                if (!(await page.$(target))) throw new Error(`Nothing to hover at ${target}`);
                await page.hover(target);
                await sleep(150);
                shortfalls.push(...(await lowContrastText(page, [target])));
            }
            await page.mouse.move(350, 795);
            return shortfalls;
        });
        expect(found).toEqual([]);
    },
    SLOW
);

test(
    'the active tab, hovered and being renamed, is readable in every space colour',
    async () => {
        // The active tab's row is the light one. Here the sidebar is itself the active tab, and
        // making another tab active would hide it, so the row takes the class the sidebar gives it.
        const row = `.space.active .tab[data-tab-id="${fixture.tabs[1]}"]`;
        const found = await auditEachColor(async () => {
            await page.$eval(row, el => el.classList.add('active'));
            await page.hover(row);
            const shortfalls = await lowContrastText(page, [row]);
            await page.$eval(`${row} .tab-details`, el =>
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            );
            await page.waitForFunction(() => document.activeElement?.classList.contains('tab-title-input'), {
                polling: 100
            });
            shortfalls.push(...(await lowContrastText(page, [row])));
            await page.keyboard.press('Escape');
            await page.$eval(row, el => el.classList.remove('active'));
            await page.mouse.move(350, 795);
            return shortfalls;
        });
        expect(found).toEqual([]);
    },
    SLOW
);

test(
    'selected tabs are readable in every space colour',
    async () => {
        const found = await auditEachColor(async () => {
            for (const id of fixture.tabs.slice(0, 2))
                await page.$eval(`.space.active .tab[data-tab-id="${id}"]`, el =>
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true }))
                );
            await page.waitForSelector('.space.active .tab.selected');
            const shortfalls = await lowContrastText(page, ['.space.active .tab.selected']);
            await page.keyboard.press('Escape');
            await page.mouse.click(350, 640);
            await page.bringToFront();
            return shortfalls;
        });
        expect(found).toEqual([]);
    },
    SLOW
);

test(
    'menus, popups and forms are readable in every space colour',
    async () => {
        const found = await auditEachColor(async () => {
            const shortfalls = [];
            const audit = async (label, roots) => {
                for (const s of await lowContrastText(page, roots)) shortfalls.push({ open: label, ...s });
            };

            await openContextMenu(`.space.active .tab[data-tab-id="${fixture.tabs[0]}"]`);
            await page.hover('.context-menu .context-menu-item');
            await audit('tab menu', ['.context-menu']);
            const submenu = await page.$('.context-menu .context-menu-item.with-submenu');
            if (submenu) {
                await submenu.hover();
                await sleep(200);
                await audit('tab submenu', ['.context-menu']);
            }
            await closeMenus();

            await openContextMenu(`.space.active .folder[data-bookmark-id="${fixture.folderId}"] > .folder-header`);
            await audit('folder menu', ['.context-menu']);
            await closeMenus();

            // The space options open while the pointer is over them.
            await page.hover('.space.active .space-options');
            await page.waitForSelector('.space.active .space-options-dropdown', { visible: true });
            await page.hover('.space.active .space-options-dropdown .new-folder-btn');
            await audit('space options', ['.space.active .space-options-dropdown']);
            await page.mouse.move(350, 795);

            await page.$eval('.space.active .space-icon-button', el => el.click());
            await page.waitForSelector('.space-icon-picker', { visible: true });
            await audit('icon picker', ['.space-icon-picker']);
            await closeMenus();

            await page.$eval('.space.active #archive-button', el => el.click());
            await page.waitForSelector('.space.active .archived-tabs-popup .archived-item');
            await audit('archived tabs', ['.space.active .archived-tabs-popup']);
            await page.hover('.space.active .archived-tabs-popup .archived-item');
            await audit('archived tab, hovered', ['.space.active .archived-tabs-popup .archived-item']);
            await page.$eval('.space.active #archive-button', el => el.click());

            await page.$eval('#addSpaceBtn', el => el.click());
            await page.waitForSelector('#addSpaceInputContainer.visible');
            await audit('new space form, empty', ['#addSpaceInputContainer']);
            await page.focus('#newSpaceName');
            await page.keyboard.type('Ideas');
            await audit('new space form, typed', ['#addSpaceInputContainer']);
            await page.$eval('#newSpaceName', input => {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.$eval('#addSpaceBtn', el => el.click());

            await page.focus('#tabSearchInput');
            await audit('search, empty', ['#tabSearch']);
            await page.keyboard.type('a');
            await page.waitForSelector('#tabSearchResults .search-result');
            await audit('search results', ['#tabSearch', '#tabSearchResults']);
            await page.keyboard.press('ArrowDown');
            await audit('search results, highlighted', ['#tabSearchResults']);
            await page.$eval('#tabSearchInput', input => {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.blur();
            });
            return shortfalls;
        });
        expect(found).toEqual([]);
    },
    SLOW
);

test(
    'the space name, a tab being renamed and the toasts are readable in every space colour',
    async () => {
        const found = await auditEachColor(async () => {
            const shortfalls = [];
            const audit = async (label, roots) => {
                for (const s of await lowContrastText(page, roots)) shortfalls.push({ open: label, ...s });
            };

            // An empty space name shows its placeholder; the name is put back without saving.
            const name = await page.$eval('.space.active .space-name', input => {
                const value = input.value;
                input.value = '';
                return value;
            });
            await audit('space name placeholder', ['.space.active .space-name-container']);
            await page.$eval('.space.active .space-name', (input, value) => (input.value = value), name);

            // Renaming a tab: double-click its title, as people do; Escape leaves the name as it was.
            const row = `.space.active .tab[data-tab-id="${fixture.tabs[2]}"]`;
            await page.hover(row);
            await page.$eval(`${row} .tab-details`, el =>
                el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            );
            await page.waitForFunction(() => document.activeElement?.classList.contains('tab-title-input'));
            await audit('tab rename', [row]);
            await page.keyboard.press('Escape');

            // The copy itself needs the clipboard; this shows the same toast it does.
            await page.$eval('#urlCopyToast', toast => toast.classList.add('show'));
            await audit('copy toast', ['#urlCopyToast']);
            await page.$eval('#urlCopyToast', toast => toast.classList.remove('show'));
            await page.mouse.move(350, 795);
            return shortfalls;
        });
        expect(found).toEqual([]);
    },
    SLOW
);

test(
    'every step of the tour is readable in every space colour',
    async () => {
        const found = await auditEachColor(async () => {
            const shortfalls = [];
            for (let step = 0; step < 8; step++) {
                await page.evaluate(async step => {
                    const { id } = await chrome.windows.getCurrent();
                    await chrome.runtime.sendMessage({
                        type: 'sidebarTour',
                        action: 'start',
                        windowId: id,
                        runId: crypto.randomUUID(),
                        step
                    });
                }, step);
                const shown = await page
                    .waitForFunction(
                        step =>
                            !document.getElementById('sidecove-tour')?.hidden &&
                            document.getElementById('coach-progress')?.textContent.startsWith(`${step + 1} of`),
                        { polling: 100, timeout: 3000 },
                        step
                    )
                    .then(() => true)
                    .catch(() => false);
                if (!shown) break;
                for (const s of await lowContrastText(page, ['#sidecove-tour']))
                    shortfalls.push({ step: step + 1, ...s });
            }
            await page.evaluate(async () => {
                const { id } = await chrome.windows.getCurrent();
                await chrome.runtime.sendMessage({ type: 'sidebarTour', action: 'stop', windowId: id });
            });
            await page.evaluate(() => document.getElementById('coach-skip')?.click());
            await sleep(150);
            return shortfalls;
        });
        expect(found).toEqual([]);
    },
    SLOW
);

test.each(['options.html', 'installation-onboarding.html', 'tutorial-practice.html'])(
    '%s is readable with the system in dark mode',
    async file => {
        const other = await browser.newPage();
        try {
            await dark(other);
            await other.setViewport({ width: 1100, height: 900 });
            await other.goto(`chrome-extension://${extensionId}/${file}`, { waitUntil: 'networkidle0' });
            await sleep(500);
            expect(await lowContrastText(other)).toEqual([]);
        } finally {
            await other.close();
        }
    },
    SLOW
);
