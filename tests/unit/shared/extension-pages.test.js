import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isExtensionPage, isOwnPageUrl, isSidePanelPage } from '../../../src/shared/extension-pages.js';

const base = 'chrome-extension://sidecove/';
beforeEach(() => {
    globalThis.chrome = { runtime: { getURL: path => base + path } };
});
afterEach(() => {
    delete globalThis.chrome;
});

test('a page matches by its file, with an optional query or hash, and nothing longer', () => {
    assert.equal(isExtensionPage(`${base}options.html`, 'options.html'), true);
    assert.equal(isExtensionPage(`${base}options.html?tab=2`, 'options.html'), true);
    assert.equal(isExtensionPage(`${base}options.html#colors`, 'options.html'), true);
    assert.equal(isExtensionPage(`${base}options.html.evil`, 'options.html'), false);
    assert.equal(isExtensionPage('https://example.com/options.html', 'options.html'), false);
    assert.equal(isExtensionPage(undefined, 'options.html'), false);
});

test('own pages are the settings page and the setup guide only', () => {
    assert.equal(isOwnPageUrl(`${base}options.html`), true);
    assert.equal(isOwnPageUrl(`${base}installation-onboarding.html`), true);
    assert.equal(isOwnPageUrl(`${base}sidebar.html`), false);
    assert.equal(isOwnPageUrl(`${base}tutorial-practice.html#run=1`), false);
    assert.equal(isSidePanelPage(`${base}sidebar.html`), true);
    assert.equal(isSidePanelPage(`${base}options.html`), false);
});

test('without a chrome runtime nothing matches', () => {
    delete globalThis.chrome;
    assert.equal(isOwnPageUrl(`${base}options.html`), false);
    assert.equal(isSidePanelPage(`${base}sidebar.html`), false);
});
