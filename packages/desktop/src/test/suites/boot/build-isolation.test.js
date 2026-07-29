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

module.exports = {
  type: 'group',
  layer: 'boot',
  description: 'boot build isolation — the project dist/ is never written',
  timeout: 15000,
  tests: [
    {
      description: 'the boot build left the project\'s real dist/ byte-for-byte unchanged',
      inspect: async ({ expect, projectRoot, frameworkDistRoot, distSnapshotBefore }) => {
        const path = require('path');
        const distSnapshot = require(path.join(frameworkDistRoot, 'test', 'utils', 'dist-snapshot.js'));

        const before = distSnapshotBefore.split('\n').filter(Boolean);
        const after  = distSnapshot(path.join(projectRoot, 'dist')).split('\n').filter(Boolean);

        // Compare both directions so a deletion counts as a touch too, and report the
        // file names rather than two multi-megabyte fingerprints.
        const beforeSet = new Set(before);
        const afterSet  = new Set(after);
        const touched   = [...after.filter((line) => !beforeSet.has(line)), ...before.filter((line) => !afterSet.has(line))]
          .map((line) => line.split('\t')[0]);

        expect([...new Set(touched)].sort().join(', ')).toBe('');
      },
    },

    {
      description: 'the app booted from the staged test root, whose dist/ holds the build',
      inspect: async ({ expect, projectRoot, appRoot }) => {
        const fs = require('fs');
        const path = require('path');
        const { app } = require('electron');

        expect(appRoot).toBe(path.join(projectRoot, '.omega', 'test-app'));
        expect(app.getAppPath()).toBe(appRoot);
        expect(fs.existsSync(path.join(appRoot, 'dist', 'main.bundle.js'))).toBe(true);
      },
    },
  ],
};
