const assert = require('assert');
const { before, beforeEach, after } = require('node:test');

// Shared test config (Firebase + Sentry disabled for unit tests).
//
// `environment` is NOT optional (#817): it is the one input this runtime
// answers from in a browser, the build fact every OMEGA surface bakes into
// OMEGA_BUILD_JSON, and a config without it throws by name rather than reading
// as "not development". A unit-test config is a testing artifact, so it says so.
const TEST_CONFIG = {
  environment: 'testing',
  brand: { id: 'test' },
  firebase: { app: { enabled: false } },
  sentry: { enabled: false },
};

// The one Omega instance the suites share. The package exports the class and
// no instance, so the harness builds it the way a framework does.
let omega;

function getOmega() {
  return omega;
}

// Root hooks — registered on require, so every test file that pulls the
// helpers in gets the same pre-suite instance and per-test storage reset.
before(async () => {
  const { Omega } = await import('../src/index.js');
  omega = new Omega();
});

beforeEach(() => {
  if (global.window) {
    global.window.localStorage.clear();
    global.window.sessionStorage.clear();
  }
});

// `initialize()` arms the refresh-new-version interval, which lives for the
// page's lifetime in a browser and would hold the test process open forever.
after(() => {
  if (omega?._versionCheckInterval) {
    clearInterval(omega._versionCheckInterval);
  }
});

// Stamp the #355 base path on <html>, the way the web build's HTML pass does,
// and hand back the undo — every module that mounts under a prefix reads it
// from that one stamp, so every suite exercising one starts here.
function setPathPrefix(prefix) {
  const dataset = document.documentElement.dataset;
  const previous = dataset.omegaPathPrefix;

  dataset.omegaPathPrefix = prefix;

  return () => {
    if (previous === undefined) {
      delete dataset.omegaPathPrefix;
    } else {
      dataset.omegaPathPrefix = previous;
    }
  };
}

module.exports = {
  TEST_CONFIG,
  assert,
  getOmega,
  setPathPrefix,
};
