import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARC_SYMBOL_TARGETS, sidecoveSymbolFor } from '../../../../../src/sidebar/features/arc-import/arc-symbols.js';
import { SPACE_SYMBOLS } from '../../../../../src/sidebar/space-icons.js';

test('every Arc symbol maps to a symbol Sidecove has', () => {
    const names = new Set(SPACE_SYMBOLS.map(symbol => symbol.name));
    assert.deepEqual(
        ARC_SYMBOL_TARGETS.filter(name => !names.has(name)),
        []
    );
});

test('a variant finds its base symbol, and unknown names find none', () => {
    assert.equal(sidecoveSymbolFor('star.fill'), 'star');
    assert.equal(sidecoveSymbolFor('person.2.fill'), 'users');
    assert.equal(sidecoveSymbolFor('Building.Columns'), 'landmark');
    assert.equal(sidecoveSymbolFor('planet'), 'orbit');
    assert.equal(sidecoveSymbolFor('nosuchsymbol'), null);
    assert.equal(sidecoveSymbolFor(''), null);
    assert.equal(sidecoveSymbolFor(undefined), null);
    assert.equal(sidecoveSymbolFor('constructor'), null);
});
