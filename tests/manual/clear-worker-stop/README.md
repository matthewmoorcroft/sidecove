# Clear: a worker stop as the Undo window ends

Checks that stopping the service worker at the moment Clear's 8 seconds end never leaves the cleared
tabs open, hidden and muted. `finish()` in `src/background/pending-clean.js` closes the tabs first and
forgets the saved batch last, so a worker that stops in between still finds the record and closes them
when it wakes. The real gap is a few milliseconds and cannot be hit on purpose, so the check widens it
with a build that waits 3 seconds there and stops the worker once, 1.5 seconds into that wait. It does not run with `npm run test:e2e`.

Run it before a release that touches `pending-clean.js`:

1. `git apply tests/manual/clear-worker-stop/widen-gap.patch`
2. `npm run build`, then copy `dist/` to a folder outside the repo (for example `/tmp/sidecove-widened`).
3. `git apply -R tests/manual/clear-worker-stop/widen-gap.patch` and `npm run build` again.
4. Run it against the copy:

   ```
   SIDECOVE_TEST_EXTENSION_PATH=/tmp/sidecove-widened \
     NODE_OPTIONS='--experimental-vm-modules' npx jest --config jest.config.js \
     --rootDir . --testMatch '**/tests/manual/clear-worker-stop/*.manual.js'
   ```

It passes when no cleared tab is left open. If `finish()` forgets the batch before it closes the tabs,
it fails: both tabs stay open, hidden and muted, with no record left to close them.
