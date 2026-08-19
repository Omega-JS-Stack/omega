const assert = require('assert');
const { before, beforeEach, after } = require('node:test');

// Shared test config (Firebase + Sentry disabled for unit tests)
const TEST_CONFIG = {
  brand: { id: 'test' },
  firebase: { app: { enabled: false } },
  sentry: { enabled: false },
};

// Manager singleton
let Manager;

function getManager() {
  return Manager;
}

// Root hooks — registered on require, so every test file that pulls the
// helpers in gets the same pre-suite Manager load and per-test storage reset.
before(async () => {
  const mod = await import('../src/index.js');
  Manager = mod.default;
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
  if (Manager?._versionCheckInterval) {
    clearInterval(Manager._versionCheckInterval);
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
  getManager,
  setPathPrefix,
};
