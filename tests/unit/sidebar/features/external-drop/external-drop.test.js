import test from 'node:test';
import assert from 'node:assert/strict';
import { wireExternalDrop } from '../../../../../src/sidebar/features/external-drop/external-drop.js';

function setup() {
    const doc = new EventTarget();
    const root = Object.assign(new EventTarget(), {
        dataset: {},
        classList: {
            on: false,
            toggle(name, on) {
                this.on = on;
            }
        },
        contains: node => node === root.inside
    });
    root.inside = { id: 'inside' };
    const created = [];
    wireExternalDrop({
        root,
        doc,
        chromeApi: { tabs: { create: props => created.push(props) } },
        getWindowId: () => 7
    });

    // The root's capture listeners run before any child's, so firing on the root stands in for the whole panel.
    const fire = (type, { data = {}, target = {}, relatedTarget = null } = {}) => {
        const event = new Event(type, { cancelable: true });
        // Events have read-only target; the handlers read plain properties, so shadow them.
        for (const [key, value] of Object.entries({
            target,
            relatedTarget,
            dataTransfer: { types: Object.keys(data), getData: t => data[t] ?? '', dropEffect: 'move' }
        }))
            Object.defineProperty(event, key, { value });
        let stopped = false;
        event.stopPropagation = () => (stopped = true);
        const onDocument = ['dragstart', 'dragend', 'pointerdown'].includes(type);
        (onDocument ? doc : root).dispatchEvent(event);
        return { event, stopped };
    };
    return { root, doc, created, fire };
}

const link = { 'text/uri-list': 'https://example.com/a', 'text/plain': 'https://example.com/a' };
const text = { 'text/plain': 'hello world' };

test('dragging a link over the panel shows the drop target and allows a copy', () => {
    const { root, fire } = setup();
    const { event, stopped } = fire('dragover', { data: link });
    assert.equal(event.defaultPrevented, true);
    assert.equal(stopped, true);
    assert.equal(event.dataTransfer.dropEffect, 'copy');
    assert.equal(root.classList.on, true);
    assert.equal(root.dataset.externalDrop, 'link');
    fire('dragover', { data: text });
    assert.equal(root.dataset.externalDrop, 'text');
});

test('leaving the panel clears the highlight; moving within it keeps it', () => {
    const { root, fire } = setup();
    fire('dragover', { data: link });
    fire('dragleave', { relatedTarget: root.inside });
    assert.equal(root.classList.on, true);
    fire('dragleave', { relatedTarget: null });
    assert.equal(root.classList.on, false);
    assert.equal('externalDrop' in root.dataset, false);
});

test('dropping a link opens it in a new tab of this window', () => {
    const { root, created, fire } = setup();
    fire('dragover', { data: link });
    const { event, stopped } = fire('drop', { data: link });
    assert.deepEqual(created, [{ url: 'https://example.com/a', active: true, windowId: 7 }]);
    assert.equal(event.defaultPrevented, true);
    assert.equal(stopped, true);
    assert.equal(root.classList.on, false);
});

test('dropping text opens a search', () => {
    const { created, fire } = setup();
    fire('drop', { data: text });
    assert.deepEqual(created, [{ url: 'https://www.google.com/search?q=hello%20world', active: true, windowId: 7 }]);
});

test('a file is refused without opening anything or showing the target', () => {
    const { root, created, fire } = setup();
    const over = fire('dragover', { data: { Files: '' } });
    assert.equal(over.event.defaultPrevented, true);
    assert.equal(over.event.dataTransfer.dropEffect, 'none');
    assert.equal(root.classList.on, false);
    const drop = fire('drop', { data: { Files: '' } });
    assert.equal(drop.event.defaultPrevented, true);
    assert.deepEqual(created, []);
});

test('a drag that began in the sidebar is left to the sidebar', () => {
    const { root, created, fire } = setup();
    fire('dragstart');
    const over = fire('dragover', { data: text });
    assert.equal(over.event.defaultPrevented, false);
    assert.equal(over.stopped, false);
    assert.equal(root.classList.on, false);
    const drop = fire('drop', { data: text });
    assert.equal(drop.stopped, false);
    assert.deepEqual(created, []);

    fire('dragend');
    fire('drop', { data: text });
    assert.equal(created.length, 1);
});

test('a click after a drag that never ended starts afresh', () => {
    const { created, fire } = setup();
    fire('dragstart');
    fire('pointerdown');
    fire('drop', { data: text });
    assert.equal(created.length, 1);
});

test('text fields keep the text dropped on them', () => {
    const { created, fire } = setup();
    const input = { closest: selector => (selector.includes('input') ? input : null) };
    const over = fire('dragover', { data: text, target: input });
    const drop = fire('drop', { data: text, target: input });
    assert.equal(over.event.defaultPrevented, false);
    assert.equal(drop.event.defaultPrevented, false);
    assert.deepEqual(created, []);
});

test('drops of anything else are left alone', () => {
    const { created, fire } = setup();
    const drop = fire('drop', { data: { 'text/html': '<b>x</b>' } });
    assert.equal(drop.event.defaultPrevented, false);
    assert.deepEqual(created, []);
});
