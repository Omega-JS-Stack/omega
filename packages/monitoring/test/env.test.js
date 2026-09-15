/**
 * env tests: the switches, and which one wins (#380). The production gate is
 * the ONE environment (#817), never a build-mode flag of its own.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { readGates } = require('../src/env.js');

// OMEGA_ENVIRONMENT is in the set because the production gate reads the ONE
// environment now (#817), not a build-mode flag of its own.
const KEYS = ['OMEGA_SENTRY_ENABLED', 'OMEGA_SENTRY_FORCE', 'OMEGA_BUILD_MODE', 'OMEGA_TEST_RUNNER', 'OMEGA_ENVIRONMENT'];

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
  const gates = withEnv({ OMEGA_SENTRY_ENABLED: 'false', OMEGA_ENVIRONMENT: 'production' }, () => readGates());
  assert.strictEqual(gates.killed, true);
  assert.strictEqual(gates.killedReason, 'OMEGA_SENTRY_ENABLED=false');
});

test('a test run never reports, even a production-mode one', () => {
  const gates = withEnv({ OMEGA_TEST_RUNNER: '1', OMEGA_ENVIRONMENT: 'production' }, () => readGates());
  assert.strictEqual(gates.killed, true);
  assert.match(gates.killedReason, /OMEGA_TEST_RUNNER/);
});

test('no switch but the environment = nothing killed, and not production', () => {
  const gates = withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates());
  assert.strictEqual(gates.killed, false);
  assert.strictEqual(gates.killedReason, null);
  assert.strictEqual(gates.isProduction, false);
  assert.strictEqual(gates.allowInDev, false);
});

// #817: the ONE environment is the production signal for a host that passes
// none, and OMEGA_BUILD_MODE is no longer a signal of its own: a build-mode run
// of a development artifact used to report as production.
test('the one environment is the production signal for a host with no runtime one', () => {
  assert.strictEqual(withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => readGates()).isProduction, true);
  assert.strictEqual(withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates()).isProduction, false);
  assert.strictEqual(withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => readGates()).isProduction, false);
});

test('OMEGA_BUILD_MODE decides nothing on its own any more', () => {
  assert.strictEqual(withEnv({ OMEGA_BUILD_MODE: 'true', OMEGA_ENVIRONMENT: 'development' }, () => readGates()).isProduction, false);
  assert.strictEqual(withEnv({ OMEGA_BUILD_MODE: 'false', OMEGA_ENVIRONMENT: 'production' }, () => readGates()).isProduction, true);
});

test('a browser-ish host answers from its baked config.environment', () => {
  // A desktop renderer bundle reads no env, so the gates read the same baked
  // fact every other surface answers from, off the host they were asked for.
  const gates = withEnv({}, () => readGates({ config: { environment: 'production' } }));
  assert.strictEqual(gates.isProduction, true);
});

test('a context that names no environment at all throws by name', () => {
  withEnv({}, () => assert.throws(() => readGates(), /OMEGA_ENVIRONMENT/));
});

test("a host's own production signal wins over the environment default", () => {
  assert.strictEqual(withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates({ isProduction: true })).isProduction, true);
  assert.strictEqual(withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => readGates({ isProduction: false })).isProduction, false);
});

test('dev reporting opens from either side: the env override or the host option', () => {
  assert.strictEqual(withEnv({ OMEGA_SENTRY_FORCE: 'true', OMEGA_ENVIRONMENT: 'development' }, () => readGates()).allowInDev, true);
  assert.strictEqual(withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates({ allowInDev: true })).allowInDev, true);
  assert.strictEqual(withEnv({ OMEGA_SENTRY_FORCE: 'yes', OMEGA_ENVIRONMENT: 'development' }, () => readGates()).allowInDev, false, 'only the literal true opens it');
});
