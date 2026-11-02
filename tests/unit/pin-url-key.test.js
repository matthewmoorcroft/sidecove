import test from 'node:test';
import assert from 'node:assert/strict';
import { Utils, refreshPinMatchFullQueryHosts } from '../../utils.js';

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
