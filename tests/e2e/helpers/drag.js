/**
 * Drag and drop is dispatched as DOM events so it works while Chrome focuses other tabs.
 * `handle` is an optional selector inside the source to start the drag from.
 */
export async function dragOnto(page, sourceSelector, targetSelector, { handle = null } = {}) {
    await page.evaluate(
        ({ sourceSelector, targetSelector, handle }) => {
            const source = document.querySelector(sourceSelector);
            const grip = handle ? source.querySelector(handle) : source;
            const target = document.querySelector(targetSelector);
            if (!source || !target) throw new Error(`missing ${!source ? sourceSelector : targetSelector}`);
            const dataTransfer = new DataTransfer();
            const r = target.getBoundingClientRect();
            const point = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
            grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
            target.dispatchEvent(
                new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point })
            );
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point }));
            grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        },
        { sourceSelector, targetSelector, handle }
    );
}

/**
 * Starts dragging `sourceSelector` and holds it over `targetSelector` at `at` (a fraction of the
 * target's height) for `holdMs`, leaving the drag in progress. Finish it with `finishHeldDrag`.
 */
export async function holdDragOver(page, sourceSelector, targetSelector, { at = 0.5, holdMs = 700 } = {}) {
    const hover = () =>
        page.evaluate(
            ({ targetSelector, at }) => {
                const { dataTransfer } = window.__heldDrag;
                const target = document.querySelector(targetSelector);
                const r = target.getBoundingClientRect();
                const point = { clientX: r.left + r.width / 2, clientY: r.top + r.height * at };
                target.dispatchEvent(
                    new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point })
                );
            },
            { targetSelector, at }
        );
    await page.evaluate(
        ({ sourceSelector, targetSelector }) => {
            const source = document.querySelector(sourceSelector);
            if (!source || !document.querySelector(targetSelector))
                throw new Error(`missing ${!source ? sourceSelector : targetSelector}`);
            const dataTransfer = new DataTransfer();
            window.__heldDrag = { source, targetSelector, dataTransfer };
            source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        },
        { sourceSelector, targetSelector }
    );
    await hover();
    // The sidebar asks Chrome about the pair while the hold runs; hover again as a pointer would.
    const step = 100;
    for (let waited = 0; waited < holdMs; waited += step) {
        await new Promise(resolve => setTimeout(resolve, step));
        await hover();
    }
}

// Drops the drag `holdDragOver` started where it is held, or cancels it with `drop: false`.
export async function finishHeldDrag(page, { drop = true, at = 0.5 } = {}) {
    await page.evaluate(
        ({ drop, at }) => {
            const { source, targetSelector, dataTransfer } = window.__heldDrag;
            const target = document.querySelector(targetSelector);
            if (drop && target) {
                const r = target.getBoundingClientRect();
                const point = { clientX: r.left + r.width / 2, clientY: r.top + r.height * at };
                target.dispatchEvent(
                    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point })
                );
            }
            source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
            delete window.__heldDrag;
        },
        { drop, at }
    );
}
