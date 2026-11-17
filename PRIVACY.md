# Sidecove privacy policy

Last updated: 16 November 2026

Sidecove is a Chrome extension that shows your tabs in a vertical sidebar and organises them into spaces.

## What Sidecove reads

- **Tabs:** the title, URL and favicon of your open tabs, so it can show, switch, move, open and close them in the sidebar.
- **Bookmarks:** the bookmarks inside its own **Sidecove** folder, where your spaces, folders and pinned tabs are stored. It also lists your other bookmarks to show them in the sidebar.
- **Tab groups:** only when you turn on **Sync spaces to Chrome tab groups**.

## Where your data is kept

- Spaces, folders and pinned tabs are kept as Chrome bookmarks.
- Settings, the state of each space and the saved list of top-bar favorites (their addresses and titles) are kept in `chrome.storage`, in your browser.
- When you close a window, the titles and addresses of its open pages are kept as closed links (at most 100) in `chrome.storage.local`, on this computer only, so you can open them again. Private windows are never kept. A link is removed when you open it, remove it, clear it or archive it; clearing and archiving move it to the Archived list, which is kept in the same place.
- If you are signed in to Chrome with sync turned on, Chrome syncs your bookmarks and some settings through your Google account, as it does for any bookmark or extension setting.

## What Sidecove does not do

- It does not send your data to any server, ours or anyone else's.
- It has no analytics, no tracking, no advertising and no account.
- It does not sell, share or transfer your data, and it does not use it for anything other than running the sidebar.

## Contact

Questions about this policy: open an issue at https://github.com/matthewmoorcroft/sidecove/issues.
