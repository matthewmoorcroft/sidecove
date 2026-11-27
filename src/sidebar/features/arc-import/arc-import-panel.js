/**
 * Import from Arc: a panel at the top of the sidebar, like the Chrome tab group import, that
 * reads Arc's sidebar file chosen with a file picker and creates new spaces from it.
 *
 * An extension cannot open files on its own, so the person picks the file. It is read here, in
 * the panel, and never sent anywhere; the service worker creates the spaces (see
 * shared/import-spaces.js).
 */
import { Logger } from '../../../shared/logger.js';
import { spaceRequest } from '../../../shared/space-client.js';
import { ROOT_FOLDER_TITLE } from '../../../shared/constants.js';
import { LocalStorage } from '../../../shared/localstorage.js';
import { earlierImports } from '../../../shared/import-spaces.js';
import { NotArcFileError, readArcSidebar } from './arc-sidebar.js';
import { arcSource, planArcImport } from './arc-import-plan.js';
import { describeArcSpace, describeImport } from './arc-import-summary.js';
import { locationSteps } from './arc-file-location.js';

// Arc's file is a few megabytes at most; this only stops a wrong pick from tying up the panel.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const NOT_ARC = "This file is not Arc's sidebar file. Choose StorableSidebar.json from Arc's folder.";

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

const NOTHING_EARLIER = { sources: new Set(), favorites: false };

// What earlier imports brought in and is still in Sidecove. Read only; the service worker checks
// again before it creates anything.
async function readEarlierImports() {
    try {
        const root = (await chrome.bookmarks.search({ title: ROOT_FOLDER_TITLE })).find(node => !node.url);
        if (!root) return NOTHING_EARLIER;
        const folders = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url);
        return earlierImports(
            await LocalStorage.getSpaceRegistry(),
            folders.map(folder => folder.id)
        );
    } catch (error) {
        Logger.warn('Could not read earlier imports:', error);
        return NOTHING_EARLIER;
    }
}

const button = (label, onClick, className = '') =>
    el('button', { type: 'button', textContent: label, className, onclick: onClick });

// Only the steps for the system in use (see arc-file-location.js).
function whereToFind(os) {
    const steps = locationSteps(os);
    const labelled = steps.length > 1;
    return el(
        'div',
        { className: 'arc-import-where' },
        steps.flatMap(step => [
            el('p', {}, [...(labelled ? [el('strong', { textContent: `${step.label}: ` })] : []), step.intro]),
            el('code', { className: 'arc-import-path', textContent: step.path }),
            ...(step.after ? [el('p', { textContent: step.after })] : [])
        ])
    );
}

/**
 * Opens the panel, or brings it into view when it is open already.
 * `adoptSpaces(spaces)` shows the store's spaces in the sidebar; `showSpace(id)` switches to one;
 * `whenSaved()` resolves once the sidebar's own pending changes are saved.
 */
export function openArcImport({ container, adoptSpaces, showSpace, whenSaved = async () => {} }) {
    const open = container.querySelector('.arc-import');
    if (open) {
        open.scrollIntoView({ block: 'nearest' });
        open.querySelector('h2')?.focus();
        return open;
    }
    const panel = el('section', { className: 'arc-import', ariaLabel: 'Import from Arc' });
    const close = () => panel.remove();
    const picker = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    panel.append(picker);

    const show = (...children) => {
        panel.replaceChildren(picker, el('h2', { textContent: 'Import from Arc', tabIndex: -1 }), ...children);
        panel.querySelector('h2').focus();
    };
    // The system, once known; until then (and where it cannot be read) both sets of steps show.
    let os;
    chrome.runtime
        .getPlatformInfo()
        .then(info => {
            os = info.os;
            panel.querySelector('.arc-import-where')?.replaceWith(whereToFind(os));
        })
        .catch(() => {});
    const alertLine = message => el('p', { className: 'arc-import-error', role: 'alert', textContent: message });

    const intro = (error = '') =>
        show(
            el('p', {
                textContent:
                    'Bring your Arc spaces, pinned tabs and folders across. Choose Arc’s file, StorableSidebar.json: ' +
                    'Sidecove reads it in Chrome and sends it nowhere.'
            }),
            whereToFind(os),
            ...(error ? [alertLine(error)] : []),
            el('div', { className: 'arc-import-actions' }, [
                button('Choose Arc’s file…', () => picker.click(), 'arc-import-primary'),
                button('Cancel', close)
            ])
        );

    picker.addEventListener('change', async () => {
        const [file] = picker.files;
        picker.value = '';
        if (!file) return;
        try {
            if (file.size > MAX_FILE_BYTES) throw new NotArcFileError();
            const arc = readArcSidebar(await file.text());
            preview(arc, await readEarlierImports());
        } catch (error) {
            if (!(error instanceof NotArcFileError)) Logger.warn('Could not read the Arc file:', error);
            intro(error instanceof NotArcFileError ? NOT_ARC : 'Sidecove could not read this file.');
        }
    });

    function preview(arc, earlier) {
        const done = arc.spaces.map(space => earlier.sources.has(arcSource(space)));
        const boxes = arc.spaces.map((space, index) =>
            el('label', { className: `arc-import-space${done[index] ? ' arc-import-space-done' : ''}` }, [
                el('input', { type: 'checkbox', checked: !done[index], disabled: done[index], value: String(index) }),
                el('span', { className: 'arc-import-space-name', textContent: space.name || 'Arc space' }),
                el('span', {
                    className: 'arc-import-small',
                    textContent: (done[index] ? 'Already imported. ' : '') + describeArcSpace(space)
                })
            ])
        );
        const allDone = done.every(Boolean);
        const start = button('Import', () => run(arc, boxes, earlier), 'arc-import-primary');
        start.disabled = allDone;
        const list = el('fieldset', { className: 'arc-import-spaces' }, [
            el('legend', { textContent: 'Spaces to import' }),
            ...boxes
        ]);
        list.addEventListener('change', () => {
            start.disabled = !boxes.some(box => box.querySelector('input:enabled:checked'));
        });
        show(
            el('p', {
                textContent:
                    'Each space you choose is added after yours, with its pinned tabs and folders. ' +
                    'Your own spaces are untouched; a name you already use gets “(Arc)” after it.'
            }),
            ...(done.some(Boolean)
                ? [
                      el('p', {
                          className: 'arc-import-already',
                          textContent: allDone
                              ? 'Every space in this file is already in Sidecove. To import one again, delete it first.'
                              : 'Spaces you imported before are marked and skipped. To import one again, delete it first.'
                      })
                  ]
                : []),
            list,
            ...(arc.favorites.length
                ? [
                      el('p', {
                          textContent: earlier.favorites
                              ? 'Your Arc favorites are already in Sidecove.'
                              : `Your ${arc.favorites.length} Arc favorites go in a folder in the first space you import.`
                      })
                  ]
                : []),
            el('p', {
                className: 'arc-import-small',
                textContent: 'Today tabs and Arc’s archive are left out.'
            }),
            el('div', { className: 'arc-import-actions' }, [start, button('Cancel', close)])
        );
    }

    async function run(arc, boxes, earlier) {
        const chosen = boxes
            .filter(box => box.querySelector('input').checked)
            .map(box => Number(box.querySelector('input').value));
        for (const control of panel.querySelectorAll('button, input')) control.disabled = true;
        const start = panel.querySelector('.arc-import-primary');
        start.textContent = 'Importing…';
        let result, spaces;
        try {
            // The sidebar allows no folder inside a folder while tab group sync is on.
            const { syncTabGroups = false } = await chrome.storage.sync.get('syncTabGroups');
            result = planArcImport(arc, chosen, { earlier, ...(syncTabGroups ? { maxDepth: 1 } : {}) });
            await whenSaved();
            spaces = await spaceRequest('importSpaces', { plan: result.plan });
        } catch (error) {
            Logger.error('Arc import failed:', error);
            for (const control of panel.querySelectorAll('button, input'))
                control.disabled = Boolean(control.closest('.arc-import-space-done'));
            start.textContent = 'Import';
            panel.querySelector('.arc-import-error')?.remove();
            panel
                .querySelector('.arc-import-actions')
                .before(alertLine(`The import did not finish, and nothing was added. ${error.message}`));
            return;
        }
        // The spaces are saved now; showing them is all that is left, and the sidebar catches up
        // by itself if this fails.
        try {
            await adoptSpaces(spaces);
            // The store adds imported spaces after all the others.
            const first = result.plan.spaces.length ? spaces.at(-result.plan.spaces.length) : null;
            if (first) await showSpace(first.id);
        } catch (error) {
            Logger.warn('Imported spaces could not be shown yet:', error);
        }
        done(describeImport(result));
    }

    function done({ imported, notes, leftOut }) {
        show(
            el('p', { className: 'arc-import-done', role: 'status', textContent: imported }),
            ...notes.map(note => el('p', { textContent: note })),
            ...(leftOut.length
                ? [
                      el('p', { textContent: 'Left out:' }),
                      el(
                          'ul',
                          { className: 'arc-import-left-out' },
                          leftOut.map(line => el('li', { textContent: line }))
                      )
                  ]
                : []),
            el('div', { className: 'arc-import-actions' }, [button('Done', close, 'arc-import-primary')])
        );
    }

    container.prepend(panel);
    intro();
    return panel;
}
