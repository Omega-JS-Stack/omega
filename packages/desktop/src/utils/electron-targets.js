// The esbuild targets the three bundles compile to — read from the PINNED
// Electron itself ([#737](https://github.com/Omega-JS-Stack/omega/issues/737)).
//
// webpack encoded this as `target: 'electron-main' | 'electron-preload' | 'web'`
// and guessed a conservative syntax floor from its own tables. esbuild splits
// the same fact into `platform` (which the build task states) and `target` (the
// syntax floor), and the floor is a REAL number: the Node the main process runs
// and the Chromium the renderer runs, both compiled into the binary a consumer
// has pinned. Asking the binary is the only answer that stays right when the
// consumer bumps Electron — a hand-kept Electron→Node/Chromium table drifts on
// every release, and the releases feed
// ([electron-node-version.js](electron-node-version.js)) needs a network a
// build must never need.
//
// `ELECTRON_RUN_AS_NODE` runs the binary as plain Node: no window, no dock icon,
// no focus stolen. The probe costs one spawn per build and is memoized per
// binary path.
//
// A binary that cannot be run is an EXPECTED external condition, not a broken
// invariant: a CI job with ELECTRON_SKIP_BINARY_DOWNLOAD set has a package and
// no executable. That build gets `null` targets, which the caller reads as "no
// syntax floor" (esbuild's default), and a warn line saying so — never a
// silently-invented version.

const { execFileSync } = require('child_process');

const cache = new Map();

/**
 * The pinned Electron's own Node and Chromium versions, as esbuild targets.
 * @param {string} binary - path to the Electron executable (`require('electron')`)
 * @param {object} [options]
 * @param {object} [options.logger] - logger with `warn` (a failed probe explains itself)
 * @returns {{ node: string|null, chrome: string|null, electron: string|null }} esbuild target strings
 */
module.exports = function electronTargets(binary, options) {
  if (cache.has(binary)) return cache.get(binary);

  let targets = { node: null, chrome: null, electron: null };

  try {
    const output = execFileSync(binary, ['-p', 'JSON.stringify(process.versions)'], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60000,
    });
    // The LAST line, not the whole output: Electron writes its own diagnostics
    // to stdout before running the script (a GPU or sandbox notice on Linux, a
    // Squirrel line on Windows), and `-p` prints the value last. Parsing the
    // whole buffer would fail on exactly the machines that talk the most.
    const versions = JSON.parse(output.trim().split('\n').pop());
    targets = {
      // Node takes the full version (esbuild reads `node24.18.0`); Chromium
      // ships four parts and esbuild reads at most three, so it takes the major
      // — which is the only part a syntax floor turns on anyway.
      node: versions.node ? `node${versions.node}` : null,
      chrome: versions.chrome ? `chrome${versions.chrome.split('.')[0]}` : null,
      electron: versions.electron || null,
    };
  } catch (e) {
    // Called ON the logger, never as a detached reference: the devkit Logger
    // reads its `[@omega.js/<package>:<module>]` tag off `this`, so a bare
    // `const warn = logger.warn` prints `[undefined:undefined]`.
    if (options && options.logger) {
      options.logger.warn(`Could not read the Electron runtime versions from ${binary} (${e.message}) — bundles compile with no syntax floor.`);
    }
  }

  cache.set(binary, targets);
  return targets;
};
