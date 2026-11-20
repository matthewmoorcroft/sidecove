import test from 'node:test';
import assert from 'node:assert/strict';
import { createSplitDrop } from '../../../../../src/sidebar/features/split-view/split-drop.js';

// Just enough of a tab row and a list for the drop controller.
function list(tabType = 'temporary') {
    const rows = [];
    const container = { dataset: { tabType }, contains: el => rows.includes(el) };
    const add = (dataset, top) => {
        const classes = new Set(['tab']);
        const el = {
            dataset,
            parentElement: container,
            isConnected: true,
            classList: {
                add: c => classes.add(c),
                remove: c => classes.delete(c),
                contains: c => classes.has(c)
            },
            closest: selector => (selector === '.tab' ? el : null),
            getBoundingClientRect: () => ({ top, height: 40 })
        };
        rows.push(el);
        return el;
    };
    return { container, add };
}

const over = (target, y) => ({ target, clientY: y });
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup({ canPair = async () => true, supported = true } = {}) {
    let time = 0;
    const asked = [];
    const splitView = {
        supported,
        canPair: async (a, b) => {
            asked.push([a, b]);
            return canPair(a, b);
        }
    };
    const drop = createSplitDrop({ splitView, now: () => time, dwellMs: 500 });
    return { drop, asked, tick: ms => (time += ms) };
}

test('holding a tab over the middle of another marks it and the drop splits the pair', async () => {
    const { container, add } = list();
    const dragged = add({ tabId: '1' }, 0);
    const target = add({ tabId: '2' }, 40);
    const { drop, asked, tick } = setup();

    assert.equal(drop.over(over(target, 60), dragged, container, 1), null);
    await settle();
    tick(500);
    assert.equal(drop.over(over(target, 60), dragged, container, 1), target);
    assert.equal(target.classList.contains('split-target'), true);
    // The target stays where it is; the dragged tab joins it.
    assert.deepEqual(asked, [[2, 1]]);
    assert.deepEqual(drop.take(container), { targetId: 2, draggedId: 1 });
    assert.equal(target.classList.contains('split-target'), false);
    assert.equal(drop.take(container), null);
});

test('a quick pass over the middle of a row still reorders', async () => {
    const { container, add } = list();
    const dragged = add({ tabId: '1' }, 0);
    const target = add({ tabId: '2' }, 40);
    const { drop, tick } = setup();
    drop.over(over(target, 60), dragged, container, 1);
    await settle();
    tick(200);
    assert.equal(drop.over(over(target, 60), dragged, container, 1), null);
    assert.equal(drop.take(container), null);
});

test('the top and bottom of a row never offer a split, however long the hold', async () => {
    const { container, add } = list();
    const dragged = add({ tabId: '1' }, 0);
    const target = add({ tabId: '2' }, 40);
    const { drop, tick } = setup();
    for (const y of [42, 78]) {
        drop.over(over(target, y), dragged, container, 1);
        await settle();
        tick(1000);
        assert.equal(drop.over(over(target, y), dragged, container, 1), null);
    }
});

test('no split is offered when Chrome would refuse the pair', async () => {
    const { container, add } = list();
    const dragged = add({ tabId: '1' }, 0);
    const target = add({ tabId: '2' }, 40);
    const { drop, tick } = setup({ canPair: async () => false });
    drop.over(over(target, 60), dragged, container, 1);
    await settle();
    tick(600);
    assert.equal(drop.over(over(target, 60), dragged, container, 1), null);
});

test('no split is offered until Chrome has answered', async () => {
    const { container, add } = list();
    const dragged = add({ tabId: '1' }, 0);
    const target = add({ tabId: '2' }, 40);
    let answer;
    const { drop, tick } = setup({ canPair: () => new Promise(resolve => (answer = resolve)) });
    drop.over(over(target, 60), dragged, container, 1);
    tick(600);
    assert.equal(drop.over(over(target, 60), dragged, container, 1), null);
    answer(true);
    await settle();
    assert.equal(drop.over(over(target, 60), dragged, container, 1), target);
});

test('favorites, selections, split tabs and an older Chrome are never offered a split', async () => {
    const cases = [
        { name: 'favorites list', tabType: 'pinned' },
        { name: 'a selection', carried: 2 },
        { name: 'dragged half of a pair', dragged: { tabId: '1', splitViewId: '5' } },
        { name: 'target half of a pair', target: { tabId: '2', splitViewId: '5' } },
        { name: 'a favorite that is not open', target: { bookmarkId: 'b1' } },
        { name: 'Chrome without split view', supported: false }
    ];
    for (const c of cases) {
        const { container, add } = list(c.tabType);
        const dragged = add(c.dragged ?? { tabId: '1' }, 0);
        const target = add(c.target ?? { tabId: '2' }, 40);
        const { drop, asked, tick } = setup({ supported: c.supported ?? true });
        drop.over(over(target, 60), dragged, container, c.carried ?? 1);
        await settle();
        tick(600);
        assert.equal(drop.over(over(target, 60), dragged, container, c.carried ?? 1), null, c.name);
        assert.deepEqual(asked, [], c.name);
    }
});

test('a tab dragged in from the favorites list is not split', async () => {
    const { container, add } = list();
    const target = add({ tabId: '2' }, 40);
    const favorite = { ...target, dataset: { tabId: '1', bookmarkId: 'b1' }, parentElement: {} };
    const { drop, tick } = setup();
    drop.over(over(target, 60), favorite, container, 1);
    await settle();
    tick(600);
    assert.equal(drop.over(over(target, 60), favorite, container, 1), null);
});

test('leaving the list clears the mark, and a drop elsewhere splits nothing', async () => {
    const { container, add } = list();
    const dragged = add({ tabId: '1' }, 0);
    const target = add({ tabId: '2' }, 40);
    const { drop, tick } = setup();
    drop.over(over(target, 60), dragged, container, 1);
    await settle();
    tick(500);
    drop.over(over(target, 60), dragged, container, 1);
    assert.equal(drop.take(list().container), null);
    assert.equal(target.classList.contains('split-target'), false);

    drop.over(over(target, 60), dragged, container, 1);
    tick(500);
    drop.over(over(target, 60), dragged, container, 1);
    drop.clear();
    assert.equal(target.classList.contains('split-target'), false);
    assert.equal(drop.take(container), null);
});
