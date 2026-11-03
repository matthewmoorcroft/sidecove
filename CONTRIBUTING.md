# Contributing to Sidecove

Thanks for helping. This page covers setting up, building, testing and releasing. User documentation lives in [README.md](README.md).

## Setup

You need Node.js 24 or later (the version in `.nvmrc`, which CI uses), npm, Git and Google Chrome.

```bash
git clone https://github.com/matthewmoorcroft/sidecove.git
cd sidecove
npm ci
```

## Where things live

Extension code is in `src/`, split by the extension context it runs in: `background/` (the service worker), `sidebar/`, `options/`, `onboarding/` and `offscreen/`, with `shared/` for modules two or more of them import. The HTML pages sit at the top of `src/`. Images and the font are in `public/assets/`, copied unchanged to `dist/assets/`; refer to them by absolute path, such as `/assets/icon.png`. Unit tests in `tests/unit/` mirror the `src/` folders. [AGENTS.md](AGENTS.md) has the full rules for where new code goes and what must not change; `CLAUDE.md` links to it.

## Build and load

- `npm run build`: production build to `dist/`.
- `npm run dev`: development build to `dist-dev/`, with source maps, rebuilt on every change.
- `npm run verify:dist`: check that every page, stylesheet, script and manifest reference in `dist/` points at a file in the build.
- `npm run build:zip`: production build, then `sidecove-extension.zip` from `dist/`.
- `npm run zip`: package an existing `dist/`.
- `npm run clean`: remove `dist/`, `dist-dev/` and zip files.
- `npm run info`: show versions and which build folders exist.

To try a build, open `chrome://extensions/`, turn on **Developer mode**, click **Load unpacked** and choose `dist/` or `dist-dev/`. After rebuilding, click the reload icon on the Sidecove card. The service worker's console is linked from the same card; the side panel and the settings page have their own DevTools.

## Lint and format

- `npm run lint`: ESLint. It also enforces the folder boundaries in AGENTS.md: a context imports only its own folder and `src/shared/`. CI fails on errors. The files that had warnings when linting was added keep them as warnings, listed in `eslint.config.js`, to tidy when you next touch them; anywhere else they are errors.
- `npm run format`: Prettier for JavaScript and CSS (`npm run format:check` is what CI runs). Page markup, JSON, Markdown and YAML are formatted by hand.
- One commit reformatted the whole codebase. To keep `git blame` useful, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

## Tests

- `npm run test:unit`: unit tests with Node's built-in runner, no browser. They take a few seconds; run them before every commit.
- `npm run test:e2e` (or `npm test`): builds, then drives real Chrome with Puppeteer and Jest. Slow; CI runs it on every pull request. `HEADED=true npm run test:e2e` shows the browser. See [tests/README.md](tests/README.md).
- `tests/e2e/upgrade.test.js` installs earlier releases and updates each to your build. CI builds the latest release and 1.1.0; locally, set `SIDECOVE_PREVIOUS_BUILD` to one or more releases' `dist/` folders (separated by `:`, or `;` on Windows), or it relabels your own build as an old version.
- `tests/manual/` holds the checklists for a hands-on pass in Chrome before a release.

## Pull requests

1. Fork the repository and create a branch, for example `git checkout -b feature/your-feature-name`.
2. Keep each pull request to one change. Follow the style of the code around it and add or update tests.
3. Add a line to `CHANGELOG.md` under `Unreleased`, in plain words. If users will not notice the change, say so in that line.
4. Open the pull request against `main`, describe what changed and why, and link any related issue. CI must pass.

Never add a permission, host permission or content script without saying so in the pull request title: Sidecove's permissions were approved in a security review, and a new one needs another.

## Releases

A release is a pull request; the tag comes after it merges, and GitHub Actions builds and publishes from the tag.

1. On an up-to-date `main`, run `npm run release minor` (or `patch`, `major`, or a version such as `2.0.0`). It creates the branch `release/vX.Y.Z`, sets the version in `package.json`, `package-lock.json` and `manifest.json`, renames the CHANGELOG's `Unreleased` section to `X.Y.Z` and starts a new, empty `Unreleased` above it. If that heading names a planned version, as in `## Unreleased (1.3.0)`, it stops unless the new version is the same. Nothing is pushed.
2. Push the branch and open a pull request into `main`. Read the CHANGELOG section as release notes: users will see it.
3. Run the checklists in `tests/manual/` on the zip from the pull request's **Release dry run** check (its `release` artifact).
   Also decide whether the release changes how Sidecove looks: colours, layout, icons, spacing, or new or moved controls. Write the answer in the pull request description.
   - If it does, take new screenshots from that build and replace the Chrome Web Store screenshots and the images in `docs/` that the README shows, before the release is submitted to the store. Do not submit with the old ones.
   - If it does not, say "no visual change, screenshots unchanged" in the pull request description.
4. When CI passes and the pull request merges, run `npm run release:tag` on the updated `main`. It checks that the versions agree, then tags `vX.Y.Z` and pushes the tag.
5. The `Release` workflow checks that the tag matches `manifest.json` and `package.json` and is on `main`, runs the unit tests, builds and zips the extension, writes `sidecove-extension.zip.sha256` (check it with `sha256sum -c`), records build provenance (check it with `gh attestation verify sidecove-extension.zip --repo matthewmoorcroft/sidecove`), and publishes a GitHub release whose notes are that CHANGELOG section. Follow it on the [Actions tab](https://github.com/matthewmoorcroft/sidecove/actions).
6. Submitting to the Chrome Web Store is a manual step in the developer dashboard, after the GitHub release exists. Upload the zip, paste the title, summary and description from `docs/store-listing.txt`, and check the screenshots as step 3 says. A pull request that adds or changes a feature edits `docs/store-listing.txt` in the same change; at release, check it against the CHANGELOG section and fix anything stale before pasting.

Every pull request also runs the workflow's build as a **Release dry run**, so a broken release shows up before anything is tagged. Release tags cannot be moved or deleted once pushed. Only `vX.Y.Z` tags start a release: Chrome versions are numbers only, so there are no `-rc` or `-beta` prereleases.
