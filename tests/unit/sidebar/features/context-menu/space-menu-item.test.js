import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillSpaceMenuItem } from '../../../../../src/sidebar/features/context-menu/space-menu-item.js';

// Just enough of a DOM element for the entry's content.
function fakeElement(tag = 'div') {
    return {
        tag,
        className: '',
        attributes: {},
        children: [],
        textContent: '',
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        replaceChildren(...nodes) {
            this.children = nodes;
        }
    };
}
const doc = { createElement: fakeElement };
const drawIcon = (element, icon) => {
    element.textContent = `drawn:${icon}`;
};

test('a space without an icon is just its name', () => {
    const item = fakeElement();
    fillSpaceMenuItem(item, 'Work', null, drawIcon, doc);
    assert.equal(item.textContent, 'Work');
    assert.deepEqual(item.children, []);
});

test('a space with an icon shows it before the name, drawn by the shared icon helper', () => {
    const item = fakeElement();
    fillSpaceMenuItem(item, 'Reading', '🎵', drawIcon, doc);
    const [icon, label] = item.children;
    assert.equal(icon.className, 'context-menu-space-icon');
    assert.equal(icon.textContent, 'drawn:🎵');
    assert.equal(label.textContent, 'Reading');
});

test('the icon is hidden from assistive technology so the name stays the entry name', () => {
    const item = fakeElement();
    fillSpaceMenuItem(item, 'Reading', 'symbol:book', drawIcon, doc);
    assert.equal(item.children[0].attributes['aria-hidden'], 'true');
    assert.equal(item.children[1].attributes['aria-hidden'], undefined);
});
