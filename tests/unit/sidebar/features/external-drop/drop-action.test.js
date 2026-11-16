import test from 'node:test';
import assert from 'node:assert/strict';
import { dragKind, dropAction, SEARCH_URL } from '../../../../../src/sidebar/features/external-drop/drop-action.js';

const carrying = data => ({ types: Object.keys(data), getData: type => data[type] ?? '' });

test('dragKind reads what is carried from the type list', () => {
    assert.equal(dragKind(['text/uri-list', 'text/plain']), 'link');
    assert.equal(dragKind(['text/plain', 'text/html']), 'text');
    assert.equal(dragKind(['Files']), 'files');
    assert.equal(dragKind(['text/html']), null);
    assert.equal(dragKind([]), null);
    assert.equal(dragKind(undefined), null);
});

test('a dragged image carries its address and a file: the address wins', () => {
    assert.equal(dragKind(['text/uri-list', 'text/html', 'Files']), 'link');
});

test('a dropped link opens its address', () => {
    const drop = carrying({
        'text/uri-list': 'https://example.com/page?a=1',
        'text/plain': 'https://example.com/page'
    });
    assert.deepEqual(dropAction(drop), { url: 'https://example.com/page?a=1' });
});

test('the first address of a list is used, skipping comments', () => {
    const drop = carrying({ 'text/uri-list': '# from a page\r\nhttp://example.com/one\r\nhttp://example.com/two\r\n' });
    assert.deepEqual(dropAction(drop), { url: 'http://example.com/one' });
});

test('only web addresses open', () => {
    for (const url of ['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'data:text/html,hi', 'nope']) {
        assert.equal(dropAction(carrying({ 'text/uri-list': url, 'text/plain': url })), null, url);
    }
});

test('dropped plain text opens a web search for it', () => {
    const drop = carrying({ 'text/plain': '  best pizza & pasta?  ', 'text/html': '<b>best pizza</b>' });
    assert.deepEqual(dropAction(drop), { url: `${SEARCH_URL}best%20pizza%20%26%20pasta%3F` });
    assert.equal(SEARCH_URL, 'https://www.google.com/search?q=');
});

test('text that is a web address opens as a link', () => {
    assert.deepEqual(dropAction(carrying({ 'text/plain': ' https://example.com/a ' })), {
        url: 'https://example.com/a'
    });
    assert.deepEqual(dropAction(carrying({ 'text/plain': 'see https://example.com' })), {
        url: `${SEARCH_URL}see%20https%3A%2F%2Fexample.com`
    });
});

test('text that looks like another scheme is searched, not opened', () => {
    assert.deepEqual(dropAction(carrying({ 'text/plain': 'javascript:alert(1)' })), {
        url: `${SEARCH_URL}javascript%3Aalert(1)`
    });
});

test('files, empty text and unknown drags are ignored', () => {
    assert.equal(dropAction(carrying({ Files: '' })), null);
    assert.equal(dropAction(carrying({ 'text/plain': '   ' })), null);
    assert.equal(dropAction(carrying({ 'text/html': '<b>hi</b>' })), null);
    assert.equal(dropAction(undefined), null);
});
