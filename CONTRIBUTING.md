# Contributing to Sidecove

Thanks for helping. This page covers setting up, building, testing and releasing. User documentation lives in [README.md](README.md).

## Setup

You need Node.js 24 or later (the version in `.nvmrc`, which CI uses), npm, Git and Google Chrome.

```bash
git clone https://github.com/matthewmoorcroft/sidecove.git
cd sidecove
npm ci
```

## Build and load

- `npm run build`: production build to `dist/`.
- `npm run dev`: development build to `dist-dev/`, with source maps, rebuilt on every change.
- `npm run build:zip`: production build, then `sidecove-extension.zip` from `dist/`.
- `npm run zip`: package an existing `dist/`.
- `npm run clean`: remove `dist/`, `dist-dev/` and zip files.
- `npm run info`: show versions and which build folders exist.

To try a build, open `chrome://extensions/`, turn on **Developer mode**, click **Load unpacked** and choose `dist/` or `dist-dev/`. After rebuilding, click the reload icon on the Sidecove card. The service worker's console is linked from the same card; the side panel and the settings page have their own DevTools.

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

Releases are built by GitHub Actions from a version tag. Run the release script on an up-to-date `main`: it commits the version bump there and pushes `main` and the tag.

```bash
npm run release patch   # 1.2.0 -> 1.2.1
npm run release minor   # 1.2.0 -> 1.3.0
npm run release 2.0.0   # a specific version
```

The script updates the version in `package.json` and `manifest.json`, builds and zips the extension, commits, tags `vX.Y.Z` and pushes. The `Release` workflow then builds the zip and its SHA-256 checksum and publishes a GitHub release. Follow it on the [Actions tab](https://github.com/matthewmoorcroft/sidecove/actions).
