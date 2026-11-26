import { Logger } from '../shared/logger.js';
import { PENDING_CLEAN_MESSAGE, UNDO_WINDOW_MS, CLOSE_GRACE_MS } from '../shared/pending-clean.js';

export const PENDING_CLEAN_KEY = 'pendingCleans'; // storage.session: tab ids end with the browser session.

// Clean All keeps the tabs it clears open, hidden and muted, for as long as its Undo toast is
// on screen, so Undo can bring back the very same tabs (a local file cannot be reopened
// without file access). This is where they are closed afterwards: the worker, not the
// sidebar, so closing or reloading the sidebar cannot leave them hidden for good. The pending
// closes are saved, and a worker that starts late finishes the ones that are due.
export function registerPendingClean({
    chromeApi = chrome,
    spaceStore,
    removeArchivedTab,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout
} = {}) {
    const batches = new Map(); // batch id -> { id, spaceId, order, closeAt, tabs: [{ tabId, muted }] }
    const timers = new Map();
    // Chrome can swap a tab for a new one (a page it loaded ahead, say): old id -> new id.
    const replaced = new Map();
    const follow = id => {
        while (replaced.has(id)) id = replaced.get(id);
        return id;
    };
    let counter = 0;

    // Start, finish, Undo and restore run one at a time. Undo and restore also claim their tabs
    // as soon as they are asked (see `claim`), so a close already under way checks, after each
    // thing it waits for, that its batch is still there and still holds the tab.
    let chain = Promise.resolve();
    const queue = operation => {
        const pending = chain.then(operation);
        chain = pending.catch(() => {});
        return pending;
    };

    const save = () =>
        chromeApi.storage.session
            .set({ [PENDING_CLEAN_KEY]: [...batches.values()] })
            .catch(error => Logger.warn('[Clean All] Could not save the pending closes:', error));

    // Open tabs, under the ids they have now.
    const liveTabs = async () => (await chromeApi.tabs.query({})).map(tab => ({ ...tab, id: follow(tab.id) }));
    const openIds = async ids => {
        const open = new Set((await liveTabs()).map(tab => tab.id));
        return ids.map(follow).filter(id => open.has(id));
    };

    // Takes the batch out of the record at once; what it saves can finish later.
    function drop(batch) {
        clearTimer(timers.get(batch.id));
        timers.delete(batch.id);
        batches.delete(batch.id);
    }
    function forget(batch) {
        drop(batch);
        return save();
    }

    function schedule(batch) {
        timers.set(
            batch.id,
            setTimer(
                () =>
                    queue(() => finish(batch.id)).catch(error =>
                        Logger.warn('[Clean All] Could not close the tabs:', error)
                    ),
                Math.max(0, batch.closeAt - now())
            )
        );
    }

    const showAgain = (batch, ids) =>
        spaceStore.dispatch({ action: 'unhide', tabIds: ids, spaceId: batch.spaceId, order: batch.order });

    // Sound goes back to what each tab had before Clean All muted it.
    const restoreSound = (tabs, errorText) =>
        Promise.all(
            tabs.map(tab =>
                chromeApi.tabs.update(tab.tabId, { muted: tab.muted }).catch(error => Logger.warn(errorText, error))
            )
        );

    // The Undo window is over: close what is still open. Closing a tab drops it from the
    // hidden set, and one Chrome already closed needs nothing.
    async function finish(batchId) {
        const batch = batches.get(batchId);
        if (!batch) return;
        const all = await liveTabs();
        // Undo may have taken the batch, or restore a tab of it, while the tabs were read.
        if (batches.get(batchId) !== batch) return;
        const wanted = new Set(batch.tabs.map(tab => tab.tabId));
        const live = all.filter(tab => wanted.has(tab.id));
        // A tab pinned meanwhile (from Chrome's own tab strip) is a favourite again, never to be closed.
        const keep = new Set(live.filter(tab => tab.pinned).map(tab => tab.id));
        const closing = live.map(tab => tab.id).filter(id => !keep.has(id));
        if (closing.length) {
            try {
                await chromeApi.tabs.remove(closing.map(follow));
            } catch (error) {
                // Chrome refused (a tab is being dragged, say). A tab that cannot be closed comes
                // back to the list rather than staying hidden.
                Logger.warn('[Clean All] Could not close the hidden tabs; showing them again:', error);
                for (const id of await openIds(closing)) keep.add(id);
            }
        }
        // Undo took the batch meanwhile: it shows what is still open.
        if (batches.get(batchId) !== batch) return;
        const kept = new Set([...keep].map(follow));
        if (kept.size) {
            // Clear put every tab in Archived; one that stays open is not archived.
            await Promise.all(
                live
                    .filter(tab => kept.has(follow(tab.id)))
                    .map(tab =>
                        removeArchivedTab(tab.url, batch.spaceId).catch(error =>
                            Logger.warn('[Clean All] Could not take a kept tab out of Archived:', error)
                        )
                    )
            );
            await showAgain(batch, [...kept]);
            await restoreSound(
                batch.tabs.filter(tab => kept.has(tab.tabId)),
                '[Clean All] Could not restore the sound of a tab:'
            );
        }
        // Forgotten last: a worker that stops before this still finds the record and finishes the close.
        await forget(batch);
    }

    async function start({ spaceId, tabIds, order }) {
        const wanted = new Set(tabIds.map(follow));
        const live = (await liveTabs()).filter(tab => wanted.has(tab.id));
        const batch = {
            id: `${now()}-${++counter}`,
            spaceId,
            order,
            closeAt: now() + UNDO_WINDOW_MS + CLOSE_GRACE_MS,
            tabs: live.map(tab => ({ tabId: tab.id, muted: Boolean(tab.mutedInfo?.muted) }))
        };
        // Saved before anything changes, so a worker that stops midway still finds the record.
        batches.set(batch.id, batch);
        await save();
        let spaces;
        try {
            spaces = await spaceStore.dispatch({ action: 'hide', tabIds: batch.tabs.map(tab => tab.tabId) });
        } catch (error) {
            // Nothing was hidden, so there is nothing to close later.
            await forget(batch);
            throw error;
        }
        await Promise.all(
            batch.tabs.map(tab =>
                chromeApi.tabs
                    .update(tab.tabId, { muted: true })
                    .catch(error => Logger.warn('[Clean All] Could not mute a tab:', error))
            )
        );
        schedule(batch);
        return { batchId: batch.id, closeAt: batch.closeAt, spaces };
    }

    // Undo and restore take their tabs out of the batch the moment they are asked, before
    // waiting their turn, so a close under way leaves them open.
    const claim = {
        undo({ batchId }) {
            const batch = batches.get(batchId);
            if (batch) drop(batch);
            return { batch, tabs: batch?.tabs || [] };
        },
        restoreTab({ tabId }) {
            const id = follow(tabId);
            const batch = [...batches.values()].find(candidate => candidate.tabs.some(tab => tab.tabId === id));
            if (!batch) return { batch, tabs: [] };
            const tab = batch.tabs.find(candidate => candidate.tabId === id);
            batch.tabs = batch.tabs.filter(candidate => candidate !== tab);
            if (!batch.tabs.length) drop(batch);
            return { batch, tabs: [tab] };
        }
    };

    // Shows the claimed tabs that are still open; an Undo of a batch already closed shows none,
    // and the sidebar reopens whatever it finds missing.
    async function bringBack({ batch, tabs }) {
        if (batch) await save();
        const open = new Set(await openIds(tabs.map(tab => tab.tabId)));
        const back = tabs.filter(tab => open.has(follow(tab.tabId)));
        // Nothing to show again: leave the list as it is now.
        if (!back.length) return { restored: [], spaces: await spaceStore.dispatch({ action: 'get' }) };
        const ids = back.map(tab => follow(tab.tabId));
        const spaces = await showAgain(batch, ids);
        // A tab the user had muted stays muted.
        await restoreSound(back, '[Clean All] Could not restore the sound of a tab:');
        return { restored: ids, spaces };
    }

    // The tab Chrome swapped in is the one to close or show again.
    chromeApi.tabs.onReplaced.addListener((added, removed) => {
        replaced.set(removed, added);
        let changed = false;
        for (const batch of batches.values()) {
            for (const tab of batch.tabs)
                if (tab.tabId === removed) {
                    tab.tabId = added;
                    changed = true;
                }
            // Its place in the list, for Undo.
            batch.order = batch.order?.map(id => (id === removed ? added : id));
        }
        if (changed) save();
    });

    // Closes left from a worker that stopped: the due ones now, the rest on time.
    const ready = queue(async () => {
        const stored = (await chromeApi.storage.session.get(PENDING_CLEAN_KEY))?.[PENDING_CLEAN_KEY];
        for (const batch of stored || []) {
            // Chrome may have swapped a tab while the worker was starting.
            for (const tab of batch.tabs) tab.tabId = follow(tab.tabId);
            batch.order = batch.order?.map(follow);
            batches.set(batch.id, batch);
        }
        for (const batch of [...batches.values()]) {
            if (batch.closeAt <= now()) await finish(batch.id);
            else schedule(batch);
        }
    }).catch(error => Logger.warn('[Clean All] Could not resume the pending closes:', error));

    const actions = {
        start: message => queue(() => start(message)),
        undo: message => {
            const claimed = claim.undo(message);
            return queue(() => bringBack(claimed));
        },
        restoreTab: message => {
            const claimed = claim.restoreTab(message);
            return queue(() => bringBack(claimed));
        }
    };
    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== PENDING_CLEAN_MESSAGE || !actions[message.action]) return;
        ready
            .then(() => actions[message.action](message))
            .then(
                result => sendResponse({ success: true, ...result }),
                error => sendResponse({ success: false, error: error.message })
            );
        return true;
    });

    return { ready };
}
