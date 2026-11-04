# Changelog

## Unreleased (1.3.0)

- **New tabs you leave empty close by themselves, as in Arc (asked for in #sidecove).** Cmd+T and the "+ New Tab" row work as before, with Chrome's own address bar and your search engine. If you then switch to another tab without typing an address or opening a site, the empty tab closes, and you stay on the tab you chose. It never closes a window's last tab, a pinned tab, a favorite, or a tab that has already been to a site. It is on by default; turn it off at Settings → Close new tabs you leave empty. Chrome does not tell extensions about text typed in the address bar but not yet sent, so a tab with only unsent text in it still counts as empty. It needs no new permission.
- **Install instructions point to the Chrome Web Store:** the README now sends everyone to the store, and keeps the unpacked install for developers and testers in its own section. Users will not notice any change in the extension.
- **Issue templates:** new issues now start from a Bug Report or a Feature Request form, as the README already said. The bug form asks for the Sidecove and Chrome versions, the operating system and the settings that matter; the feature form asks you to confirm that Sidecove only adds features that work with the permissions it has today. Users will not notice any change in the extension.
- **Optional favorites per space:** enable Settings → Separate favorites for each space to show only the current space’s top-bar favorites. Favorites stay shared across spaces by default. Switching modes preserves pins and their space assignments, including across restarts.
- **Most recently used tab shortcut:** a new command, "Switch to the most recently used tab in this space", jumps back to the tab you used last in the current space, as Ctrl+Tab does in Arc. Press it again within about 0.8 seconds to go further back through the tabs you used; each space keeps its own order. Chrome keeps Ctrl+Tab for itself, so the command has no default key: assign one at chrome://extensions/shortcuts. It needs no new permission, and the order is kept in memory for the browser session only.
- **Dark mode has its own space colours (issue #14).** In dark mode each space is now a dark surface tinted with its colour (charcoal, navy, wine, olive-brown, forest, plum, purple, teal), instead of the mid-tone colours of before, so the light text is easy to read on every one; hovered rows are lightened a little so they still show on the darker ground. Settings → Colors now has a Light and a Dark picker for each colour, each with its own Reset, and the sidebar uses the one that matches your system theme. A colour you changed before keeps working as its light value, and a colour with no dark value uses the new built-in dark colour. Light mode looks the same as before.
- **Pinned tab matching setting:** hosts listed under Settings → Pinned tab matching (e.g. `localhost:6969`) keep their query string when matching pinned tabs, so URLs like `localhost:6969/?focused=<chat id>` pin as one entry per URL instead of collapsing into a single pinned tab. Other hosts keep the old behavior.
- **New Tab moved under the divider, as in Arc:** the "+ New Tab" row used to sit at the bottom of the panel, below every tab. It now sits directly under the line that separates your pinned tabs from your open tabs (beside Clear), above the open tabs, in each space. Tab order, including the Invert tab order setting, is unchanged. The "Copied" toast now appears just above the space bar.
- **Clean All is now "↓ Clear", as in Arc (issue #6):** the thin line between your pinned tabs and your open tabs now ends in a small, muted "↓ Clear" at its right end, directly above New Tab, in place of the "Clean All" button. It does what Clean All did: it closes the open tabs of the space, keeps them in the archive and offers Undo. It can be reached with the keyboard (Tab, then Enter or Space), is read out as "Clear open tabs", and is easy to read in light and dark mode.
- **Repository cleanup, part 1 (housekeeping):** removed the outdated Cursor rules, stale test notes and five unused development packages; developer documentation moved to CONTRIBUTING.md; CI runs on one current Node version and on every pull request, and the upgrade test now starts from the latest release. The extension itself, its permissions and your data are unchanged.
- **Repository cleanup, part 2 (layout):** the source code moved into `src/`, one folder per part of the extension (background, sidebar, settings, onboarding, offscreen, shared), and AGENTS.md (with CLAUDE.md linking to it) sets out where new code goes and what must not change. The built extension is the same file for file.
- **Smaller download:** the extension package is about 1 MB instead of 2.4 MB. Every image and the font used to ship twice, and an old, unused welcome page and its pictures shipped too; both are gone. Nothing you see changes.
- **Repository cleanup, part 4 (test seams):** auto-archive and the first-run guide's install and update rules moved out of the background script into their own modules, which their tests now load directly. Behaviour is unchanged.
- **Repository cleanup, part 5 (lint and format):** ESLint checks the code, including which parts of the extension may import which, and Prettier formats it; CI runs both. Two files were renamed to the kebab-case used everywhere else. Users will not notice any change.
- **Repository cleanup, part 6 (releases):** a release is now a pull request, and the tag comes after it merges. The release build runs the tests, checks the version, takes its notes from this changelog, and publishes a checksum you can verify with `sha256sum -c` and a build provenance record. Users will not notice any change in the extension.
- **Easier to find from Arc:** Sidecove's name and description now say it brings Arc-style spaces, pinned tabs and favourites to Chrome for people moving from Arc, and the Chrome Web Store text says it is not made by or affiliated with The Browser Company. The longer name also shows in Chrome's extensions page and menus. Nothing else in the extension changed: no permission, feature or behaviour.
- **End-to-end tests run on the laptop, not in CI:** `npm run test:e2e:local` builds the earlier releases for the upgrade test, runs the suite with Puppeteer's own Chrome and prints one line to paste into the pull request, whose template now asks for it. Users will not notice any change.
- **Closing a tab keeps you in your space:** when you close the tab you are on, Sidecove now stays in the same space and shows the next tab down its list (the one above if you closed the last), as Arc does. Before, Chrome could pick a tab from another space, such as the one you had come from, and Sidecove followed it there. If the space has no other tab, it opens a New Tab in that space. Clicking a tab of another space still switches to it. It needs no new permission.
- **Next and previous tab in space now follow the order you see (issue #5):** with "Show new tabs at the top" on, the two shortcuts walked the open tabs in the opposite direction to the panel. They now go down and up the list as it is shown, favorites first, whichever way new tabs are listed and whether or not spaces sync to Chrome tab groups. No new permission.
- **End-to-end tests pass on a Mac with its display asleep:** about 25 browser tests used to time out whenever a local run went on while the Mac's display was off, because the test Chrome stopped drawing frames. The tests now launch Chrome so that it keeps drawing. Users will not notice any change in the extension.

## 1.2.0

An Arc-style space bar, favorites that only own the tab they opened, a clearer drop indicator and a polish pass, with no new permissions.

- **The space bar works like Arc's.** Each space shows as its icon, or a dot if it has none; the current space is full strength and the name shows on hover, so every space stays in view. Prefer names? Settings → Space bar shows → Names gives full-name chips, which scroll sideways when they don't all fit and fade the edge that has more.
- **Monochrome space symbols, as in Arc.** The icon picker leads with 58 line symbols drawn in one ink tinted by the space colour, with emoji below. Its search box now finds both by name or keyword ("music", "travel", "money"), and a typed emoji still works. The symbols' shapes come from Lucide (ISC licence, see THIRD_PARTY_NOTICES.md) and ship inside the extension.
- **Switching spaces is instant.** The background and every row take the new space's colours in the same frame, instead of parts of the panel briefly showing as highlighted patches.
- **Right-click a space** in the bar for Change Space Icon, Rename Space, Theme Color, New Folder and Delete Space.
- **A favorite only owns the tab it opened.** Clicking a closed favorite always opens it in its own new tab. A tab you opened yourself is never taken over or linked to a favorite, even when it shows the same page, so two links never show as one favorite.
- **Links from other apps open in the space you're using.** A link opened from Slack, Mail or another app used to land in the first space whenever it arrived in a window Sidecove had no space for yet, such as a second window. It now opens in the space you used last; the Default space setting applies only when there isn't one yet.
- **Collapsed favorites stay hidden.** Collapsing a space's Favorites section used to leave its links invisible but still clickable, so clicking the empty space below could open one, and Tab could still reach them. They now take no clicks or keyboard focus while collapsed.
- **New Tab looks like Arc's:** a plain row with a grey plus and text, no button box, lined up with the tabs and the same height as a tab row.
- **Close buttons follow Arc:** an open favorite shows − (close the tab, keep the favorite); a closed favorite shows × (remove it); ordinary tabs keep ×.
- **Copy current tab URL** now has a default shortcut, ⌥⇧C (Alt+Shift+C). Chrome will not give an extension ⌘⇧C as a default because its developer tools use it, but you can choose it at chrome://extensions/shortcuts; the install guide's Shortcuts step now says so for anyone coming from Arc.
- **Drop indicator:** while you drag a tab, favorite or folder, one line shows exactly where it will land. The line starts at the indent of the level it lands at, and the folder it would go into is highlighted, so a top-level drop and a drop into a nested folder look clearly different. It also shows at the end of a list, where there used to be no line.
- **Favorites grid:** tiles fill the row while there are few and wrap at an even size, so a lone tile on a new row no longer stretches across it (upstream issue #42).
- **Menus:** the tab menu and the space menu share one rounded, shadowed look with tighter rows and a short pop-in. In dark mode the space menu and its colour swatches are dark too.
- **Hover and press:** rows, folder headers, favorites and New Tab respond with a clearer hover and a slight press. In dark mode, hovering a row or folder header darkens it so its title stays readable. The active tab and the active space chip stand out more clearly.
- **Keyboard:** Tab no longer moves focus into the hidden New Space form or archive list, which used to scroll the whole sidebar out of place. Close, remove and folder toggle buttons show when they have keyboard focus.
- Animations respect the system's reduce-motion setting.
- **Guided tour:** Next and the other tour buttons now have light text on a deep fill of the space colour, at least 4.5:1 contrast in every space colour in light and dark, so Next no longer looks disabled. Stepping through the tour no longer flashes a scroll bar under the card.
- The product is called Sidecove throughout, including the tour's "Make Sidecove feel like you". Existing spaces, favorites and settings carry over unchanged.
- The welcome screen points feedback to [GitHub Issues](https://github.com/matthewmoorcroft/sidecove/issues).

## 1.1.0

Closer to Arc, with no new permissions.

- **Switch spaces from the keyboard:** Ctrl+1 to Ctrl+8 for a numbered space, Ctrl+9 for the last one, and Ctrl+Shift+[ or ] to step through them while the sidebar has focus. Next space, Previous space and Switch to space 1-9 can be bound anywhere in Chrome at chrome://extensions/shortcuts.
- **Mouse side buttons** switch spaces from anywhere in the sidebar, not just over the space chips.
- **Search tabs** (Cmd or Ctrl+F): find open tabs, pinned tabs and favorites across every space by title or address.
- **Move things between spaces:** drop a tab, favorite, folder or pinned tab on a space chip.
- **Select several tabs** with Cmd or Ctrl click and Shift click, then move, pin, archive, close or put them in a new folder. Drag a selection to move it together.
- **Make a folder by dropping:** hold a tab over a favorite for a moment and drop it, and both go into a new folder.
- **Tab menu:** Duplicate Tab, Copy Link, Mute or Unmute Tab and Rename Tab.
- **Sound:** tabs that play sound show a speaker; click it to mute or unmute.
- **Space icons:** give each space an emoji. When the chips no longer fit, they shrink to icons or initials, and the active chip stays in view.
- **Clean All** now archives the tabs it closes and offers Undo.
- Custom colours from Settings now show in the colour pickers too.
- The Varela Round font ships with the extension, so the sidebar and settings no longer load it from Google Fonts. Nothing is sent anywhere.

## 1.0.1

- Removed the unused `scripting` permission. Copy current URL works as before, through Chrome's offscreen clipboard.
