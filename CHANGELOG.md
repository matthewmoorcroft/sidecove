# Changelog

## 1.2.0

A clearer drop indicator and a polish pass, with no new permissions.

- **Drop indicator:** while you drag a tab, favorite or folder, one line shows exactly where it will land. The line starts at the indent of the level it lands at, and the folder it would go into is highlighted, so a top-level drop and a drop into a nested folder look clearly different. It also shows at the end of a list, where there used to be no line.
- **Favorites grid:** tiles fill the row while there are few and wrap at an even size, so a lone tile on a new row no longer stretches across it (upstream issue #42).
- **Menus:** the tab menu and the space menu share one rounded, shadowed look with tighter rows and a short pop-in. In dark mode the space menu and its colour swatches are dark too.
- **Hover and press:** rows, folder headers, favorites and New Tab respond with a lighter hover and a slight press. The active tab and the active space chip stand out more clearly.
- **Space switch:** the new space fades in. Chips that still overflow fade out at the right edge only while they overflow.
- **Keyboard:** Tab no longer moves focus into the hidden New Space form or archive list, which used to scroll the whole sidebar out of place. Close, remove and folder toggle buttons show when they have keyboard focus.
- Animations respect the system's reduce-motion setting.
- **Guided tour:** Next and the other tour buttons now have light text on a deep fill of the space colour, at least 4.5:1 contrast in every space colour in light and dark, so Next no longer looks disabled. Stepping through the tour no longer flashes a scroll bar under the card.
- The product is called Sidecove throughout, including the tour's "Make Sidecove feel like you". Existing spaces, favorites and settings carry over unchanged.

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
