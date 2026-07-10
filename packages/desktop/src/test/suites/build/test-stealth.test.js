// test-stealth predicate tests — the single source of truth for "keep test-run UI
// invisible and non-intrusive". Consumed by window-manager (stealth surfacing),
// main.js (macOS app-activation suppression), and the test harness.
//
// Build layer runs in plain Node, so the env-var contract (OMEGA_TEST_MODE /
// OMEGA_TEST_SHOW) is exercised directly with save/restore around each case.

const isTestStealth = require('../../../utils/test-stealth.js');

// Run fn with OMEGA_TEST_MODE / OMEGA_TEST_SHOW set to the given values (undefined = unset),
// restoring the real environment afterwards so other build suites are unaffected.
function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'test-stealth predicate',
  tests: [
    {
      name: 'true in testing mode without OMEGA_TEST_SHOW',
      run: (ctx) => {
        withEnv({ OMEGA_TEST_MODE: 'true', OMEGA_TEST_SHOW: undefined }, () => {
          ctx.expect(isTestStealth()).toBe(true);
        });
      },
    },
    {
      name: 'OMEGA_TEST_SHOW=1 opts out even in testing mode',
      run: (ctx) => {
        withEnv({ OMEGA_TEST_MODE: 'true', OMEGA_TEST_SHOW: '1' }, () => {
          ctx.expect(isTestStealth()).toBe(false);
        });
      },
    },
    {
      name: 'false outside testing mode regardless of OMEGA_TEST_SHOW',
      run: (ctx) => {
        withEnv({ OMEGA_TEST_MODE: undefined, OMEGA_TEST_SHOW: undefined, OMEGA_BUILD_MODE: undefined, NODE_ENV: 'development' }, () => {
          ctx.expect(isTestStealth()).toBe(false);
        });
      },
    },
    {
      name: 'a provided manager is authoritative over the env fallback',
      run: (ctx) => {
        // Build-time Manager carries the same mode-helpers mixin as the runtime
        // Managers — config.em.environment overrides the env detection.
        const Manager = require('../../../build.js');
        withEnv({ OMEGA_TEST_MODE: undefined, OMEGA_TEST_SHOW: undefined }, () => {
          const testing = new Manager();
          testing.config = { em: { environment: 'testing' } };
          ctx.expect(isTestStealth(testing)).toBe(true);

          const production = new Manager();
          production.config = { em: { environment: 'production' } };
          ctx.expect(isTestStealth(production)).toBe(false);
        });
      },
    },
  ],
};
