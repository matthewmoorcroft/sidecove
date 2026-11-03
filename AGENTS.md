# Sidecove: rules for contributors and coding agents

Sidecove is a Manifest V3 Chrome extension that shows tabs in Chrome's side panel, grouped
into spaces with pinned tabs and favourites. It is published on the Chrome Web Store and its
permissions were approved in a security review. Plain JavaScript (ES modules), built with
Vite, no framework, no runtime dependencies.

## Commands

- `npm ci`: install (CI uses Node from `.nvmrc`).
- `npm run build`: production build to `dist/`. `npm run dev`: watch build to `dist-dev/`.
- `npm run test:unit`: fast unit tests (`node:test`), no browser. Run before every commit.
- `npm run test:e2e`: builds, then drives real Chrome with Puppeteer. Slow; CI runs it on every PR.
- `npm run zip`: packages `dist/` as `sidecove-extension.zip`.

## Where code goes

- `src/<context>/` holds code that runs in one extension context:
  `background/` (service worker, no DOM), `sidebar/` (side panel), `options/`, `onboarding/`,
  `offscreen/`. `content/` is reserved; creating it needs a security review (see Permissions).
- `src/shared/` holds only code imported by two or more contexts. It must not touch
  `document` or `window` at import time, because the service worker imports it.
  `shared/styles.css` is the stylesheet the side panel and the settings page both load.
- A new sidebar feature gets its own folder, `src/sidebar/features/<feature>/`. The entry file
  `src/sidebar/sidebar.js` only wires features together: do not add feature logic to it, and
  when you change logic in it, move that logic out into its feature's folder.
- Put pure logic (no `chrome.*`, no DOM) in its own module so it can be unit tested. Pass
  `chrome` in as an argument where a module needs it, as `background/url-copy.js` does.
- HTML pages live at the top of `src/` and build to the top of `dist/`. Their file names are
  public URLs: do not rename them.
- Images and the font live in `assets/` at the repository root and are copied to `dist/assets/`.
- Imports flow inwards only: a context may import `shared/`; `shared/` never imports a context;
  contexts never import each other.
- Prefer a new small file over growing a large one. When a change adds to a file of more than
  about 400 lines, split the part it touches out by feature in the same change.

## Invariants (do not break these)

- **Permissions:** never add a permission, host permission, content script, `externally_connectable`
  or remote code without saying so in the PR title. That change needs a new security review.
- **Privacy:** no network requests, analytics or remote fonts or scripts. `PRIVACY.md` must stay true.
- **Space model:** the service worker is the only writer (`shared/space-store.js`). Panels send
  patches through `shared/space-client.js` and never write `spaces` to storage themselves.
- **Durable data:** favourites and spaces live under the bookmark folder titled `ROOT_FOLDER_TITLE`
  (`Sidecove`). Auto-archive must never close a protected favourite.
- **Stored keys and IDs are contracts:** storage keys, bookmark folder names, extension page URLs
  and the command names in `manifest.json` survive upgrades. Renaming a command resets users'
  shortcuts; renaming a key or URL loses data. Change one only with a migration and an upgrade test.
- **Messages:** in `chrome.runtime.onMessage`, return `true` or a Promise only for messages you
  handle. Never return a Promise for unrelated messages.
- **Clipboard:** copy through the offscreen document, never by injecting into pages.

## Tests

- Unit tests mirror `src/`: `src/sidebar/selection.js` -> `tests/unit/sidebar/selection.test.js`.
  A new module with logic gets a unit test there. Tests import modules; do not read source
  files as text.
- A change users can see gets an end-to-end test in `tests/e2e/`. Shared helpers go in
  `tests/e2e/helpers/`.
- `tests/e2e/upgrade.test.js` upgrades from the latest release. Keep it green; it is the proof that
  user data survives.
- Refactors change no assertions. If a refactor needs a test change beyond import paths, it is
  not a refactor; split it out.
- `tests/manual/` holds the checklists to run on the built zip before a release.

## Style

- ES modules, `const`/`let`, async/await. New file names are kebab-case.
- Use `Logger` from `shared/logger.js`, not `console`, so debug logging stays behind the setting.
- Comments explain why, not what. Keep them short.

## Changes and releases

- Every pull request adds a line to `CHANGELOG.md` under `Unreleased`, in plain words; say so
  when users will not notice the change.
- Version numbers change only in a release, in `package.json` and `manifest.json` together
  (`npm run release`, see `CONTRIBUTING.md`).
- Third-party code or assets: add the licence to `THIRD_PARTY_NOTICES.md` in the same change.
- Keep `README.md` (users), `CONTRIBUTING.md` (developers) and this file in step with the code.
