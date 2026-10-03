/**
 * env tests: the switches, and which one wins (#380). The production gate is
 * the ONE environment (#817), never a build-mode flag of its own.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'env',
  tests: [
    {
      name: 'OMEGA_SENTRY_ENABLED=false kills reporting outright',
      run: (ctx) => {
        const gates = withEnv({ OMEGA_SENTRY_ENABLED: 'false', OMEGA_ENVIRONMENT: 'production' }, () => readGates());
        ctx.expect(gates.killed).toBe(true);
        ctx.expect(gates.killedReason).toBe('OMEGA_SENTRY_ENABLED=false');
      },
    },

    {
      name: 'a test run never reports: the one environment naming testing kills it',
      run: (ctx) => {
        const gates = withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => readGates());
        ctx.expect(gates.killed).toBe(true);
        ctx.expect(gates.killedReason).toBe('test run (OMEGA_ENVIRONMENT=testing)');
      },
    },

    {
      name: 'the retired runner flag kills nothing: a production run with it still reports',
      run: (ctx) => {
        const gates = withEnv({ OMEGA_TEST_RUNNER: '1', OMEGA_ENVIRONMENT: 'production' }, () => readGates());
        ctx.expect(gates.killed).toBe(false);
        ctx.expect(gates.killedReason).toBe(null);
      },
    },

    {
      name: 'no switch but the environment = nothing killed, and not production',
      run: (ctx) => {
        const gates = withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates());
        ctx.expect(gates.killed).toBe(false);
        ctx.expect(gates.killedReason).toBe(null);
        ctx.expect(gates.isProduction).toBe(false);
        ctx.expect(gates.allowInDev).toBe(false);
      },
    },

    // #817: the ONE environment is the production signal for a host that passes
    // none, and OMEGA_BUILD_MODE is no longer a signal of its own: a build-mode run
    // of a development artifact used to report as production.
    {
      name: 'the one environment is the production signal for a host with no runtime one',
      run: (ctx) => {
        ctx.expect(withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => readGates()).isProduction).toBe(true);
        ctx.expect(withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates()).isProduction).toBe(false);
        ctx.expect(withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => readGates()).isProduction).toBe(false);
      },
    },

    {
      name: 'OMEGA_BUILD_MODE decides nothing on its own any more',
      run: (ctx) => {
        ctx.expect(withEnv({ OMEGA_BUILD_MODE: 'true', OMEGA_ENVIRONMENT: 'development' }, () => readGates()).isProduction).toBe(false);
        ctx.expect(withEnv({ OMEGA_BUILD_MODE: 'false', OMEGA_ENVIRONMENT: 'production' }, () => readGates()).isProduction).toBe(true);
      },
    },

    {
      name: 'a browser-ish host answers from its baked config.environment',
      run: (ctx) => {
        // A desktop renderer bundle reads no env, so the gates read the same baked
        // fact every other surface answers from, off the host they were asked for.
        const gates = withEnv({}, () => readGates({ config: { environment: 'production' } }));
        ctx.expect(gates.isProduction).toBe(true);
      },
    },

    {
      name: 'a context that names no environment at all throws by name',
      run: (ctx) => {
        withEnv({}, () => ctx.expect(() => readGates()).toThrow(/OMEGA_ENVIRONMENT/));
      },
    },

    {
      name: "a host's own production signal wins over the environment default",
      run: (ctx) => {
        ctx.expect(withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates({ isProduction: true })).isProduction).toBe(true);
        ctx.expect(withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => readGates({ isProduction: false })).isProduction).toBe(false);
      },
    },

    {
      name: 'dev reporting opens from either side: the env override or the host option',
      run: (ctx) => {
        ctx.expect(withEnv({ OMEGA_SENTRY_FORCE: 'true', OMEGA_ENVIRONMENT: 'development' }, () => readGates()).allowInDev).toBe(true);
        ctx.expect(withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => readGates({ allowInDev: true })).allowInDev).toBe(true);
        ctx.expect(withEnv({ OMEGA_SENTRY_FORCE: 'yes', OMEGA_ENVIRONMENT: 'development' }, () => readGates()).allowInDev, 'only the literal true opens it').toBe(false);
      },
    },
  ],
});
