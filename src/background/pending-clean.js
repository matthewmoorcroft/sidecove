import { Logger } from '../shared/logger.js';
import { Utils } from '../shared/utils.js';
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
    removeArchivedTab = (url, spaceId) => Utils.removeArchivedTab(url, spaceId),
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout
} = {}) {
    const batches = new Map(); // batch id -> { id, spaceId, order, closeAt, tabs: [{ tabId, muted }] }
    const timers = new Map();
    let counter = 0;

    const save = () =>
        chromeApi.storage.session
            .set({ [PENDING_CLEAN_KEY]: [...batches.values()] })
            .catch(error => Logger.warn('[Clean All] Could not save the pending closes:', error));

    const openIds = async ids => {
        const open = new Set((await chromeApi.tabs.query({})).map(tab => tab.id));
        return ids.filter(id => open.has(id));
    };

    function forget(batch) {
        clearTimer(timers.get(batch.id));
        timers.delete(batch.id);
        batches.delete(batch.id);
        return save();
    }

    function schedule(batch) {
        timers.set(
            batch.id,
            setTimer(
                () => finish(batch.id).catch(error => Logger.warn('[Clean All] Could not close the tabs:', error)),
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
        const wanted = new Set(batch.tabs.map(tab => tab.tabId));
        const live = (await chromeApi.tabs.query({})).filter(tab => wanted.has(tab.id));
        // A tab pinned meanwhile (from Chrome's own tab strip) is a favourite again, never to be closed.
        const keep = new Set(live.filter(tab => tab.pinned).map(tab => tab.id));
        const closing = live.map(tab => tab.id).filter(id => !keep.has(id));
        if (closing.length) {
            try {
                await chromeApi.tabs.remove(closing);
            } catch (error) {
                // Chrome refused (a tab is being dragged, say). A tab that cannot be closed comes
                // back to the list rather than staying hidden.
                Logger.warn('[Clean All] Could not close the hidden tabs; showing them again:', error);
                for (const id of await openIds(closing)) keep.add(id);
            }
        }
        if (keep.size) {
            // Clear put every tab in Archived; one that stays open is not archived.
            await Promise.all(
                live
                    .filter(tab => keep.has(tab.id))
                    .map(tab =>
                        removeArchivedTab(tab.url, batch.spaceId).catch(error =>
                            Logger.warn('[Clean All] Could not take a kept tab out of Archived:', error)
                        )
                    )
            );
            await showAgain(batch, [...keep]);
            await restoreSound(
                batch.tabs.filter(tab => keep.has(tab.tabId)),
                '[Clean All] Could not restore the sound of a tab:'
            );
        }
        // Forgotten last: a worker that stops before this still finds the record and finishes the close.
        await forget(batch);
    }

    async function start({ spaceId, tabIds, order }) {
        const wanted = new Set(tabIds);
        const live = (await chromeApi.tabs.query({})).filter(tab => wanted.has(tab.id));
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

    async function undo({ batchId }) {
        const batch = batches.get(batchId);
        // Already closed: the sidebar reopens whatever it finds missing.
        if (!batch) return { restored: [], spaces: await spaceStore.dispatch({ action: 'get' }) };
        await forget(batch);
        const open = new Set(await openIds(batch.tabs.map(tab => tab.tabId)));
        const back = batch.tabs.filter(tab => open.has(tab.tabId));
        const spaces = await showAgain(
            batch,
            back.map(tab => tab.tabId)
        );
        // A tab the user had muted stays muted.
        await restoreSound(back, '[Clean All] Could not restore the sound of a tab:');
        return { restored: back.map(tab => tab.tabId), spaces };
    }

    // Bring back one hidden tab, leaving the rest of its batch to close on time. It is what
    // picking a hidden tab in Chrome's own tab strip asks for.
    async function restoreTab({ tabId }) {
        const batch = [...batches.values()].find(candidate => candidate.tabs.some(tab => tab.tabId === tabId));
        if (!batch) return { restored: [], spaces: await spaceStore.dispatch({ action: 'get' }) };
        const tab = batch.tabs.find(candidate => candidate.tabId === tabId);
        batch.tabs = batch.tabs.filter(candidate => candidate !== tab);
        if (batch.tabs.length) await save();
        else await forget(batch);
        // Chrome closed it meanwhile: nothing to show, and nothing left to close.
        if (!(await openIds([tabId])).length)
            return { restored: [], spaces: await spaceStore.dispatch({ action: 'get' }) };
        const spaces = await showAgain(batch, [tabId]);
        await restoreSound([tab], '[Clean All] Could not restore the sound of a tab:');
        return { restored: [tabId], spaces };
    }

    const ready = (async () => {
        const stored = (await chromeApi.storage.session.get(PENDING_CLEAN_KEY))?.[PENDING_CLEAN_KEY];
        for (const batch of stored || []) batches.set(batch.id, batch);
        for (const batch of [...batches.values()]) {
            if (batch.closeAt <= now()) await finish(batch.id);
            else schedule(batch);
        }
    })().catch(error => Logger.warn('[Clean All] Could not resume the pending closes:', error));

    const actions = { start, undo, restoreTab };
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
