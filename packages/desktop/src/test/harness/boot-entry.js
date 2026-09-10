// Boot harness — invoked from @omega.js/desktop's main.js after manager.initialize() resolves
// when OMEGA_TEST_BOOT=1. Reads the spec file pointed to by OMEGA_TEST_BOOT_SPEC,
// runs each `inspect` against the live manager, emits results, and quits.
//
// Why call from main.js instead of preloading via electron's --require?
// Because Electron rejects unknown CLI flags, we can't sneak args/preload modules in.
// So @omega.js/desktop's main.js opts into the harness when it sees OMEGA_TEST_BOOT=1, after a
// fully-completed initialize() guarantees every lib is up.
//
// After the inspect tests, any `viewSuites` in the spec run too: renderer suites that named
// a project view (`view: '<name>'`), each in a real window of this booted app. See
// runViewSuite() below.
//
// Protocol matches main-entry.js — emit `__EM_TEST__` JSON lines on stdout.

'use strict';

// Belt-and-suspenders for a view suite that never emits `end` (a page that died mid-run).
// Same 60s ceiling the harness-page renderer lane uses (harness/main-entry.js).
const VIEW_SUITE_TIMEOUT = 60000;

function emit(obj) {
  process.stdout.write(`__EM_TEST__${JSON.stringify(obj)}\n`);
}

async function run(manager) {
  const { app } = require('electron');
  const path = require('path');

  // Give the consumer's `manager.initialize().then(() => { ... })` callback time
  // to surface windows / wire up handlers / etc. The harness runs from setImmediate
  // already (which flushes microtasks once), but `windows.create()` is async, so
  // we additionally poll for the main window for up to 3s. Apps that intentionally
  // launch hidden never create a main window — those tests should `if (!win) return`
  // when inspecting window state.
  await waitForMainWindow(manager, 3000);

  const specPath = process.env.OMEGA_TEST_BOOT_SPEC;
  if (!specPath) {
    emit({ event: 'fatal', message: 'boot-entry.js: OMEGA_TEST_BOOT_SPEC env var not set' });
    app.exit(1);
    return;
  }

  let spec;
  try {
    spec = require(specPath);
  } catch (e) {
    emit({ event: 'fatal', message: `boot-entry.js: failed to load spec ${specPath}: ${e.message}` });
    app.exit(1);
    return;
  }

  const projectRoot = spec.projectRoot;
  const tests       = spec.tests || [];

  // Everything a test needs to reach the build under test: `appRoot` is the staged app
  // root Electron booted (its dist/ IS the isolated boot-test output — #110),
  // `frameworkDistRoot` locates framework test utilities, `distSnapshotBefore` is the
  // fingerprint of the project's real dist/ taken before the test build.
  const args = {
    projectRoot,
    appRoot:            spec.appRoot,
    frameworkDistRoot:  spec.frameworkDistRoot,
    distSnapshotBefore: spec.distSnapshotBefore,
  };

  // Reconstitute each `inspect` from its serialized body string. We expose Node's
  // `require` + `process` + `Buffer` to the inspect body so tests can require('fs'),
  // require('electron'), etc. — `new Function(...)` creates a no-closure function so
  // these globals must be passed in explicitly. (Module-level `require` is the harness's
  // own; renaming it `require` inside the body restores the natural ergonomic.)
  const inspectors = tests.map((t) => ({
    description:  t.description,
    timeout:      t.timeout || 15000,
    inspect:      new Function('args', 'require', 'process', 'Buffer',
      `return (async function ({ manager, expect, projectRoot, appRoot, frameworkDistRoot, distSnapshotBefore }) {\n${t.inspectSource}\n})(args)`,
    ),
  }));

  // Bring in @omega.js/desktop's expect (assert.js) — same path conventions as main-entry.js uses.
  const expect = require(path.join(spec.frameworkDistRoot, 'test', 'assert.js'));

  let passed = 0, failed = 0;
  let skipped = 0;   // boot inspects have no skip mechanism; view suites below do

  for (const t of inspectors) {
    const start = Date.now();
    try {
      await Promise.race([
        t.inspect(Object.assign({ manager, expect }, args), require, process, Buffer),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Boot test timeout')), t.timeout)),
      ]);
      const duration = Date.now() - start;
      emit({ event: 'result', name: t.description, passed: true, duration });
      passed += 1;
    } catch (e) {
      const duration = Date.now() - start;
      emit({ event: 'result', name: t.description, passed: false, duration, error: e.message });
      failed += 1;
    }
  }

  // View suites (renderer suites that named a project view) run last: they need the app
  // fully up, and an inspect test must never see a window this harness opened.
  const viewSuites = spec.viewSuites || [];
  // window-manager quits the app on `window-all-closed` (win/linux). A tray-only or hidden
  // app has no other window, so destroying a view window would end the run early with the
  // remaining suites unreported. This harness exits through app.exit() below regardless.
  if (viewSuites.length > 0) app.removeAllListeners('window-all-closed');
  for (let i = 0; i < viewSuites.length; i += 1) {
    const counts = await runViewSuite(viewSuites[i], i, manager, spec);
    passed  += counts.passed;
    failed  += counts.failed;
    skipped += counts.skipped;
  }

  emit({ event: 'end', passed, failed, skipped });
  app.exit(failed > 0 ? 1 : 0);
}

// Run one renderer suite against a REAL project view, in a real window of the booted app.
//
// The window comes from the app's own window manager, so the page loads the way production
// loads it: this project's built preload, its IPC handlers, its config. The suite loop
// itself is the harness page's, verbatim: harness/renderer-entry.js is read from dist and
// evaluated inside the page, with a shim standing in for the preload bridge it normally
// talks to. There is exactly one suite loop and one `expect` in this framework, and this is
// not a second copy of either.
async function runViewSuite(suite, index, manager, spec) {
  const fs   = require('fs');
  const path = require('path');

  const counts = { passed: 0, failed: 0, skipped: 0 };

  // Chromium commits an error page AT the requested file URL on ERR_FILE_NOT_FOUND, so the
  // URL check below cannot tell a missing view from a loaded one. Check the built file first.
  const htmlPath = path.join(spec.appRoot, 'dist', 'views', suite.view, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    const error = `view "${suite.view}" did not load (expected ${htmlPath})`;
    for (const t of suite.tests) {
      emit({ event: 'result', suite: suite.description, name: t.name, passed: false, duration: 0, error });
      counts.failed += 1;
    }
    return counts;
  }

  const win = await manager.windows.create(`omega-test-view-${index}`, {
    view:          suite.view,
    show:          false,
    persistBounds: false,
  });

  try {
    // createNamed LOGS a load failure rather than throwing, so a missing/unbuilt view would
    // otherwise present as a page with no DOM and a pile of confusing assertion failures.
    const loaded = Boolean(win)
      && !win.isDestroyed()
      && win.webContents.getURL().includes(`/dist/views/${suite.view}/`);

    if (!loaded) {
      const error = `view "${suite.view}" did not load (expected <appRoot>/dist/views/<view>/index.html)`;
      for (const t of suite.tests) {
        emit({ event: 'result', suite: suite.description, name: t.name, passed: false, duration: 0, error });
        counts.failed += 1;
      }
      return counts;
    }

    // 1. The bridge renderer-entry.js expects. On the harness page this is a contextBridge
    //    surface talking to main over IPC; here the page just queues events for the poll
    //    below, since main is right here.
    await win.webContents.executeJavaScript(`
      window.__emTestQueue = [];
      window.__emTest = {
        ready() {},
        emit(evt) { window.__emTestQueue.push(evt); },
        onSuites(handler) { window.__emTestDeliver = handler; },
      };
      null;
    `);

    // 2. The renderer entry itself, verbatim. It is an IIFE: it registers the handler and
    //    calls ready() as it parses.
    const entryPath = path.join(spec.frameworkDistRoot, 'test', 'harness', 'renderer-entry.js');
    await win.webContents.executeJavaScript(`${fs.readFileSync(entryPath, 'utf8')}\nnull;`);

    // 3. Deliver this window's one suite. One suite per window, so the entry's `end` event
    //    ends this window's run.
    await win.webContents.executeJavaScript(`window.__emTestDeliver(${JSON.stringify([suite])}); null;`);

    // 4. Drain the queue until the run ends. Every event is forwarded verbatim, so the
    //    parent renders a view suite exactly like a harness-page one.
    const deadline = Date.now() + VIEW_SUITE_TIMEOUT;
    let ended = false;
    while (!ended && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const events = await win.webContents.executeJavaScript('window.__emTestQueue.splice(0)');
      for (const evt of events) {
        emit(evt);
        if (evt.event === 'end') {
          counts.passed  += evt.passed;
          counts.failed  += evt.failed;
          counts.skipped += evt.skipped;
          ended = true;
        } else if (evt.event === 'fatal') {
          counts.failed += 1;
          ended = true;
        }
      }
    }

    if (!ended) {
      emit({ event: 'fatal', message: `view suite "${suite.description}" timed out (no end event in ${VIEW_SUITE_TIMEOUT / 1000}s)` });
      counts.failed += 1;
    }
  } catch (e) {
    emit({ event: 'fatal', message: `view suite "${suite.description}": ${e.message}`, stack: e.stack });
    counts.failed += 1;
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }

  return counts;
}

// Poll for the main window for up to `timeoutMs`. Resolves when it shows up, or after
// the timeout (no error — agent/hidden apps never create one and that's fine).
async function waitForMainWindow(manager, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (manager?.windows?.get?.('main')) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

module.exports = { run };
