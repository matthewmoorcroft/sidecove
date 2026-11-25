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
import { NotArcFileError, readArcSidebar } from './arc-sidebar.js';
import { planArcImport } from './arc-import-plan.js';
import { describeArcSpace, describeImport } from './arc-import-summary.js';

export const MAC_PATH = '~/Library/Application Support/Arc/StorableSidebar.json';
// Arc's file is a few megabytes at most; this only stops a wrong pick from tying up the panel.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const NOT_ARC = "This file is not Arc's sidebar file. Choose StorableSidebar.json from Arc's folder.";

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

const button = (label, onClick, className = '') =>
    el('button', { type: 'button', textContent: label, className, onclick: onClick });

function whereToFind() {
    return el('div', { className: 'arc-import-where' }, [
        el('p', {}, [
            el('strong', { textContent: 'On a Mac: ' }),
            'in the file window, press Command-Shift-G, paste this and press Return.'
        ]),
        el('code', { className: 'arc-import-path', textContent: MAC_PATH }),
        el('p', {
            className: 'arc-import-small',
            textContent:
                'Finder hides the Library folder; that shortcut goes straight to it. Command-Shift-period shows hidden folders too.'
        }),
        el('p', {}, [
            el('strong', { textContent: 'On Windows: ' }),
            'paste %LOCALAPPDATA%\\Packages in the file window’s address bar, open the folder that starts with ' +
                'TheBrowserCompany.Arc, then LocalCache\\Local\\Arc, and choose StorableSidebar.json.'
        ])
    ]);
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
    const alertLine = message => el('p', { className: 'arc-import-error', role: 'alert', textContent: message });

    const intro = (error = '') =>
        show(
            el('p', {
                textContent:
                    "Copy your Arc spaces, pinned tabs and folders into Sidecove. Choose Arc's sidebar file: " +
                    'Sidecove reads it here in Chrome and sends it nowhere.'
            }),
            whereToFind(),
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
            preview(readArcSidebar(await file.text()));
        } catch (error) {
            if (!(error instanceof NotArcFileError)) Logger.warn('Could not read the Arc file:', error);
            intro(error instanceof NotArcFileError ? NOT_ARC : 'Sidecove could not read this file.');
        }
    });

    function preview(arc) {
        const boxes = arc.spaces.map((space, index) =>
            el('label', { className: 'arc-import-space' }, [
                el('input', { type: 'checkbox', checked: true, value: String(index) }),
                el('span', { className: 'arc-import-space-name', textContent: space.name || 'Arc space' }),
                el('span', { className: 'arc-import-small', textContent: describeArcSpace(space) })
            ])
        );
        const start = button('Import', () => run(arc, boxes), 'arc-import-primary');
        const list = el('fieldset', { className: 'arc-import-spaces' }, [
            el('legend', { textContent: 'Spaces to import' }),
            ...boxes
        ]);
        list.addEventListener('change', () => {
            start.disabled = !boxes.some(box => box.querySelector('input').checked);
        });
        show(
            el('p', {
                textContent:
                    'Each space you choose becomes a new space after yours, with its pinned tabs and folders. ' +
                    'Your own spaces stay as they are; a name you already use gets “(Arc)” after it.'
            }),
            list,
            ...(arc.favorites.length
                ? [
                      el('p', {
                          textContent: `Your ${arc.favorites.length} Arc favorites go in a folder at the top of the first space you import.`
                      })
                  ]
                : []),
            el('p', {
                className: 'arc-import-small',
                textContent:
                    'Today tabs are left out, as Arc keeps them open rather than saved, and so is Arc’s archive, which is in another file.'
            }),
            el('div', { className: 'arc-import-actions' }, [start, button('Cancel', close)])
        );
    }

    async function run(arc, boxes) {
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
            result = planArcImport(arc, chosen, syncTabGroups ? { maxDepth: 1 } : {});
            await whenSaved();
            spaces = await spaceRequest('importSpaces', { plan: result.plan });
        } catch (error) {
            Logger.error('Arc import failed:', error);
            for (const control of panel.querySelectorAll('button, input')) control.disabled = false;
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
