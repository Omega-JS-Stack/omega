// Boot-runner — spawns electron with the consumer's actual built main bundle, runs
// inspect functions against the live manager, then quits cleanly.
//
// Differences from runners/electron.js:
//   - electron.js spawns electron with `harness/main-entry.js` and tests @omega.js/desktop lib code in isolation.
//   - boot.js spawns electron with the consumer's built `main.bundle.js` (the real production
//     boot path), then injects `harness/boot-entry.js` via --require to drive inspection.
//
// The build + boot happen in a STAGED target root (`<project>/.omega/test-app`), never the
// project's own dist/ (#110) — a concurrent `npm start` watcher writes dist/, and two
// writers on one tree means either side can load a half-written bundle. See stageTestApp().
//
// Why both? `main` layer tests cover individual lib behavior fast. `boot` layer covers
// integration — does the consumer's actual main.js boot end-to-end with their config + scaffolds?
// Replaces shell-level `npm start && sleep && kill` smoke tests with deterministic, signal-driven
// pass/fail.
//
// This lane also carries the renderer suites that name a project view (`view: '<name>'`):
// they need the built app a boot run already produces, so `harness/boot-entry.js` opens each
// view in a real window of the booted app once the inspect tests are done. They arrive here
// as `suites` (whole modules), never flattened into `tests`.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const chalk = require('chalk').default;
const distSnapshot = require('../utils/dist-snapshot.js');
const { renderEvent } = require('./render-event.js');

async function runBootTests({ tests, suites, projectRoot, frameworkDistRoot }) {
  suites = suites || [];

  if (tests.length === 0 && suites.length === 0) {
    return { passed: 0, failed: 0, skipped: 0 };
  }

  // OMEGA_TEST_BOOT_PROJECT — boot a different project root than the CWD. Auto-set to the
  // bundled fixture when @omega.js/desktop self-tests (see commands/test.js); set it explicitly to boot a
  // real consumer (e.g. deployment-playground-desktop) without cd-ing into it. Mirrors
  // BXM's OMEGA_TEST_BOOT_PROJECT / UJM's UJ_TEST_BOOT_PROJECT.
  const effectiveRoot = process.env.OMEGA_TEST_BOOT_PROJECT
    ? path.resolve(process.env.OMEGA_TEST_BOOT_PROJECT)
    : projectRoot;

  // The bundled fixture ships as SOURCE only (no node_modules). Symlink the two deps the
  // build + boot path resolves by EXPLICIT path: @omega.js/desktop (the gulpfile path +
  // esbuild's `require('@omega.js/desktop/main')`) and electron (the runner's binary lookup
  // + the spawned bundle's `require('electron')`). Everything else (gulp, esbuild,
  // etc.) resolves through the upward node_modules walk because the fixture lives inside the
  // @omega.js/desktop repo. No-op for a real consumer that already has its own node_modules. The links are
  // tracked and ALWAYS removed in the finally — the @omega.js/desktop link points at the @omega.js/desktop
  // repo root, which CONTAINS the fixture, so leaving it behind forms an infinite directory
  // cycle inside dist/ that crashes the next prepare-package tree walk (ENAMETOOLONG) and
  // with it `npm publish`.
  const createdLinks = ensureFixtureDeps(effectiveRoot, path.resolve(frameworkDistRoot, '..'));

  try {
    return await bootProject({ tests, suites, effectiveRoot, frameworkDistRoot });
  } finally {
    removeFixtureDeps(createdLinks);
  }
}

// Build + spawn + inspect — the actual boot run against effectiveRoot.
async function bootProject({ tests, suites, effectiveRoot, frameworkDistRoot }) {
  // Serialize the view suites BEFORE anything is built: a run whose every suite is skipped
  // (and that has no inspect tests) has nothing to build an app for.
  const { viewSuites, skipEvents } = prepareViewSuites(suites);

  if (tests.length === 0 && viewSuites.length === 0) {
    const counts = { passed: 0, failed: 0, skipped: 0 };
    skipEvents.forEach((evt) => renderEvent(evt, counts));
    return counts;
  }

  // Every test a failed build or a missing electron accounts for: the flat inspect list plus
  // every test inside a view suite.
  const testCount = tests.length + viewSuites.reduce((total, suite) => total + suite.tests.length, 0);

  // Locate electron. Resolve like Node would from the project root (walks up node_modules
  // chains), so hoisted installs (npm workspaces) are found — not just <root>/node_modules.
  let electronBin;
  try {
    electronBin = require(require.resolve('electron', { paths: [effectiveRoot] }));
  } catch (e) {
    const msg = `    ○ boot tests skipped (electron not installed in ${effectiveRoot})`;
    console.log(chalk.yellow(msg));
    return { passed: 0, failed: 0, skipped: testCount };
  }

  // Stage the boot-test target root and record the project's real dist/ before anything
  // builds — the boot layer asserts that fingerprint is unchanged afterwards (#110).
  const testApp = stageTestApp(effectiveRoot);
  const distSnapshotBefore = distSnapshot(path.join(effectiveRoot, 'dist'));

  // Always rebuild before boot tests. Boot tests run against the consumer's actual
  // production main bundle; if it's stale, tests pass against outdated code.
  // Always-build is ~10s slower than a staleness check, but a staleness heuristic
  // (mtime comparison) can be defeated by editor backdating, git restores, or
  // file copies — and a silently-stale test is worse than a slow one.
  // Set OMEGA_TEST_SKIP_BUILD=1 to opt out (CI scenarios where build ran in a separate step).
  if (process.env.OMEGA_TEST_SKIP_BUILD !== '1') {
    console.log(chalk.gray(`      Building bundle for boot tests...`));
    // A fresh build gets a fresh output: leftovers from a prior run (a deleted
    // view, a renamed bundle) would otherwise survive and keep existence-style
    // assertions green. SKIP_BUILD keeps the staged output — that is its point.
    fs.rmSync(testApp.distRoot, { recursive: true, force: true });
    const buildResult = runGulpBuild(effectiveRoot, testApp.distRoot);
    if (buildResult !== 0) {
      console.log(chalk.red(`    ✗ Boot tests aborted — gulp build failed (exit ${buildResult}).`));
      return { passed: 0, failed: testCount, skipped: 0 };
    }
  } else if (!fs.existsSync(testApp.bundlePath)) {
    // Loud, not skipped: the test output is private to the boot runner, so an absent
    // bundle means the build step the operator promised never ran. Booting anything
    // else (the project's dist/, a stale tree) would silently test the wrong bundle.
    console.log(chalk.red(`    ✗ Boot tests aborted — OMEGA_TEST_SKIP_BUILD=1 but no test build at ${testApp.bundlePath}. Run the boot tests once without it (or build with OMEGA_BUILD_OUTPUT=${testApp.distRoot}).`));
    return { passed: 0, failed: testCount, skipped: 0 };
  }

  // Write the spec file. Each test's `inspect` function body is extracted as a string
  // and shipped to the harness for reconstitution. Same trick as runners/electron.js
  // uses for renderer suites.
  const spec = {
    projectRoot: effectiveRoot,
    appRoot:     testApp.appRoot,
    frameworkDistRoot,
    distSnapshotBefore,
    tests: tests.map((t) => ({
      description:    t.description,
      timeout:        t.timeout,
      inspectSource:  extractFnBody(t.inspect),
    })),
    viewSuites,
  };

  const specFile = path.join(os.tmpdir(), `desktop-boot-spec-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(specFile, JSON.stringify(spec));

  const bootEntry = path.join(frameworkDistRoot, 'test', 'harness', 'boot-entry.js');

  // Tell the consumer's main.js to publish the manager + run the boot harness.
  // Three env vars are picked up by @omega.js/desktop's main.js after init completes:
  //   OMEGA_TEST_BOOT          — gate; "1" turns on harness loading
  //   OMEGA_TEST_BOOT_HARNESS  — absolute path to harness module (resolved here so it works
  //                           even though main.js is esbuild-bundled into the consumer bundle)
  //   OMEGA_TEST_BOOT_SPEC     — JSON file with the test definitions
  // Argv would be cleaner but Electron rejects unknown CLI flags.
  const childEnv = Object.assign({}, process.env, {
    OMEGA_TEST_MODE:                  'true',   // canonical signal — manager.isTesting() picks it up
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

  // Args passed to electron:
  //   testApp.appRoot — the staged target root (package.json#main = dist/main.bundle.js,
  //   its dist/ being the isolated test build). Electron loads it exactly the way it
  //   loads a real project dir, so packaged-app semantics — app name/version from
  //   package.json, appRoot-relative view/preload/icon lookups — are unchanged.
  //
  // We don't use `--require <bootEntry>` because Electron rejects unknown CLI flags. Instead,
  // @omega.js/desktop's main.js detects OMEGA_TEST_BOOT and `require()`s the boot harness itself after init.
  const args = [testApp.appRoot];

  return new Promise((resolve) => {
    const child = spawn(electronBin, args, {
      cwd: effectiveRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    const counts = { passed: 0, failed: 0, skipped: 0 };

    // Suites the module skipped whole: reported before the run they never join.
    skipEvents.forEach((evt) => renderEvent(evt, counts));

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('__EM_TEST__')) {
          renderEvent(JSON.parse(line.slice('__EM_TEST__'.length)), counts);
        } else if (process.env.OMEGA_TEST_DEBUG && line.trim().length > 0) {
          process.stdout.write(chalk.gray(`      ${line}\n`));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      if (process.env.OMEGA_TEST_DEBUG) {
        process.stderr.write(chalk.gray(`[boot:stderr] ${chunk.toString()}`));
      }
    });

    child.on('error', (err) => {
      console.log(chalk.red(`    ✗ Failed to spawn boot harness: ${err.message}`));
      counts.failed += 1;
      cleanup();
      resolve(counts);
    });

    child.on('exit', () => {
      cleanup();
      resolve(counts);
    });

    function cleanup() {
      try { fs.unlinkSync(specFile); } catch (_) { /* ignore */ }
    }
  });
}

// Serialize the boot-bound renderer suites (`view: '<name>'`) for the spec file, the same
// shape main-entry.js ships to the harness page (plus the view name). A suite the module
// skipped whole runs nothing and reports its test count as skipped, exactly as the harness
// renderer lane does.
//
// Returns { viewSuites, skipEvents }: the suites to run, and the skip events the caller
// renders once it has a counts object.
function prepareViewSuites(suites) {
  const viewSuites = [];
  const skipEvents = [];

  for (const { file, mod } of suites) {
    const description = mod.description || path.basename(file);

    if (mod.skip) {
      const reason = typeof mod.skip === 'string' ? mod.skip : 'skipped';
      const count = Array.isArray(mod.tests) ? mod.tests.length : 1;
      skipEvents.push({ event: 'skip', name: description, reason, count });
      continue;
    }

    viewSuites.push({
      description,
      isGroup: mod.type === 'group',
      timeout: mod.timeout,
      view:    mod.view,
      tests:   (mod.tests || []).map((t) => ({
        name:      t.name,
        skip:      t.skip,
        timeout:   t.timeout,
        runSource: extractFnBody(t.run),
      })),
    });
  }

  return { viewSuites, skipEvents };
}

// Extract the body of a function as a string. Same impl style as main-entry.js's
// extractFnBody — handles arrow fns, async fns, and regular fns.
function extractFnBody(fn) {
  // Same degradation as main-entry.js: a test without a function reports as one failed
  // test instead of ending the whole run with a stack trace naming neither file nor test.
  if (typeof fn !== 'function') return 'throw new Error("test has no run() function");';
  const src = String(fn);
  // Try arrow: `(args) => { ... }` or `args => expr`
  let m = src.match(/^\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
  if (m) return m[1];
  m = src.match(/^\s*(?:async\s+)?\([^)]*\)\s*=>\s*([\s\S]*?)\s*$/);
  if (m) return `return ${m[1]};`;
  // Regular fn: `function (args) { ... }` or `function name(args) { ... }`
  m = src.match(/^\s*(?:async\s+)?function[^(]*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (m) return m[1];
  // Method shorthand: `inspect(args) { ... }`
  m = src.match(/^[^(]*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (m) return m[1];
  throw new Error(`Could not extract body from function: ${src.slice(0, 80)}...`);
}

// Shell out to the same gulp pipeline `npm run build` uses. This produces a fresh
// main.bundle.js (+ preload + renderer bundles) using the consumer's current source.
// OMEGA_BUILD_OUTPUT redirects every output path (utils/dist-root.js — the one seam) into
// the staged test app, so the project's dist/ is never written. Output is streamed inline
// so the user sees progress for the ~10s build cost.
function runGulpBuild(projectRoot, outputRoot) {
  const gulpfile = path.join(projectRoot, 'node_modules', '@omega.js/desktop', 'dist', 'gulp', 'main.js');
  const result = spawnSync('npx', ['gulp', '--cwd', projectRoot, '--gulpfile', gulpfile, 'build'], {
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
      if (process.env.OMEGA_TEST_DEBUG) {
        console.log(chalk.gray(`      [boot] could not link ${name}: ${e.message}`));
      }
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
      // The link's PARENT, not just node_modules — a scoped name like
      // @omega.js/desktop needs its node_modules/@omega.js dir to exist first
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.symlinkSync(target, linkPath, linkType);
      created.push(linkPath);
    } catch (e) {
      // Best-effort — if it mattered, the gulp build / electron lookup below surfaces a
      // far clearer error than anything we'd throw here.
      if (process.env.OMEGA_TEST_DEBUG) {
        console.log(chalk.gray(`      [boot] could not link ${name}: ${e.message}`));
      }
    }
  }

  return created;
}

// Remove the symlinks ensureFixtureDeps created THIS run — never anything else, so a real
// consumer's node_modules is untouched (nothing was created for it). Removal is required,
// not just tidy: a leftover @omega.js/desktop → repo-root link inside dist/ is an infinite
// directory cycle that breaks the next prepare-package walk (`npm run prepare`/`npm publish`).
function removeFixtureDeps(links) {
  for (const linkPath of links) {
    try {
      fs.unlinkSync(linkPath);                                   // POSIX symlinks
    } catch (_) {
      try { fs.rmdirSync(linkPath); } catch (_) { /* Windows junctions; best-effort */ }
    }
  }
}

module.exports = { runBootTests };
