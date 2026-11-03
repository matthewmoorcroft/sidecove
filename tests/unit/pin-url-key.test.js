import test from 'node:test';
import assert from 'node:assert/strict';
import { Utils, refreshPinMatchFullQueryHosts, normalizePinMatchHost } from '../../utils.js';

function mockStorage(hosts) {
    globalThis.chrome = { storage: {
        sync: { async get() { return { pinMatchFullQueryHosts: hosts }; } },
        onChanged: { addListener() {} },
    } };
    return refreshPinMatchFullQueryHosts();
}

test('pinned URL keys ignore query strings by default', async () => {
    await mockStorage([]);
    assert.equal(Utils.getPinnedUrlKey('https://example.com/read?x=1#part'), 'https://example.com/read');
    assert.equal(Utils.getPinnedUrlKey('http://localhost:6969/?focused=node-1'), 'http://localhost:6969/');
});

test('hosts in the keep-query-string list match per query string', async () => {
    await mockStorage(['localhost:6969']);
    assert.equal(Utils.getPinnedUrlKey('http://localhost:6969/?focused=node-1'), 'http://localhost:6969/?focused=node-1');
    assert.equal(Utils.getPinnedUrlKey('http://localhost:6969/?focused=node-2'), 'http://localhost:6969/?focused=node-2');
    // Other hosts keep the stock behavior.
    assert.equal(Utils.getPinnedUrlKey('https://example.com/read?x=1'), 'https://example.com/read');
});

test('hostname entries match any port', async () => {
    await mockStorage(['localhost']);
    assert.equal(Utils.getPinnedUrlKey('http://localhost:8765/?a=1'), 'http://localhost:8765/?a=1');
    assert.equal(Utils.getPinnedUrlKey('http://localhost/?a=1'), 'http://localhost/?a=1');
});

test('host entries are normalised to URL.host', () => {
    assert.equal(normalizePinMatchHost('localhost:6969'), 'localhost:6969');
    assert.equal(normalizePinMatchHost('  LocalHost:6969  '), 'localhost:6969');
    // A URL pasted from the address bar, with or without a trailing slash.
    assert.equal(normalizePinMatchHost('http://localhost:6969/'), 'localhost:6969');
    assert.equal(normalizePinMatchHost('https://example.com/some/path?x=1'), 'example.com');
    assert.equal(normalizePinMatchHost('example.com/'), 'example.com');
    // Explicit default ports are dropped, as URL.host does.
    assert.equal(normalizePinMatchHost('localhost:80'), 'localhost');
    assert.equal(normalizePinMatchHost('http://localhost:80/'), 'localhost');
    assert.equal(normalizePinMatchHost('example.com:443'), 'example.com');
    assert.equal(normalizePinMatchHost('https://example.com:443'), 'example.com');
    // Internationalised hostnames match URL.host, which is punycode.
    assert.equal(normalizePinMatchHost('bücher.example'), 'xn--bcher-kva.example');
});

test('entries that do not parse as a host are dropped', () => {
    assert.equal(normalizePinMatchHost(''), null);
    assert.equal(normalizePinMatchHost('   '), null);
    assert.equal(normalizePinMatchHost('http://'), null);
    assert.equal(normalizePinMatchHost('not a host:99999'), null);
});

test('pasted URLs, trailing slashes and default ports still match', async () => {
    await mockStorage(['http://localhost:6969/']);
    assert.equal(Utils.getPinnedUrlKey('http://localhost:6969/?focused=node-1'), 'http://localhost:6969/?focused=node-1');

    await mockStorage(['example.com/']);
    assert.equal(Utils.getPinnedUrlKey('https://example.com/read?x=1'), 'https://example.com/read?x=1');

    await mockStorage(['example.com:443']);
    assert.equal(Utils.getPinnedUrlKey('https://example.com/read?x=1'), 'https://example.com/read?x=1');
});
