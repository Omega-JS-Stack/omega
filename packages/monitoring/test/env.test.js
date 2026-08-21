/**
 * env tests — the four switches, and which one wins (#380).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { readGates } = require('../src/env.js');

const KEYS = ['OMEGA_SENTRY_ENABLED', 'OMEGA_SENTRY_FORCE', 'OMEGA_BUILD_MODE', 'OMEGA_TEST_RUNNER'];

// Run fn with exactly the given monitoring env vars set, restoring the rest.
function withEnv(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  KEYS.forEach((key) => delete process.env[key]);
  Object.entries(vars).forEach(([key, value]) => { process.env[key] = value; });
  try {
    return fn();
  } finally {
    KEYS.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  }
}

test('OMEGA_SENTRY_ENABLED=false kills reporting outright', () => {
  const gates = withEnv({ OMEGA_SENTRY_ENABLED: 'false', OMEGA_BUILD_MODE: 'true' }, () => readGates());
  assert.strictEqual(gates.killed, true);
  assert.strictEqual(gates.killedReason, 'OMEGA_SENTRY_ENABLED=false');
});

test('a test run never reports, even a production-mode one', () => {
  const gates = withEnv({ OMEGA_TEST_RUNNER: '1', OMEGA_BUILD_MODE: 'true' }, () => readGates());
  assert.strictEqual(gates.killed, true);
  assert.match(gates.killedReason, /OMEGA_TEST_RUNNER/);
});

test('nothing set = nothing killed, and not production', () => {
  const gates = withEnv({}, () => readGates());
  assert.strictEqual(gates.killed, false);
  assert.strictEqual(gates.killedReason, null);
  assert.strictEqual(gates.isProduction, false);
  assert.strictEqual(gates.allowInDev, false);
});

test('OMEGA_BUILD_MODE is the production signal for a host with no runtime one', () => {
  assert.strictEqual(withEnv({ OMEGA_BUILD_MODE: 'true' }, () => readGates()).isProduction, true);
  assert.strictEqual(withEnv({ OMEGA_BUILD_MODE: 'false' }, () => readGates()).isProduction, false);
});

test("a host's own production signal wins over the build-mode default", () => {
  assert.strictEqual(withEnv({}, () => readGates({ isProduction: true })).isProduction, true);
  assert.strictEqual(withEnv({ OMEGA_BUILD_MODE: 'true' }, () => readGates({ isProduction: false })).isProduction, false);
});

test('dev reporting opens from either side: the env override or the host option', () => {
  assert.strictEqual(withEnv({ OMEGA_SENTRY_FORCE: 'true' }, () => readGates()).allowInDev, true);
  assert.strictEqual(withEnv({}, () => readGates({ allowInDev: true })).allowInDev, true);
  assert.strictEqual(withEnv({ OMEGA_SENTRY_FORCE: 'yes' }, () => readGates()).allowInDev, false, 'only the literal true opens it');
});
