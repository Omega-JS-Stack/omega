// The boot harness: @omega.js/desktop's main.js requires it (utils/boot-harness.js)
// once omega.initialize() resolves under OMEGA_TEST_BOOT=1. It reads the spec at
// OMEGA_TEST_BOOT_SPEC, runs its main-process suites against the live instance,
// then each view suite in a real window of this app through the page engine
// (renderer-entry.js), writes one envelope line per case, and quits. A fatal goes to stderr.

'use strict';

const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');
const { runSuite } = require('@omega.js/devkit/test/run-case');
const expect = require('@omega.js/devkit/test/expect');
const { eventLine, reportEvery, createEventTracker } = require('@omega.js/devkit/test/events');
const { engineSources } = require('./engine-sources.js');
const { rebuildSuite } = require('./renderer-entry.js');

// How often a view window's queued case events are collected.
const VIEW_POLL_MS = 50;

// One case event as an envelope line on stdout, for the boot driver to read back.
function emit(event) {
  process.stdout.write(`${eventLine(event)}\n`);
}

async function run(omega) {
  const { app } = require('electron');
  try {
    // The consumer's initialize().then() opens its windows asynchronously: give the main
    // window up to 3s. A hidden or tray-only app never opens one, and its suites allow for that.
    await waitForMainWindow(omega, 3000);

    const spec = jetpack.read(process.env.OMEGA_TEST_BOOT_SPEC, 'json');
    const extras = {
      omega,
      projectRoot: spec.projectRoot,
      appRoot: spec.appRoot,
      frameworkDistRoot: spec.frameworkDistRoot,
      distSnapshotBefore: spec.distSnapshotBefore,
    };

    // A main-process body sees Node's `require`, `process` and `Buffer`, as a module would.
    for (const suite of spec.mainSuites) {
      await runSuite(rebuildSuite(suite, 'boot', { require, process, Buffer }), { expect, extras, report: emit });
    }

    // window-manager quits on `window-all-closed` (win/linux): closing a view window must not end the run.
    if (spec.viewSuites.length > 0) app.removeAllListeners('window-all-closed');
    const sources = engineSources();
    for (let i = 0; i < spec.viewSuites.length; i += 1) {
      await runViewSuite(spec.viewSuites[i], i, omega, spec, sources, emit);
    }
    app.exit(0);
  } catch (e) {
    process.stderr.write(`boot harness: ${e.stack || e}\n`);
    app.exit(1);
  }
}

function failEvery(suite, message, report) {
  reportEvery(suite.cases, report, { status: 'fail', error: new Error(message) });
}

// One view suite in a real window from the app's own window manager, so the page loads
// the way production loads it: this project's built preload, IPC handlers and config.
// A throw or a page engine error fails this suite's unreported cases; the next suite still runs.
async function runViewSuite(suite, index, omega, spec, sources, report) {
  // Chromium commits an error page AT a missing file's URL, so check the built file first.
  const htmlPath = path.join(spec.appRoot, 'dist', 'views', suite.view, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    failEvery(suite, `view "${suite.view}" did not load (expected ${htmlPath})`, report);
    return;
  }

  const events = createEventTracker(report);
  let win = null;
  try {
    win = await omega.windows.create(`omega-test-view-${index}`, {
      view:          suite.view,
      show:          false,
      persistBounds: false,
    });

    // createNamed LOGS a load failure rather than throwing, so a missing/unbuilt view would
    // otherwise present as a page with no DOM and a pile of confusing assertion failures.
    const loaded = Boolean(win)
      && !win.isDestroyed()
      && win.webContents.getURL().includes(`/dist/views/${suite.view}/`);

    if (!loaded) {
      failEvery(suite, `view "${suite.view}" did not load (expected <appRoot>/dist/views/<view>/index.html)`, report);
      return;
    }

    // The bridge the page engine talks to: events queue in the page for the poll below.
    await win.webContents.executeJavaScript(`
      window.__omegaTestQueue = [];
      window.__omegaTestDone = null;
      window.__omegaTest = {
        ready() {},
        emit(event) { window.__omegaTestQueue.push(event); },
        done(error) { window.__omegaTestDone = { error: error || null }; },
        onSuites(handler) { window.__omegaTestDeliver = handler; },
      };
      null;
    `);
    const entryPath = path.join(__dirname, 'renderer-entry.js');
    await win.webContents.executeJavaScript(`${jetpack.read(entryPath)}\nnull;`);
    await win.webContents.executeJavaScript(`window.__omegaTestDeliver(${JSON.stringify({ sources, suites: [suite], layer: 'boot' })}); null;`);

    const done = await collectViewEvents((code) => win.webContents.executeJavaScript(code), events.onEvent);
    if (done.error) events.settle(suite.cases, new Error(`view suite "${suite.description || suite.file}": ${done.error}`));
  } catch (e) {
    events.settle(suite.cases, e);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

// A view page's case events until its engine is done. Queue and done are read in ONE round
// trip: the page runs between two, so an event pushed in that gap would be lost. A page
// that stops answering is the boot driver's idle budget to end.
async function collectViewEvents(execute, onEvent) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, VIEW_POLL_MS));
    const { events, done } = await execute('({ events: window.__omegaTestQueue.splice(0), done: window.__omegaTestDone })');
    events.forEach(onEvent);
    if (done) return done;
  }
}

// Poll for the main window for up to `timeoutMs`. Resolves when it shows up, or after
// the timeout (no error — agent/hidden apps never create one and that's fine).
async function waitForMainWindow(omega, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (omega.windows.get('main')) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

module.exports = { run, runViewSuite };
