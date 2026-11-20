import {
    emptyBatch,
    hasItsName,
    noteClosedTab,
    pickTargetWindow,
    placeReopened,
    tabsToReopen
} from './closed-window-tabs.js';
import { sections } from '../shared/space-membership.js';
import { pageOf } from '../shared/saved-favorites.js';
import { Logger } from '../shared/logger.js';

// What the worker knows of each window, kept for the browser session: a window that closes is gone
// by the time its tabs are reported, so whether it was an ordinary window must be known before.
const WINDOWS_KEY = 'reopenWindows';
// The tabs of one window are reported closing within moments of each other. Waiting this long
// after the last one also lets Chrome finish quitting, which closes every window, before anything
// is reopened.
export const SETTLE_MS = 1000;
// How long a reopened tab may load to get its title before it is unloaded anyway.
export const NAME_WAIT_MS = 15000;
// Sidecove 1.4.0 builds before this one kept a closed window's pages as links under these keys.
const RETIRED_KEYS = { local: 'closedLinks', session: 'closedLinkTabInfo' };

const reopenable = win => win?.type === 'normal' && !win.incognito;

// When a normal window closes while another stays open, each of its ordinary tabs opens again as a
// tab in the window focused most recently, in the same space and place, and is unloaded until you
// go to it. Closing the last window, or quitting Chrome, leaves that to Chrome's own restore.
export function registerClosedWindowReopen({
    chromeApi = chrome,
    spaceStore,
    now = Date.now,
    schedule = setTimeout,
    cancel = clearTimeout,
    settleMs = SETTLE_MS,
    nameWaitMs = NAME_WAIT_MS
}) {
    // id -> { reopenable, focusedAt }
    let windows = {};
    const batches = new Map();
    const timers = new Map();

    const save = () =>
        chromeApi.storage.session
            .set({ [WINDOWS_KEY]: windows })
            .catch(error => Logger.warn('Could not save the windows to reopen tabs in:', error));
    const noteWindow = win => {
        if (win?.id === undefined) return;
        windows[win.id] = { ...windows[win.id], reopenable: reopenable(win) };
        if (win.focused) windows[win.id].focusedAt = now();
    };

    const ready = (async () => {
        await Promise.all([
            chromeApi.storage.local.remove(RETIRED_KEYS.local),
            chromeApi.storage.session.remove(RETIRED_KEYS.session)
        ]).catch(error => Logger.warn('Could not remove the old closed links:', error));
        const stored = await chromeApi.storage.session.get(WINDOWS_KEY);
        // Windows that are gone are kept: a worker woken by a window closing finds it gone already.
        windows = stored[WINDOWS_KEY] || {};
        for (const win of await chromeApi.windows.getAll()) noteWindow(win);
        await save();
    })().catch(error => Logger.warn('Could not list the windows to reopen tabs in:', error));

    chromeApi.windows.onCreated.addListener(win =>
        ready.then(() => {
            noteWindow(win);
            return save();
        })
    );
    // A window whose tabs are being reopened is forgotten once that is done.
    chromeApi.windows.onRemoved.addListener(id =>
        schedule(() => {
            if (!windows[id] || batches.has(id) || timers.has(id)) return;
            delete windows[id];
            save();
        }, settleMs * 10)
    );
    chromeApi.windows.onFocusChanged.addListener(id =>
        ready.then(() => {
            if (!windows[id]) return;
            windows[id].focusedAt = now();
            return save();
        })
    );

    spaceStore.onTabClosedWithWindow = async ({ tabId, windowId, record, layout }) => {
        await ready;
        if (!windows[windowId]?.reopenable) return;
        batches.set(windowId, noteClosedTab(batches.get(windowId) || emptyBatch(), { tabId, record, layout }));
        cancel(timers.get(windowId));
        timers.set(
            windowId,
            schedule(() => {
                timers.delete(windowId);
                reopen(windowId).catch(error => Logger.error('Could not reopen the tabs of a closed window:', error));
            }, settleMs)
        );
    };

    async function reopen(windowId) {
        const batch = batches.get(windowId);
        batches.delete(windowId);
        delete windows[windowId];
        await save();
        if (!batch?.tabs.length) return;
        const open = (await chromeApi.windows.getAll({ windowTypes: ['normal'] })).filter(
            win => reopenable(win) && win.id !== windowId
        );
        const target = pickTargetWindow(
            open,
            Object.fromEntries(Object.entries(windows).map(([id, info]) => [id, info.focusedAt]))
        );
        // The last window closed, or Chrome is quitting: Chrome's own restore brings the tabs back.
        if (!target) return;
        const reopened = await spaceStore.run(() => openTabs(batch, target.id, open));
        for (const tabId of reopened) unloadOnceNamed(tabId);
    }

    // Runs in the space store's queue, so each new tab is in its place before the panels hear of it.
    async function openTabs(batch, targetId, open) {
        const openIds = new Set(open.map(win => win.id));
        const tabs = await chromeApi.tabs.query({});
        const plan = tabsToReopen(batch, {
            openPages: new Set(tabs.filter(tab => openIds.has(tab.windowId)).map(pageOf)),
            spaceIds: new Set(spaceStore.spaces.map(space => space.id))
        });
        const newIds = new Map();
        for (const { tabId, url } of plan) {
            try {
                const tab = await chromeApi.tabs.create({ windowId: targetId, url, active: false });
                newIds.set(tabId, tab.id);
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
        await spaceStore.persist();
        return [...added];
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
