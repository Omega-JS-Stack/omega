// test-stealth predicate tests — the single source of truth for "keep test-run UI
// invisible and non-intrusive". Consumed by window-manager (stealth surfacing),
// main.js (macOS app-activation suppression), and the test harness.
//
// Build layer runs in plain Node, so the env-var contract (OMEGA_ENVIRONMENT,
// the ONE environment input since
// [#817](https://github.com/Omega-JS-Stack/omega/issues/817), plus
// OMEGA_TEST_SHOW) is exercised directly with save/restore around each case.

const isTestStealth = require('../../../utils/test-stealth.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

// Run fn with OMEGA_ENVIRONMENT / OMEGA_TEST_SHOW set to the given values (undefined = unset),
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

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'test-stealth predicate',
  tests: [
    {
      name: 'true in testing mode without OMEGA_TEST_SHOW',
      run: (ctx) => {
        withEnv({ OMEGA_ENVIRONMENT: 'testing', OMEGA_TEST_SHOW: undefined }, () => {
          ctx.expect(isTestStealth()).toBe(true);
        });
      },
    },
    {
      name: 'OMEGA_TEST_SHOW=1 opts out even in testing mode',
      run: (ctx) => {
        withEnv({ OMEGA_ENVIRONMENT: 'testing', OMEGA_TEST_SHOW: '1' }, () => {
          ctx.expect(isTestStealth()).toBe(false);
        });
      },
    },
    {
      name: 'false outside testing mode regardless of OMEGA_TEST_SHOW',
      run: (ctx) => {
        withEnv({ OMEGA_ENVIRONMENT: 'development', OMEGA_TEST_SHOW: undefined }, () => {
          ctx.expect(isTestStealth()).toBe(false);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'production', OMEGA_TEST_SHOW: '1' }, () => {
          ctx.expect(isTestStealth()).toBe(false);
        });
      },
    },
    {
      name: 'a provided instance answers from the config IT was baked with',
      run: (ctx) => {
        // An instance carrying the shared isTesting() answers like the runtime
        // `omega` instances: since #817 they all read the ONE input, the process
        // variable, or the baked `config.environment` when the process has none.
        const { isTesting } = require('../../../utils/mode-helpers.js');
        withEnv({ OMEGA_ENVIRONMENT: undefined, OMEGA_TEST_SHOW: undefined }, () => {
          const testing = { isTesting, config: { environment: 'testing' } };
          ctx.expect(isTestStealth(testing)).toBe(true);

          const production = { isTesting, config: { environment: 'production' } };
          ctx.expect(isTestStealth(production)).toBe(false);
        });
      },
    },
  ],
});
