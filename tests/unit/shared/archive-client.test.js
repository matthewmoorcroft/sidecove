import test from 'node:test';
import assert from 'node:assert/strict';
import { findArchivedEntry } from '../../../src/shared/archive-client.js';

test("a favorite's address opens this space's archived entry, else another space's", () => {
    const list = [
        { url: 'https://same.test/', spaceId: 'work' },
        { url: 'https://same.test/', spaceId: 'home' },
        { url: 'https://other.test/', spaceId: 'work' }
    ];
    assert.equal(findArchivedEntry(list, 'https://same.test/', 'home'), list[1]);
    assert.equal(findArchivedEntry(list, 'https://other.test/', 'home'), list[2]);
    assert.equal(findArchivedEntry(list, 'https://none.test/', 'home'), undefined);
});
