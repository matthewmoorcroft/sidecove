import { isPracticeUrl } from './tour-practice.js';
import { syncSpaceGroups } from './tab-group-sync.js';
import { placeLinkTab } from './link-tab-placement.js';
import { LocalStorage } from './localstorage.js';

import { sections, ownerOf, updateNativePinSection, spaceForActivation } from './space-membership.js';
import { hideTabs, showTabs } from './hidden-tabs.js';
export { tabIds, ownerOf } from './space-membership.js';
const clone = value => structuredClone(value);

// The service worker is the only writer. UI patches express changes relative to the
// panel's previous view, so a stale panel cannot erase tabs created in another window.
export function applySpacePatch(current, before, after) {
    const removed = new Set(before.filter(s => !after.some(n => n.id === s.id)).map(s => s.id));
    let result = clone(current.filter(s => !removed.has(s.id)));
    for (const next of after) {
        const prev = before.find(s => s.id === next.id);
        let target = result.find(s => s.id === next.id);
        if (!target) {
            if (prev) continue; // A different panel deleted this space.
            target = { ...clone(next), spaceBookmarks: [], temporaryTabs: [], pinnedTabs: [] };
            result.push(target);
        }
        for (const [key, value] of Object.entries(next)) {
            if (!sections.includes(key) && JSON.stringify(value) !== JSON.stringify(prev?.[key]))
                target[key] = clone(value);
        }
        for (const key of sections) {
            const oldIds = prev?.[key] || [];
            const newIds = next[key] || [];
            if (JSON.stringify(oldIds) === JSON.stringify(newIds)) continue;
            const deleted = oldIds.filter(id => !newIds.includes(id));
            const added = newIds.filter(id => !oldIds.includes(id));
            for (const id of added) {
                for (const space of result)
                    for (const section of sections) space[section] = (space[section] || []).filter(t => t !== id);
            }
            const existing = (target[key] || []).filter(id => !deleted.includes(id));
            target[key] = [
                ...newIds.filter(id => existing.includes(id) || added.includes(id)),
                ...existing.filter(id => !newIds.includes(id))
            ];
        }
    }
    if (JSON.stringify(before.map(s => s.id)) !== JSON.stringify(after.map(s => s.id))) {
        result.sort((a, b) => {
            const rank = s => {
                const i = after.findIndex(n => n.id === s.id);
                return i < 0 ? after.length : i;
            };
            return rank(a) - rank(b);
        });
    }
    return result;
}

export class SpaceStore {
    constructor() {
        this.chain = Promise.resolve();
        this.initialized = false;
        // Tabs Clean All is hiding until its Undo toast ends. They are open but belong to no space.
        this.hidden = new Set();
    }
    run(operation) {
        const pending = this.chain.then(async () => {
            await this.initialize();
            return operation();
        });
        this.chain = pending.catch(console.error);
        return pending;
    }
    async makeSpace(name, color = 'grey', folder = null) {
        folder ||= await LocalStorage.getOrCreateSpaceFolder(name);
        const entry = await LocalStorage.getOrCreateSpaceRegistryEntry(folder.id, { name, color });
        return {
            id: entry.spaceUuid,
            spaceUuid: entry.spaceUuid,
            uuid: entry.spaceUuid,
            bookmarkFolderId: folder.id,
            name,
            color: entry.color || color,
            ...(entry.icon ? { icon: entry.icon } : {}),
            spaceBookmarks: [],
            temporaryTabs: [],
            pinnedTabs: []
        };
    }
    async initialize() {
        if (this.initialized) return;
        const data = await chrome.storage.local.get([
            'spaces',
            'spaceModelVersion',
            'spaceTabSnapshot',
            'archivedTabs'
        ]);
        const session = await chrome.storage.session.get([
            'spaceSession',
            'spaceRestoreQueue',
            'activeSpaces',
            'lastActiveSpace',
            'restoredTabRanks',
            'hiddenTabs',
            'linkTails'
        ]);
        this.spaces = data.spaces || [];
        this.snapshotByTab = new Map((data.spaceTabSnapshot || []).filter(t => t.tabId).map(t => [t.tabId, t]));
        this.provisional = new Set();
        this.restoredMetadata = [];
        this.restoredRanks = new Map(session.restoredTabRanks || []);
        this.active = session.activeSpaces || {};
        this.lastActive = session.lastActiveSpace || null;
        const settings = await chrome.storage.sync.get([
            'defaultSpaceName',
            'perSpacePinnedFavorites',
            'invertTabOrder'
        ]);
        this.defaultSpaceName = settings.defaultSpaceName || 'Home';
        this.perSpacePinnedFavorites = settings.perSpacePinnedFavorites === true;
        this.invertTabOrder = settings.invertTabOrder !== false;
        const live = await chrome.tabs.query({});
        // Opener tab -> the last link opened from it since the user last switched to it.
        this.linkTails = new Map(session.linkTails || []);
        if (data.spaceModelVersion !== 2) {
            const idMap = new Map();
            const migrated = [];
            const legacyGroups = this.spaces.length ? await chrome.tabGroups.query({}) : [];
            for (const old of this.spaces) {
                const space = await this.makeSpace(old.name, old.color);
                idMap.set(old.id, space.id);
                // Legacy groups are read once to preserve existing users' membership.
                const namedGroups = legacyGroups.filter(g => g.title === old.name);
                const legacyIds = new Set(namedGroups.length ? namedGroups.map(g => g.id) : [old.id]);
                const members = live.filter(t => legacyIds.has(t.groupId) && !t.pinned);
                const pinned = old.spaceBookmarks || [];
                space.spaceBookmarks = members.filter(t => pinned.includes(t.id)).map(t => t.id);
                space.temporaryTabs = members.filter(t => !pinned.includes(t.id)).map(t => t.id);
                const existing = migrated.find(s => s.id === space.id);
                if (existing) {
                    for (const key of sections) existing[key].push(...space[key]);
                } else migrated.push(space);
            }
            this.spaces = migrated;
            if (migrated.length) await chrome.storage.local.set({ tabGroupImportDismissed: true });
            if (data.archivedTabs)
                await chrome.storage.local.set({
                    archivedTabs: data.archivedTabs.map(t => ({ ...t, spaceId: idMap.get(t.spaceId) || t.spaceId }))
                });
            this.restoreQueue = [];
        } else if (!session.spaceSession) {
            // Chrome tab IDs are session-local. Never accept an old ID after restart.
            this.restoreQueue = data.spaceTabSnapshot || [];
            this.spaces.forEach(s => {
                s.spaceBookmarks = [];
                s.temporaryTabs = [];
                s.pinnedTabs = [];
                delete s.lastTab;
            });
            this.active = {};
            this.lastActive = null;
            this.restoredRanks.clear();
            await chrome.storage.local.set({ pinnedTabStatesById: {}, tabNameOverridesById: {}, tabLastActivity: {} });
        } else {
            this.restoreQueue = session.spaceRestoreQueue || [];
        }
        await this.discoverBookmarkSpaces();
        if (!this.spaces.length) {
            this.spaces.push(await this.makeSpace(this.defaultSpaceName));
        }
        const valid = new Set(live.map(t => t.id));
        // A worker that restarts while Clean All is waiting must not take its tabs back in.
        this.hidden = new Set((session.hiddenTabs || []).filter(id => valid.has(id)));
        for (const space of this.spaces)
            for (const key of sections) space[key] = (space[key] || []).filter(id => valid.has(id));
        for (const tab of live) this.track(tab);
        this.initialized = true;
        await this.persist();
    }
    // Bookmark folders are durable space definitions regardless of Chrome group sync.
    // Run on every worker startup and sidebar read, including version-2 installations.
    async discoverBookmarkSpaces() {
        const before = JSON.stringify(this.spaces);
        const root = await LocalStorage.getOrCreateSidecoveFolder();
        const folders = (await chrome.bookmarks.getChildren(root.id)).filter(node => !node.url);
        for (const folder of folders) {
            let space = this.spaces.find(space => space.bookmarkFolderId === folder.id);
            if (!space) {
                // Recover a missing/stale folder association without duplicating the space.
                space = this.spaces.find(
                    space => space.name === folder.title && !folders.some(node => node.id === space.bookmarkFolderId)
                );
                if (space) space.bookmarkFolderId = folder.id;
                else {
                    this.spaces.push(await this.makeSpace(folder.title, 'grey', folder));
                    continue;
                }
            }
            space.name = folder.title;
        }
        // Bookmark folders are durable, so discovery also restores their order in the switcher.
        const rank = new Map(folders.map((folder, index) => [folder.id, index]));
        this.spaces.sort(
            (a, b) =>
                (rank.get(a.bookmarkFolderId) ?? folders.length) - (rank.get(b.bookmarkFolderId) ?? folders.length)
        );
        return before !== JSON.stringify(this.spaces);
    }
    track(tab) {
        if (this.hidden.has(tab.id)) return;
        const url = tab.url || tab.pendingUrl;
        if (url?.startsWith(chrome.runtime?.getURL?.('') || 'chrome-extension://invalid/') && !isPracticeUrl(url)) {
            for (const space of this.spaces)
                for (const key of sections) space[key] = space[key].filter(id => id !== tab.id);
            return;
        }
        const existing = ownerOf(this.spaces, tab.id);
        // Native pins keep their space, but live in the top favicon bar rather than
        // either list. Unpinning returns them to that same space as ordinary tabs.
        if (existing) updateNativePinSection(existing, tab);
        if (existing) {
            if (!this.provisional.has(tab.id) || !url) return;
            this.provisional.delete(tab.id);
            if (!this.restoreQueue.some(t => t.url === url)) return;
            for (const key of sections) existing[key] = existing[key].filter(id => id !== tab.id);
        }
        if (!url) this.provisional.add(tab.id);
        const restoredIndex = this.restoreQueue.findIndex(
            t =>
                (t.section === 'pinnedTabs') === Boolean(tab.pinned) &&
                t.url === url &&
                this.spaces.some(s => s.id === t.spaceId)
        );
        const restored = restoredIndex >= 0 ? this.restoreQueue.splice(restoredIndex, 1)[0] : null;
        // Chrome can attach the current tab as opener even for Cmd/Ctrl+T.
        // A blank new-tab page belongs to the selected space, not that incidental opener.
        const isNewTabPage = !url || /^(chrome:\/\/(newtab|new-tab-page)\/?|about:blank)$/.test(url);
        const openerSpace = isNewTabPage
            ? null
            : spaceForActivation(this.spaces, tab.openerTabId, this.perSpacePinnedFavorites);
        // A window with no space of its own yet (such as one Chrome opens for a link from another
        // app) uses the space last in use in any window; the default space is for when there
        // is none yet.
        const space =
            this.spaces.find(s => s.id === restored?.spaceId) ||
            openerSpace ||
            this.spaces.find(s => s.id === this.active[tab.windowId]) ||
            this.spaces.find(s => s.id === this.lastActive) ||
            this.spaces.find(s => s.name === this.defaultSpaceName) ||
            this.spaces[0];
        if (!space) return;
        const key = tab.pinned ? 'pinnedTabs' : restored?.section || 'temporaryTabs';
        if (restored) {
            this.restoredMetadata.push({ ...restored, tabId: tab.id });
            // Preserve extension order when Chrome restores tabs in a different order.
            this.restoredRanks ||= new Map();
            this.restoredRanks.set(tab.id, restored.order);
            space[key].push(tab.id);
            space[key].sort(
                (a, b) => (this.restoredRanks.get(a) ?? Infinity) - (this.restoredRanks.get(b) ?? Infinity)
            );
        } else if (key === 'temporaryTabs' && tab.openerTabId !== undefined && !(url && isNewTabPage)) {
            // A link opened from a tab goes below it, whichever way the list is drawn. Chrome reports
            // no address yet for some link tabs, so only a named new-tab page is left out.
            const tail = this.linkTails.get(tab.openerTabId);
            space[key] = placeLinkTab(space[key], tab.openerTabId, tab.id, tail, this.invertTabOrder);
            this.linkTails.set(tab.openerTabId, tab.id);
            // A link from a link stays with the group of the tab that opened the first one.
            for (const [opener, tail] of this.linkTails)
                if (tail === tab.openerTabId) this.linkTails.set(opener, tab.id);
        } else space[key].push(tab.id);
    }
    // When the last link opened from a tab closes, the link above it on screen becomes the last one.
    moveTailsOff(id) {
        const list = this.spaces.map(s => s.temporaryTabs).find(tabs => tabs.includes(id)) || [];
        const above = list[list.indexOf(id) + (this.invertTabOrder ? 1 : -1)];
        for (const [opener, tail] of this.linkTails) {
            if (tail !== id) continue;
            if (above === undefined || above === opener) this.linkTails.delete(opener);
            else this.linkTails.set(opener, above);
        }
    }
    async persist() {
        const tabs = new Map((await chrome.tabs.query({})).map(t => [t.id, t]));
        this.restoreQueue = this.restoreQueue.filter(t => this.spaces.some(s => s.id === t.spaceId));
        const metadata = await chrome.storage.local.get(['pinnedTabStatesById', 'tabNameOverridesById']);
        const pinnedStates = metadata.pinnedTabStatesById || {};
        const overrides = metadata.tabNameOverridesById || {};
        if (this.restoredMetadata.length) {
            for (const record of this.restoredMetadata) {
                if (record.pinnedState) pinnedStates[record.tabId] = record.pinnedState;
                if (record.nameOverride) overrides[record.tabId] = record.nameOverride;
            }
            await chrome.storage.local.set({ pinnedTabStatesById: pinnedStates, tabNameOverridesById: overrides });
            this.restoredMetadata = [];
        }
        const snapshot = [];
        for (const space of this.spaces)
            for (const section of sections) {
                space[section] = [...new Set(space[section])].filter(id => tabs.has(id));
                space[section].forEach((id, order) => {
                    const tab = tabs.get(id);
                    const record = {
                        tabId: id,
                        spaceId: space.id,
                        section,
                        order: this.restoredRanks.get(id) ?? order,
                        url: tab.url || tab.pendingUrl || '',
                        ...(pinnedStates[id] ? { pinnedState: pinnedStates[id] } : {}),
                        ...(overrides[id] ? { nameOverride: overrides[id] } : {})
                    };
                    snapshot.push(record);
                    this.snapshotByTab.set(id, record);
                });
            }
        await chrome.storage.local.set({
            spaces: clone(this.spaces),
            spaceModelVersion: 2,
            spaceTabSnapshot: [...snapshot, ...this.restoreQueue]
        });
        await chrome.storage.session.set({
            spaceSession: true,
            activeSpaces: this.active,
            lastActiveSpace: this.lastActive,
            spaceRestoreQueue: this.restoreQueue,
            restoredTabRanks: [...this.restoredRanks],
            hiddenTabs: [...this.hidden],
            linkTails: [...this.linkTails]
        });
        try {
            await syncSpaceGroups(this.spaces, this.active);
        } catch (error) {
            console.warn('Tab group sync deferred:', error);
        }
    }
    async dispatch(message) {
        return this.run(async () => {
            switch (message.action) {
                case 'get':
                    if (await this.discoverBookmarkSpaces()) await this.persist();
                    break;
                case 'patch':
                    for (const next of message.after) {
                        const prev = message.before.find(s => s.id === next.id);
                        for (const key of sections)
                            if (JSON.stringify(next[key]) !== JSON.stringify(prev?.[key])) {
                                for (const id of next[key] || []) this.restoredRanks.delete(id);
                            }
                    }
                    this.spaces = applySpacePatch(this.spaces, message.before, message.after);
                    if (!this.spaces.length) this.spaces.push(await this.makeSpace(this.defaultSpaceName));
                    // Shared pins survive deleting a space; give any orphan a remaining owner.
                    for (const tab of await chrome.tabs.query({ pinned: true })) {
                        if (tab.pinned && !ownerOf(this.spaces, tab.id)) this.track(tab);
                    }
                    break;
                case 'activate':
                    this.active[message.windowId] = message.spaceId;
                    // A panel starting up reports its window's space; only a real switch is "last used".
                    if (!message.initial) this.lastActive = message.spaceId;
                    break;
                case 'hide':
                    hideTabs(this.spaces, message.tabIds);
                    for (const id of message.tabIds) this.hidden.add(id);
                    break;
                case 'unhide': {
                    for (const id of message.tabIds) this.hidden.delete(id);
                    const target = this.spaces.find(s => s.id === message.spaceId);
                    // Nothing to show again: leave the list in the order it is in now.
                    if (!message.tabIds.length) break;
                    if (target) {
                        const pinnedIds = new Set(
                            (await chrome.tabs.query({})).filter(tab => tab.pinned).map(tab => tab.id)
                        );
                        showTabs(this.spaces, target, { tabIds: message.tabIds, order: message.order, pinnedIds });
                    } else {
                        // The space is gone: the tabs join whichever space a new tab would.
                        for (const tab of await chrome.tabs.query({})) {
                            if (message.tabIds.includes(tab.id)) this.track(tab);
                        }
                    }
                    break;
                }
                case 'assignPin':
                case 'assign': {
                    const target = this.spaces.find(s => s.id === message.spaceId);
                    if (target) {
                        this.provisional.delete(message.tabId);
                        for (const space of this.spaces)
                            for (const key of sections) space[key] = space[key].filter(id => id !== message.tabId);
                        target[
                            message.action === 'assignPin'
                                ? 'pinnedTabs'
                                : message.pinned
                                  ? 'spaceBookmarks'
                                  : 'temporaryTabs'
                        ].push(message.tabId);
                    }
                    break;
                }
                case 'import': {
                    const groups = await chrome.tabGroups.query({ windowId: message.windowId });
                    const tabs = await chrome.tabs.query({ windowId: message.windowId });
                    for (const group of groups) {
                        let name = group.title || 'Imported space';
                        const base = name;
                        for (let i = 2; this.spaces.some(s => s.name === name); i++) name = `${base} ${i}`;
                        const space = await this.makeSpace(name, group.color);
                        const ids = tabs.filter(t => t.groupId === group.id && !t.pinned).map(t => t.id);
                        for (const old of this.spaces)
                            for (const key of sections) old[key] = old[key].filter(id => !ids.includes(id));
                        space.temporaryTabs = ids;
                        this.spaces.push(space);
                    }
                    await chrome.storage.local.set({ tabGroupImportDismissed: true });
                    break;
                }
                default:
                    throw new Error('Unknown space action');
            }
            if (message.action !== 'get') await this.persist();
            return clone(this.spaces);
        });
    }
    install() {
        const handle = operation =>
            this.run(async () => {
                await operation();
                await this.persist();
            }).catch(console.error);
        chrome.tabs.onCreated.addListener(tab => handle(() => this.track(tab)));
        chrome.tabs.onUpdated.addListener((id, change, tab) => {
            if (change.url || change.pinned !== undefined) handle(() => this.track(tab));
        });
        chrome.tabs.onRemoved.addListener((id, info) =>
            handle(() => {
                const record = this.snapshotByTab.get(id);
                // A tab Clean All is hiding is in no space now; the old record must not bring it back.
                if (
                    info?.isWindowClosing &&
                    record &&
                    !this.hidden.has(id) &&
                    this.spaces.some(s => s.id === record.spaceId)
                )
                    this.restoreQueue.push(record);
                this.snapshotByTab.delete(id);
                this.provisional.delete(id);
                this.hidden.delete(id);
                this.linkTails.delete(id);
                this.moveTailsOff(id);
                for (const space of this.spaces) {
                    for (const key of sections) space[key] = space[key].filter(t => t !== id);
                    if (space.lastTab === id) delete space.lastTab;
                }
            })
        );
        chrome.tabs.onReplaced.addListener((added, removed) =>
            handle(() => {
                for (const space of this.spaces) {
                    for (const key of sections) space[key] = space[key].map(id => (id === removed ? added : id));
                    if (space.lastTab === removed) space.lastTab = added;
                }
            })
        );
        chrome.tabs.onActivated.addListener(info =>
            handle(async () => {
                // Coming back to a tab starts its links again directly beneath it.
                this.linkTails.delete(info.tabId);
                const { perSpacePinnedFavorites = false } = await chrome.storage.sync.get('perSpacePinnedFavorites');
                const space = spaceForActivation(this.spaces, info.tabId, perSpacePinnedFavorites);
                if (!space) return;
                space.lastTab = info.tabId;
                this.active[info.windowId] = space.id;
                // A tab changing in a window you are not looking at is not the space in use.
                if (
                    await chrome.windows.get(info.windowId).then(
                        win => win.focused,
                        () => false
                    )
                )
                    this.lastActive = space.id;
            })
        );
        chrome.windows.onFocusChanged.addListener(windowId =>
            handle(() => {
                if (this.spaces.some(s => s.id === this.active[windowId])) this.lastActive = this.active[windowId];
            })
        );
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && (changes.pinnedTabStatesById || changes.tabNameOverridesById)) handle(() => {});
            if (area === 'sync' && changes.syncTabGroups) handle(() => {});
            if (area === 'sync' && changes.perSpacePinnedFavorites)
                handle(() => {
                    this.perSpacePinnedFavorites = changes.perSpacePinnedFavorites.newValue === true;
                });
            if (area === 'sync' && changes.invertTabOrder)
                handle(() => {
                    this.invertTabOrder = changes.invertTabOrder.newValue !== false;
                });
            if (area === 'sync' && changes.defaultSpaceName)
                handle(() => {
                    this.defaultSpaceName = changes.defaultSpaceName.newValue || 'Home';
                });
        });
        // Tab-strip changes only request a projection; they never alter the model.
        let syncTimer;
        const scheduleSync = () => {
            clearTimeout(syncTimer);
            syncTimer = setTimeout(
                () => this.run(() => syncSpaceGroups(this.spaces, this.active)).catch(console.error),
                200
            );
        };
        chrome.tabs.onMoved.addListener(scheduleSync);
        chrome.tabs.onUpdated.addListener((id, change) => {
            if (change.groupId !== undefined) scheduleSync();
        });
        chrome.tabGroups.onRemoved.addListener(scheduleSync);
        chrome.tabGroups.onUpdated.addListener(scheduleSync);
        this.run(() => {}).catch(console.error);
    }
}
