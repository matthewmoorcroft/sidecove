/**
 * Test Utilities
 * Common utilities and helpers for E2E tests
 */

/**
 * Create a delay
 * @param {number} ms - Milliseconds to wait
 */
export async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait until the newest open tab (the page a test has just opened) belongs to a space in Sidecove's
 * store, which is what a reopened side panel draws from. Gives up quietly after the timeout, as the
 * old fixed pause did, so the test's own checks report what is missing.
 * @param {import('puppeteer-core').Page} page - A Sidecove extension page
 * @param {number} timeout - Milliseconds to wait at most
 */
export async function waitForNewestTabInSpace(page, timeout = 10000) {
    await page
        .waitForFunction(
            async () => {
                const tabs = await chrome.tabs.query({});
                const newest = tabs.reduce((a, b) => (b.id > a.id ? b : a));
                const { spaces = [] } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                return spaces.some(space => [...space.temporaryTabs, ...space.pinnedTabs].includes(newest.id));
            },
            { polling: 50, timeout }
        )
        .catch(() => {});
}

/**
 * Wait until every tab Sidecove lists in a space is still open in Chrome: the end of the store catching
 * up with tabs that were just closed. Gives up quietly after the timeout so the test's own checks report.
 * @param {import('puppeteer-core').Page} page - A Sidecove extension page
 * @param {number} timeout - Milliseconds to wait at most
 */
export async function waitForStoreMatchesChrome(page, timeout = 10000) {
    await page
        .waitForFunction(
            async () => {
                const open = new Set((await chrome.tabs.query({})).map(tab => tab.id));
                const { spaces = [] } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
                return spaces.every(space => [...space.temporaryTabs, ...space.pinnedTabs].every(id => open.has(id)));
            },
            { polling: 50, timeout }
        )
        .catch(() => {});
}

/**
 * Wait until Chrome reports a tab with the given title, which is what a reopened side panel shows.
 * Gives up quietly after the timeout so the test's own checks report.
 * @param {import('puppeteer-core').Page} page - A Sidecove extension page
 * @param {string} title - The tab title to wait for
 * @param {number} timeout - Milliseconds to wait at most
 */
export async function waitForTabTitle(page, title, timeout = 10000) {
    await page
        .waitForFunction(
            async title => (await chrome.tabs.query({})).some(tab => tab.title === title),
            { polling: 50, timeout },
            title
        )
        .catch(() => {});
}

/**
 * Wait until nothing has changed in the page, its tabs, its storage or its bookmarks for `quietMs`:
 * the end of whatever a click or key press set off. Use where a test needs "the extension has finished
 * reacting" and there is no single value to wait for.
 * @param {import('puppeteer-core').Page} page - A Sidecove extension page
 * @param {number} quietMs - How long everything must stay still
 * @param {number} timeout - Milliseconds to wait at most
 */
export async function waitForQuiet(page, quietMs = 300, timeout = 10000) {
    await page.evaluate(
        (quietMs, timeout) =>
            new Promise(resolve => {
                const events = [
                    chrome.tabs.onCreated,
                    chrome.tabs.onUpdated,
                    chrome.tabs.onRemoved,
                    chrome.tabs.onMoved,
                    chrome.tabs.onAttached,
                    chrome.tabs.onDetached,
                    chrome.storage.onChanged,
                    chrome.bookmarks.onCreated,
                    chrome.bookmarks.onRemoved,
                    chrome.bookmarks.onChanged,
                    chrome.bookmarks.onMoved
                ];
                const observer = new MutationObserver(() => poke());
                let timer;
                const finish = () => {
                    events.forEach(event => event.removeListener(poke));
                    observer.disconnect();
                    clearTimeout(timer);
                    clearTimeout(cap);
                    resolve();
                };
                const poke = () => {
                    clearTimeout(timer);
                    timer = setTimeout(finish, quietMs);
                };
                const cap = setTimeout(finish, timeout);
                events.forEach(event => event.addListener(poke));
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    characterData: true
                });
                poke();
            }),
        quietMs,
        timeout
    );
}

/**
 * Generate random string
 * @param {number} length - Length of string
 * @returns {string}
 */
export function randomString(length = 10) {
    return Math.random()
        .toString(36)
        .substring(2, length + 2);
}

/**
 * Generate test tab data
 * @param {number} count - Number of tabs to generate
 * @returns {Array}
 */
export function generateTestTabs(count = 5) {
    const tabs = [];
    for (let i = 0; i < count; i++) {
        tabs.push({
            title: `Test Tab ${i + 1}`,
            url: `https://example.com/page${i + 1}`
        });
    }
    return tabs;
}

/**
 * Generate test space data
 * @param {number} count - Number of spaces to generate
 * @returns {Array}
 */
export function generateTestSpaces(count = 3) {
    const colors = ['blue', 'red', 'green', 'yellow', 'purple', 'orange'];
    const spaces = [];
    for (let i = 0; i < count; i++) {
        spaces.push({
            name: `Test Space ${i + 1}`,
            color: colors[i % colors.length]
        });
    }
    return spaces;
}

/**
 * Take screenshot on test failure
 * @param {Page} page - Puppeteer page
 * @param {string} testName - Name of the test
 */
export async function takeScreenshotOnFailure(page, testName) {
    const sanitizedName = testName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = Date.now();
    const filename = `./tests/e2e/screenshots/${sanitizedName}_${timestamp}.png`;

    try {
        await page.screenshot({ path: filename, fullPage: true });
        console.log(`📸 Screenshot saved: ${filename}`);
    } catch (error) {
        console.error('Failed to take screenshot:', error);
    }
}

/**
 * Log test step
 * @param {string} message - Log message
 */
export function logTestStep(message) {
    console.log(`  ➜ ${message}`);
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxAttempts - Maximum attempts
 * @param {number} delayMs - Initial delay in ms
 * @returns {Promise}
 */
export async function retry(fn, maxAttempts = 3, delayMs = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                const waitTime = delayMs * Math.pow(2, attempt - 1);
                console.log(`Retry attempt ${attempt}/${maxAttempts} after ${waitTime}ms...`);
                await delay(waitTime);
            }
        }
    }

    throw lastError;
}

/**
 * Assert element exists
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {string} message - Error message
 */
export async function assertElementExists(page, selector, message = '') {
    const element = await page.$(selector);
    if (!element) {
        throw new Error(message || `Element not found: ${selector}`);
    }
}

/**
 * Assert element does not exist
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {string} message - Error message
 */
export async function assertElementNotExists(page, selector, message = '') {
    const element = await page.$(selector);
    if (element) {
        throw new Error(message || `Element should not exist: ${selector}`);
    }
}

/**
 * Get element count
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @returns {Promise<number>}
 */
export async function getElementCount(page, selector) {
    return await page.evaluate(sel => {
        return document.querySelectorAll(sel).length;
    }, selector);
}

/**
 * Wait for element count
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {number} expectedCount - Expected element count
 * @param {number} timeout - Timeout in ms
 */
export async function waitForElementCount(page, selector, expectedCount, timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        const count = await getElementCount(page, selector);
        if (count === expectedCount) {
            return true;
        }
        await delay(100);
    }

    const actualCount = await getElementCount(page, selector);
    throw new Error(`Expected ${expectedCount} elements matching "${selector}", but found ${actualCount}`);
}
