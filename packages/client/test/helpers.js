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

module.exports = {
  TEST_CONFIG,
  assert,
  getManager,
};
