import { Logger } from '../../../shared/logger.js';
import { navActionFromClick, navActionFromKey, runNavAction } from './nav-actions.js';
import { trackNavButtonsSetting } from './nav-buttons-setting.js';

const KEY_HINTS = {
    back: { mac: '⌘[', other: 'Alt+Left' },
    forward: { mac: '⌘]', other: 'Alt+Right' },
    reload: { mac: '⌘R', other: 'Ctrl+R' }
};
const LABELS = { back: 'Back', forward: 'Forward', reload: 'Reload' };

// The row of three buttons at the top of the panel, and the keys that do the same while the
// panel has focus. Chrome would otherwise take those keys for the panel itself (Command-R
// reloads the panel), so they are always on, whether or not the row is shown.
export function setupNavButtons({ row, tabs, storage, isMac, doc = document }) {
    const run = action =>
        runNavAction(tabs, action).then(ok => {
            if (!ok) Logger.log('Nothing to do for', action?.name);
        });

    for (const button of row.querySelectorAll('[data-nav]')) {
        const name = button.dataset.nav;
        const hint = KEY_HINTS[name][isMac ? 'mac' : 'other'];
        button.title =
            name === 'reload'
                ? `${LABELS[name]} (${hint}). Shift-click reloads without the cache`
                : `${LABELS[name]} (${hint})`;
        button.addEventListener('click', event => {
            run(navActionFromClick(name, event));
        });
    }

    doc.addEventListener('keydown', event => {
        const action = navActionFromKey(event, isMac);
        if (!action) return;
        event.preventDefault();
        run(action);
    });

    return trackNavButtonsSetting(storage, shown => {
        row.hidden = !shown;
    });
}
