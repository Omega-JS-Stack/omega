// #110 — the boot-test build must never write the project's real dist/.
//
// `npm start`'s watcher owns dist/. When the boot runner built there too, a concurrent dev
// app and boot-test run interleaved writes and either side could load a half-written
// bundle — a race that presents as a code bug. The runner now builds into a staged app
// root (`<project>/.omega/test-app`) and boots THAT.
//
// The proof is taken across the real run: the runner fingerprints `<project>/dist` (path +
// size + mtime per file) before the build and ships it in the boot spec as
// `distSnapshotBefore`; this test re-fingerprints the same tree from inside the booted app.
// An untouched tree — including one that never existed — matches exactly.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'group',
  layer: 'boot',
  description: 'boot build isolation — the project dist/ is never written',
  timeout: 15000,
  tests: [
    {
      name: 'the boot build left the project\'s real dist/ byte-for-byte unchanged',
      run: async (ctx) => {
        const path = require('path');
        const distSnapshot = require(path.join(ctx.frameworkDistRoot, 'test', 'utils', 'dist-snapshot.js'));

        const before = ctx.distSnapshotBefore.split('\n').filter(Boolean);
        const after  = distSnapshot(path.join(ctx.projectRoot, 'dist')).split('\n').filter(Boolean);

        // Compare both directions so a deletion counts as a touch too, and report the
        // file names rather than two multi-megabyte fingerprints.
        const beforeSet = new Set(before);
        const afterSet  = new Set(after);
        const touched   = [...after.filter((line) => !beforeSet.has(line)), ...before.filter((line) => !afterSet.has(line))]
          .map((line) => line.split('\t')[0]);

        ctx.expect([...new Set(touched)].sort().join(', ')).toBe('');
      },
    },

    {
      name: 'the app booted from the staged test root, whose dist/ holds the build',
      run: async (ctx) => {
        const fs = require('fs');
        const path = require('path');
        const { app } = require('electron');

        ctx.expect(ctx.appRoot).toBe(path.join(ctx.projectRoot, '.omega', 'test-app'));
        ctx.expect(app.getAppPath()).toBe(ctx.appRoot);
        ctx.expect(fs.existsSync(path.join(ctx.appRoot, 'dist', 'main.bundle.js'))).toBe(true);
      },
    },
  ],
});
