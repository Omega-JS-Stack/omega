// The `boot` driver: builds the project into a STAGED target root
// (`<project>/.omega/test-app`, never the project's own dist/, which a running
// watcher writes), boots that app in Electron with harness/boot-entry.js, and
// reports every envelope line the booted app writes. A suite with `view: '<name>'`
// runs in that view's window; every other boot suite runs in the app's main process.

const path = require('path');
const fs = require('fs');
const os = require('os');
// Called through the module, never destructured: the json reporter's stdout guard patches it.
const childProcess = require('child_process');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const distSnapshot = require('../utils/dist-snapshot.js');
const { serializeSuite, specKey } = require('@omega.js/devkit/test/serialize');
const { reportEvery, createEventTracker } = require('@omega.js/devkit/test/events');
const {
  NO_ELECTRON_REASON, KILL_GRACE_MS, resolveElectron, electronArgs, readChildOutput, childEnded, exitError, endChild,
} = require('./app-child.js');

// How long a booted app gets to say anything at all before the run is declared
// failed. Generous: the app under test is the consumer's real one, cold.
const DEFAULT_BOOT_TIMEOUT_MS = 60000;

// The framework's dist/: the harness, the build's gulpfile and the fixture links resolve from it.
const FRAMEWORK_DIST_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Split the boot row's suites: a suite with `view` runs in that view's window,
 * any other boot suite in the booted app's main process.
 * @param {object[]} suites - Normalized suites.
 * @returns {{mainSuites: object[], viewSuites: object[]}} Suites of any other layer join neither.
 */
function partitionBootSuites(suites) {
  const boot = suites.filter((suite) => suite.layer === 'boot');
  const hasView = (suite) => typeof specKey(suite, 'view') === 'string';
  return {
    mainSuites: boot.filter((suite) => !hasView(suite)),
    viewSuites: boot.filter(hasView),
  };
}

const bootDriver = {
  /**
   * Build and boot the project, then run the row's suites inside it.
   * @param {{projectRoot: string, suites: object[], report: Function}} options - From the runner.
   * @returns {Promise<{finished: Promise<void>, stop: Function}>} The row's handle.
   */
  async start({ projectRoot, suites, report }) {
    const { mainSuites, viewSuites } = partitionBootSuites(suites);

    // A suite skipped whole needs no build: its cases report here.
    const all = [...mainSuites, ...viewSuites];
    all.filter((suite) => suite.skip).forEach((suite) => {
      reportEvery(suite.cases, report, { status: 'skip', reason: typeof suite.skip === 'string' ? suite.skip : 'skipped' });
    });
    const live = { mainSuites: mainSuites.filter((suite) => !suite.skip), viewSuites: viewSuites.filter((suite) => !suite.skip) };
    const cases = [...live.mainSuites, ...live.viewSuites].flatMap((suite) => suite.cases);
    if (cases.length === 0) return { finished: Promise.resolve(), stop() {} };

    // OMEGA_TEST_BOOT_PROJECT boots another project than the run's (the self-test's bundled fixture).
    const effectiveRoot = process.env.OMEGA_TEST_BOOT_PROJECT
      ? path.resolve(process.env.OMEGA_TEST_BOOT_PROJECT)
      : projectRoot;

    // The bundled fixture ships as source only: link the two deps its build and boot
    // resolve by explicit path (@omega.js/desktop, electron). The links are ALWAYS removed:
    // the desktop link points at the repo that contains the fixture, a directory cycle.
    const createdLinks = ensureFixtureDeps(effectiveRoot, path.resolve(FRAMEWORK_DIST_ROOT, '..'));

    let child = null;
    const finished = bootProject({ ...live, cases, effectiveRoot, report, onSpawn: (spawned) => { child = spawned; } })
      .finally(() => removeFixtureDeps(createdLinks));

    return {
      finished,
      async stop() {
        if (child && child.exitCode === null && child.signalCode === null) endChild(child, KILL_GRACE_MS);
        await finished.catch(() => {});
      },
    };
  },
};

// Build, write the spec, and boot: the actual boot run against effectiveRoot.
async function bootProject({ mainSuites, viewSuites, cases, effectiveRoot, report, onSpawn }) {
  const electronBin = resolveElectron(effectiveRoot);
  if (!electronBin) {
    reportEvery(cases, report, { status: 'skip', reason: NO_ELECTRON_REASON });
    return;
  }

  // Stage the boot-test target root and record the project's real dist/ before anything
  // builds: the boot layer asserts that fingerprint is unchanged afterwards.
  const testApp = stageTestApp(effectiveRoot);
  const distSnapshotBefore = distSnapshot(path.join(effectiveRoot, 'dist'));

  const buildError = buildTestApp(effectiveRoot, testApp);
  if (buildError) {
    reportEvery(cases, report, { status: 'fail', error: new Error(buildError) });
    return;
  }

  const specFile = path.join(os.tmpdir(), `desktop-boot-spec-${process.pid}-${Date.now()}.json`);
  jetpack.write(specFile, {
    projectRoot: effectiveRoot,
    appRoot: testApp.appRoot,
    frameworkDistRoot: FRAMEWORK_DIST_ROOT,
    distSnapshotBefore,
    mainSuites: mainSuites.map(serializeSuite),
    viewSuites: viewSuites.map(serializeSuite),
  });

  const bootEntry = path.join(FRAMEWORK_DIST_ROOT, 'test', 'harness', 'boot-entry.js');

  // Tell the consumer's main.js to publish the instance + run the boot harness.
  // Three env vars are picked up by @omega.js/desktop's main.js after init completes:
  //   OMEGA_TEST_BOOT          — gate; "1" turns on harness loading
  //   OMEGA_TEST_BOOT_HARNESS  — absolute path to harness module (resolved here so it works
  //                           even though main.js is esbuild-bundled into the consumer bundle)
  //   OMEGA_TEST_BOOT_SPEC     — JSON file with the test definitions
  // Argv would be cleaner but Electron rejects unknown CLI flags.
  const childEnv = Object.assign({}, process.env, {
    OMEGA_ENVIRONMENT:             'testing',   // the one environment input (#817): this lane names it
    OMEGA_TEST_BOOT:                  '1',      // boot-runner-specific dispatch marker (main.js reads this to load the harness instead of doing normal init)
    OMEGA_TEST_BOOT_HARNESS:          bootEntry,
    OMEGA_TEST_BOOT_SPEC:             specFile,
    // Tray on macOS pops a real menubar icon; suppress to keep the test invisible.
    OMEGA_TEST_HEADLESS:              '1',
    // Suppress dev-mode dock-bounce / startup item changes during the test.
    NODE_ENV:                      process.env.NODE_ENV || 'test',
  });
  // Defensive scrub at the spawn (friction 17c) — the CLI boundary strips it,
  // but paths that bypass the boundary must not boot Electron as plain node.
  delete childEnv.ELECTRON_RUN_AS_NODE;

  // The staged target root is the app: Electron loads it the way it loads a real project dir.
  await runBootChild({
    electronBin,
    entry: testApp.appRoot,
    childEnv,
    effectiveRoot,
    specFile,
    cases,
    report,
    spawnFn: (...spawnArgs) => {
      const spawned = childProcess.spawn(...spawnArgs);
      onSpawn(spawned);
      return spawned;
    },
  });
}

/**
 * Build the staged app, unless OMEGA_TEST_SKIP_BUILD=1 says a build already ran.
 * @param {string} effectiveRoot - The project being booted.
 * @param {{distRoot: string, bundlePath: string}} testApp - From stageTestApp.
 * @returns {string|null} Why the boot cannot run, or null when the bundle is ready.
 */
function buildTestApp(effectiveRoot, testApp) {
  // Always rebuild: a staleness heuristic (mtimes) is defeated by backdating, restores
  // and copies, and a silently stale bundle is worse than a slow run.
  if (process.env.OMEGA_TEST_SKIP_BUILD !== '1') {
    console.log(chalk.gray('      Building bundle for boot tests...'));
    // A fresh build gets a fresh output: a prior run's leftovers would keep existence checks green.
    fs.rmSync(testApp.distRoot, { recursive: true, force: true });
    const buildResult = runGulpBuild(effectiveRoot, testApp.distRoot);
    if (buildResult !== 0) return `boot tests aborted: the gulp build failed (exit ${buildResult})`;
    return null;
  }
  // Loud, not skipped: an absent test build means the build the operator promised never ran.
  if (!fs.existsSync(testApp.bundlePath)) {
    return `boot tests aborted: OMEGA_TEST_SKIP_BUILD=1 but no test build at ${testApp.bundlePath}. Run the boot tests once without it (or build with OMEGA_BUILD_OUTPUT=${testApp.distRoot}).`;
  }
  return null;
}

/**
 * Spawn the booted app and report what its harness writes, under an IDLE budget:
 * every envelope line rearms it, and a whole budget of silence fails every case
 * still unreported (quoting the last runtime.log line) and ends the child.
 * `spawnFn`, `platform`, `timeoutMs` and `killGraceMs` are the seams a build suite drives;
 * `electronArgs` reads the CI check off `childEnv` and defaults `platform` to this process's.
 * @param {object} options - `{ electronBin, entry, childEnv, effectiveRoot, specFile, cases, report, spawnFn, platform, timeoutMs, killGraceMs }`.
 * @returns {Promise<void>} Resolves when the child exits or the budget ends it; rejects on a non-zero exit.
 */
function runBootChild({ electronBin, entry, childEnv, effectiveRoot, specFile, cases, report, spawnFn = childProcess.spawn, platform, timeoutMs = bootTimeoutMs(), killGraceMs = KILL_GRACE_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(electronBin, electronArgs(entry, { env: childEnv, platform }), {
      cwd: effectiveRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const events = createEventTracker(report);
    let timer = null;
    let ended = false;
    let exited = false;

    const output = readChildOutput(child, (event) => {
      armBudget();
      events.onEvent(event);
    });

    function finish() {
      if (ended) return false;
      ended = true;
      clearTimeout(timer);
      output.detach();
      try { fs.unlinkSync(specFile); } catch (_) { /* ignore */ }
      return true;
    }

    function armBudget() {
      clearTimeout(timer);
      if (exited) return;
      timer = setTimeout(() => {
        if (!finish()) return;
        const message = `boot: no harness output after ${Math.round(timeoutMs / 1000)}s; last runtime.log line: "${lastRuntimeLogLine(effectiveRoot)}"`;
        console.log(chalk.red(`    ✗ ${message}`));
        events.settle(cases, new Error(message));
        endChild(child, killGraceMs);
        resolve();
      }, timeoutMs);
    }

    // A child that has exited is past any budget, while its pipes drain.
    child.once('exit', () => {
      exited = true;
      clearTimeout(timer);
    });
    childEnded(child).then((end) => {
      if (!finish()) return;
      events.settle(cases);
      if (end.code !== 0 && !end.signal) reject(exitError('boot', end, output.tail()));
      else resolve();
    }, (error) => {
      if (finish()) reject(error);
    });

    armBudget();
  });
}

// The boot budget, overridable with OMEGA_TEST_BOOT_TIMEOUT_MS the way
// OMEGA_TEST_SKIP_BUILD opts out of the rebuild above.
function bootTimeoutMs() {
  const override = Number(process.env.OMEGA_TEST_BOOT_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_BOOT_TIMEOUT_MS;
}

// The last non-empty line of the booted app's runtime log: where a blocked boot got to.
// A boot that died before the logger opened a file has none, which is itself the report.
function lastRuntimeLogLine(effectiveRoot) {
  let contents;
  try {
    contents = fs.readFileSync(path.join(effectiveRoot, 'logs', 'runtime.log'), 'utf8');
  } catch (_) {
    return '(no runtime.log)';
  }

  const lines = contents.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim().length > 0) return lines[i].trim();
  }
  return '(runtime.log is empty)';
}

// Shell out to the same gulp pipeline `npm run build` uses. This produces a fresh
// main.bundle.js (+ preload + renderer bundles) using the consumer's current source.
// OMEGA_BUILD_OUTPUT redirects every output path (utils/dist-root.js — the one seam) into
// the staged test app, so the project's dist/ is never written. Output is streamed inline
// so the user sees progress for the ~10s build cost.
function runGulpBuild(projectRoot, outputRoot) {
  const gulpfile = path.join(projectRoot, 'node_modules', '@omega.js/desktop', 'dist', 'gulp', 'main.js');
  const result = childProcess.spawnSync('npx', ['gulp', '--cwd', projectRoot, '--gulpfile', gulpfile, 'build'], {
    cwd:   projectRoot,
    env:   Object.assign({}, process.env, { OMEGA_BUILD_MODE: 'true', OMEGA_BUILD_OUTPUT: outputRoot }),
    stdio: 'inherit',
  });
  return result.status == null ? 1 : result.status;
}

// Stage the target root the boot tests build into and boot from: `<project>/.omega/test-app`
// (gitignored). It is a real Electron target dir, not a bare output folder:
//   - package.json — the project's own, verbatim except `main`, which is pinned at the
//     test build's bundle. Electron derives the app name, version and therefore the
//     userData path from it, so booting the staged root resolves exactly what booting
//     the project does.
//   - src / config — symlinks back to the project's. Runtime lookups resolved against
//     `app.getAppPath()` (src/integrations/*, the unbundled config fallback) keep finding
//     the consumer's real files even though the target dir moved.
//   - dist/ — the isolated build output (OMEGA_BUILD_OUTPUT), so `<appRoot>/dist/views`,
//     `<appRoot>/dist/preload.bundle.js` and the tray's icon lookup need no runtime change.
// package.json and the symlinks are rewritten on every run; dist/ is cleared by the
// runner before each build (and deliberately kept under OMEGA_TEST_SKIP_BUILD).
function stageTestApp(projectRoot) {
  const appRoot  = path.join(projectRoot, '.omega', 'test-app');
  const distRoot = path.join(appRoot, 'dist');

  fs.mkdirSync(appRoot, { recursive: true });

  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch (e) {
    // A project without a readable package.json can't be built either — the gulp build
    // below surfaces a far clearer error than anything we'd throw here.
  }
  pkg.main = 'dist/main.bundle.js';
  fs.writeFileSync(path.join(appRoot, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const name of ['src', 'config']) {
    const target   = path.join(projectRoot, name);
    const linkPath = path.join(appRoot, name);

    try { fs.unlinkSync(linkPath); } catch (e) { /* absent, or a Windows junction (rmdir below) */ }
    try { fs.rmdirSync(linkPath); } catch (e) { /* already gone */ }

    if (!fs.existsSync(target)) continue;

    try {
      fs.symlinkSync(target, linkPath, linkType);
    } catch (e) {
      console.log(chalk.gray(`      [boot] could not link ${name}: ${e.message}`));
    }
  }

  return { appRoot, distRoot, bundlePath: path.join(distRoot, 'main.bundle.js') };
}

// Symlink the deps the bundled fixture's build + boot path resolves by EXPLICIT path
// (not the upward node_modules walk):
//   - @omega.js/desktop → the @omega.js/desktop repo root, so `<root>/node_modules/@omega.js/desktop/dist/gulp/main.js`
//     (the gulpfile path) resolves AND esbuild's `require('@omega.js/desktop/main')` resolves.
//   - electron → @omega.js/desktop's own electron, so the runner's `require('<root>/node_modules/electron')`
//     binary lookup + the spawned bundle's `require('electron')` resolve.
// Creates only what's MISSING — a no-op for a real consumer (OMEGA_TEST_BOOT_PROJECT pointed at
// an installed app already has both). Returns the link paths it created so the caller can
// remove exactly those (and ONLY those) after the run. Runtime-only; the fixture .gitignore
// is belt-and-suspenders for crashed runs.
function ensureFixtureDeps(effectiveRoot, emRoot) {
  const nodeModules = path.join(effectiveRoot, 'node_modules');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  // Resolve electron's actual install dir from emRoot (walks up node_modules chains, so
  // hoisted workspace installs work) instead of assuming emRoot/node_modules/electron.
  let electronDir = path.join(emRoot, 'node_modules', 'electron');
  try {
    electronDir = path.dirname(require.resolve('electron/package.json', { paths: [emRoot] }));
  } catch (e) {
    // fall through with the legacy path; the existsSync guard below handles absence
  }
  const links = [
    ['@omega.js/desktop', emRoot],
    ['electron',         electronDir],
  ];
  const created = [];

  for (const [name, target] of links) {
    const linkPath = path.join(nodeModules, name);
    if (fs.existsSync(linkPath)) continue;   // real consumer already has it, or a prior run linked it
    if (!fs.existsSync(target))  continue;   // can't link what isn't there

    try {
      // The link's parent dirs are created too, and recorded so the removal takes them back.
      const firstMade = fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      if (firstMade) created.push(...dirsBetween(firstMade, path.dirname(linkPath)));
      fs.symlinkSync(target, linkPath, linkType);
      created.push(linkPath);
    } catch (e) {
      // Best-effort: if it mattered, the gulp build or electron lookup below surfaces a
      // far clearer error than anything we'd throw here.
      console.log(chalk.gray(`      [boot] could not link ${name}: ${e.message}`));
    }
  }

  return created;
}

// Every dir from `top` down to `bottom`, top first: what one recursive mkdir created.
function dirsBetween(top, bottom) {
  const dirs = [bottom];
  while (dirs[0] !== top) dirs.unshift(path.dirname(dirs[0]));
  return dirs;
}

// Remove the links and dirs ensureFixtureDeps created THIS run, newest first, and nothing else, so a real
// consumer's node_modules is untouched (nothing was created for it). Removal is required,
// not just tidy: a leftover @omega.js/desktop → repo-root link inside dist/ is an infinite
// directory cycle that breaks the next prepare-package walk (`npm run prepare`/`npm publish`).
function removeFixtureDeps(links) {
  for (const linkPath of [...links].reverse()) {
    try {
      fs.unlinkSync(linkPath);                                   // POSIX symlinks
    } catch (_) {
      try { fs.rmdirSync(linkPath); } catch (_) { /* Windows junctions; best-effort */ }
    }
  }
}

module.exports = { bootDriver, partitionBootSuites, runBootChild };
