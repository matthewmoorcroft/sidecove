import {
    canTakeTabs,
    closedBatch,
    copyReplacedBy,
    hasItsName,
    pageInSpace,
    pickTargetWindow,
    placeReopened,
    tabsToReopen,
    windowContents
} from './closed-window-tabs.js';
import { pageOf } from '../shared/saved-favorites.js';
import { sections } from '../shared/space-membership.js';
import { Logger } from '../shared/logger.js';

// What the worker knows of each window, kept for the browser session so a worker that Chrome has
// stopped still knows it when woken by the window closing:
//   { [windowId]: { reopenable, focusedAt, closing, tabs, layouts } }, `tabs` and `layouts` as
//   windowContents (closed-window-tabs.js) gives them, taken each time the spaces are saved until
//   the window starts closing (`closing`), when its record is left as it was.
const WINDOWS_KEY = 'reopenWindows';
// The tabs Sidecove reopened that still stand in for a closed window's tabs, until you go to them:
// [{ copyId, url, windowIds }].
const COPIES_KEY = 'reopenedCopies';
// How long a reopened tab may load to get its title before it is unloaded anyway.
export const NAME_WAIT_MS = 15000;

// When a normal window closes while another stays open, each of its ordinary tabs opens again as a
// tab in the window focused most recently, in the same space and place, and is unloaded until you
// go to it. Closing the last window, or quitting Chrome, leaves that to Chrome's own restore.
export function registerClosedWindowReopen({
    chromeApi = chrome,
    spaceStore,
    now = Date.now,
    schedule = setTimeout,
    cancel = clearTimeout,
    nameWaitMs = NAME_WAIT_MS
}) {
    let windows = {};
    let copies = [];

    const save = () =>
        chromeApi.storage.session
            .set({ [WINDOWS_KEY]: windows, [COPIES_KEY]: copies })
            .catch(error => Logger.warn('Could not save the windows to reopen tabs in:', error));
    const noteWindow = win => {
        if (win?.id === undefined) return;
        windows[win.id] = { ...windows[win.id], reopenable: canTakeTabs(win) };
        if (win.focused) windows[win.id].focusedAt = now();
    };

    const ready = (async () => {
        const stored = await chromeApi.storage.session.get([WINDOWS_KEY, COPIES_KEY]);
        // Windows that are gone are kept: a worker woken by a window closing finds it gone already.
        windows = stored[WINDOWS_KEY] || {};
        copies = Array.isArray(stored[COPIES_KEY]) ? stored[COPIES_KEY] : [];
        for (const win of await chromeApi.windows.getAll()) noteWindow(win);
        await save();
    })().catch(error => Logger.warn('Could not list the windows to reopen tabs in:', error));

    chromeApi.windows.onCreated.addListener(win =>
        ready.then(() => {
            noteWindow(win);
            return save();
        })
    );
    chromeApi.windows.onFocusChanged.addListener(id =>
        ready.then(() => {
            if (!windows[id]) return;
            windows[id].focusedAt = now();
            return save();
        })
    );

    // Each time the spaces are saved, what every open window holds is noted. A window that has
    // closed has no tabs left to report, so its last record stays until it is dealt with below. One
    // that is closing may still list some of its tabs, which would replace the record with fewer, so
    // it is left alone too.
    spaceStore.onPersisted = async tabs => {
        await ready;
        let changed = false;
        // Windows share a space's list, so each list is turned into text once.
        const texts = new Map();
        const textOf = value => {
            if (!texts.has(value)) texts.set(value, JSON.stringify(value));
            return texts.get(value);
        };
        const same = (a = {}, b = {}) =>
            textOf(a.tabs) === textOf(b.tabs) &&
            Object.keys({ ...a.layouts, ...b.layouts }).every(
                id => a.layouts?.[id] === b.layouts?.[id] || textOf(a.layouts?.[id]) === textOf(b.layouts?.[id])
            );
        for (const [id, contents] of Object.entries(windowContents(spaceStore.spaces, tabs))) {
            const known = windows[id];
            if (known?.closing) continue;
            if (!known) {
                const win = await chromeApi.windows.get(Number(id)).catch(() => null);
                if (win) noteWindow(win);
            }
            if (same(known, contents)) continue;
            windows[id] = { ...windows[id], ...contents };
            changed = true;
        }
        if (changed) await save();
    };
    // Closing a tab closes its page everywhere, even a window's only tab, which closes the window
    // with it; only closing the window itself keeps its pages. Chrome reports a tab closed with its
    // window with isWindowClosing set, and a tab closed on its own without.
    spaceStore.onTabRemoved = async (tabId, info) => {
        await ready;
        const before = copies.length;
        copies = copies.filter(copy => copy.copyId !== tabId);
        const entry = windows[info?.windowId];
        const alone = !info?.isWindowClosing && entry?.tabs?.some(tab => tab.tabId === tabId);
        if (alone) entry.tabs = entry.tabs.filter(tab => tab.tabId !== tabId);
        // The window is going: a save before it is dealt with must not shrink what it held.
        const closing = Boolean(info?.isWindowClosing && entry && !entry.closing);
        if (closing) entry.closing = true;
        if (alone || closing || copies.length !== before) await save();
    };
    // A tab moved into another window is listed under that window from then on.
    chromeApi.tabs.onAttached.addListener(() =>
        spaceStore.run(() => spaceStore.persist()).catch(error => Logger.warn('Could not note a moved tab:', error))
    );

    // Chrome reports a window removed after the removal of each of its tabs, and the space store
    // deals with those in order, so by the time this runs in its queue they are all done. The pages
    // open again at once, so they show in the window left as the closed one goes. Quitting Chrome
    // with two windows of web pages leaves each page open once after the restart (the e2e test
    // "quitting with two windows open reopens nothing"): a copy made into a window that is closing
    // as well does not outlive the quit.
    chromeApi.windows.onRemoved.addListener(windowId =>
        ready
            .then(() => spaceStore.run(() => takeClosedWindow(windowId)))
            .then(batch => batch && reopen(windowId, batch))
            .catch(error => Logger.error('Could not reopen the tabs of a closed window:', error))
    );

    async function takeClosedWindow(windowId) {
        const entry = windows[windowId];
        if (!entry) return null;
        delete windows[windowId];
        await save();
        if (!entry.reopenable) return null;
        const openTabIds = new Set((await chromeApi.tabs.query({})).map(tab => tab.id));
        const batch = closedBatch(entry, openTabIds);
        return batch.tabs.length ? batch : null;
    }

    async function reopen(windowId, batch) {
        try {
            const open = (await chromeApi.windows.getAll({ windowTypes: ['normal'] })).filter(
                win => canTakeTabs(win) && win.id !== windowId
            );
            const target = pickTargetWindow(
                open,
                Object.fromEntries(Object.entries(windows).map(([id, info]) => [id, info.focusedAt]))
            );
            // The last window closed, or Chrome is quitting: Chrome's own restore brings the tabs back.
            if (!target) return;
            const reopened = await spaceStore.run(() => openTabs(batch, target.id, open));
            for (const tabId of reopened) unloadOnceNamed(tabId);
        } catch (error) {
            Logger.error('Could not reopen the tabs of a closed window:', error);
        }
    }

    // Runs in the space store's queue, so each new tab is in its place before the panels hear of it.
    async function openTabs(batch, targetId, open) {
        const openIds = new Set(open.map(win => win.id));
        const tabs = new Map(
            (await chromeApi.tabs.query({})).filter(tab => openIds.has(tab.windowId)).map(tab => [tab.id, tab])
        );
        const openPages = new Set();
        for (const space of spaceStore.spaces)
            for (const id of space.temporaryTabs) {
                const tab = tabs.get(id);
                if (tab) openPages.add(pageInSpace(space.id, pageOf(tab)));
            }
        const plan = tabsToReopen(batch, { openPages, spaceIds: new Set(spaceStore.spaces.map(space => space.id)) });
        const newIds = new Map();
        for (const { tabId, url } of plan) {
            try {
                const tab = await chromeApi.tabs.create({ windowId: targetId, url, active: false });
                newIds.set(tabId, tab.id);
                copies.push({ copyId: tab.id, url, windowIds: [...openIds] });
            } catch (error) {
                Logger.warn('Could not reopen a tab of a closed window:', error);
            }
        }
        if (!newIds.size) return [];
        const added = new Set(newIds.values());
        for (const space of spaceStore.spaces)
            for (const key of sections) space[key] = space[key].filter(id => !added.has(id));
        for (const [spaceId, layout] of Object.entries(batch.layouts)) {
            const space = spaceStore.spaces.find(s => s.id === spaceId);
            const mine = new Map([...newIds].filter(([oldId]) => layout.includes(oldId)));
            if (space && mine.size) space.temporaryTabs = placeReopened(space.temporaryTabs, layout, mine);
        }
        // Sidecove has reopened these, so Chrome reopening the window must not file them again.
        spaceStore.restoreQueue = spaceStore.restoreQueue.filter(record => !newIds.has(record.tabId));
        await save();
        await spaceStore.persist();
        return [...added];
    }

    // Reopening the closed window (Cmd+Shift+T, or History) brings back its own tabs. Each one
    // takes the place of Sidecove's copy, which closes, so every page is open once and in its space.
    chromeApi.tabs.onCreated.addListener(tab =>
        ready
            .then(async () => {
                if (!copies.length) return;
                const win = await chromeApi.windows.get(tab.windowId).catch(() => null);
                const copy = copyReplacedBy(copies, tab, win);
                if (copy) return spaceStore.run(() => replaceCopy(copy, tab.id));
            })
            .catch(error => Logger.warn('Could not tidy a reopened window:', error))
    );
    // A tab that gets a new id (Chrome swapping it for another) is still the same copy.
    chromeApi.tabs.onReplaced.addListener((addedId, removedId) =>
        ready.then(() => {
            const copy = copies.find(other => other.copyId === removedId);
            if (!copy) return;
            copy.copyId = addedId;
            return save();
        })
    );
    // A copy you have gone to is yours now, with whatever you did in it, so it stays open.
    chromeApi.tabs.onActivated.addListener(({ tabId }) =>
        ready.then(() => {
            const before = copies.length;
            copies = copies.filter(copy => copy.copyId !== tabId);
            if (copies.length !== before) return save();
        })
    );

    async function replaceCopy(copy, restoredId) {
        copies = copies.filter(other => other !== copy);
        await save();
        const live = await chromeApi.tabs.get(copy.copyId).catch(() => null);
        if (!live) return;
        const space = spaceStore.spaces.find(s => s.temporaryTabs.includes(copy.copyId));
        if (space) {
            for (const other of spaceStore.spaces)
                for (const key of sections) other[key] = other[key].filter(id => id !== restoredId);
            space.temporaryTabs = space.temporaryTabs.map(id => (id === copy.copyId ? restoredId : id));
            await spaceStore.persist();
        }
        await chromeApi.tabs.remove(copy.copyId).catch(error => Logger.warn('Could not close a copied tab:', error));
    }

    // A tab is created loading; once it has its title it is unloaded, unless you have gone to it.
    function unloadOnceNamed(tabId) {
        let done = false;
        let timer;
        const finish = async () => {
            if (done) return;
            done = true;
            cancel(timer);
            chromeApi.tabs.onUpdated.removeListener(updated);
            const tab = await chromeApi.tabs.get(tabId).catch(() => null);
            // A tab with no address yet would lose its page if unloaded.
            if (!tab || tab.active || tab.discarded || !tab.url) return;
            await chromeApi.tabs.discard(tabId).catch(error => Logger.warn('Could not unload a reopened tab:', error));
        };
        const updated = (id, change, tab) => {
            if (id === tabId && hasItsName(change, tab)) finish();
        };
        chromeApi.tabs.onUpdated.addListener(updated);
        timer = schedule(finish, nameWaitMs);
        // It may have its name already.
        chromeApi.tabs.get(tabId).then(
            tab => hasItsName({ status: tab.status }, tab) && finish(),
            () => finish()
        );
    }
}
