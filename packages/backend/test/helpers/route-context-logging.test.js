/**
 * Test: RouteContext logging — the ONE identity tag
 * ([#121](https://github.com/Omega-JS-Stack/omega/issues/121)) and the local
 * timestamp ([#130](https://github.com/Omega-JS-Stack/omega/issues/130)).
 *
 * Every ctx line opens with `[@omega.js/backend:<module>]`, where the module
 * segment is the invocation's function name. The invocation id and any log
 * prefix follow the tag.
 *
 * In production Cloud Logging stamps every entry, so the tag opens the line with
 * no timestamp bracket. Outside production nothing stamps a plain local run, so a
 * short `[HH:MM:SS]` bracket comes first — both branches are pinned below.
 *
 * The only stand-in here is `console` itself (the external sink the logger
 * writes to); the ctx is a real one, built by Manager.RouteContext().
 *
 * Run: npx omega test backend:helpers/route-context-logging
 */

// Record every console call the thunk makes, restoring console afterward.

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
function withConsoleRecorder(fn) {
  const calls = { log: [], error: [] };
  const original = { log: console.log, error: console.error };

  console.log = (...args) => calls.log.push(args);
  console.error = (...args) => calls.error.push(args);

  try {
    return fn(calls);
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
}

// Run the thunk with the environment resolving to production. getEnvironment() reads
// these vars live on every call, so swapping them is the real switch — testing wins
// over everything else, so it has to come off too.
function withProductionEnvironment(fn) {
  const original = {
    OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE,
    ENVIRONMENT: process.env.ENVIRONMENT,
    TERM_PROGRAM: process.env.TERM_PROGRAM,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
  };

  delete process.env.OMEGA_TEST_MODE;
  delete process.env.TERM_PROGRAM;
  delete process.env.FUNCTIONS_EMULATOR;
  process.env.ENVIRONMENT = 'production';

  try {
    return fn();
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

// [HH:MM:SS] followed by the identity tag.
const LOCAL_LINE = /^\[\d{2}:\d{2}:\d{2}\] \[@omega\.js\/backend:/;

module.exports = defineCases({
  description: 'ctx.log carries the [@omega.js/backend:<module>] identity tag',
  type: 'group',

  tests: [
    {
      name: 'ctx-log-opens-with-the-identity-tag',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'user-signup' });

        const calls = withConsoleRecorder((recorded) => {
          ctx.log('Created user');
          return recorded;
        });

        assert.equal(calls.log[0][0].endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), true, calls.log[0][0]);
        assert.equal(calls.log[0][1], 'Created user');
      },
    },

    {
      name: 'outside-production-the-line-opens-with-a-local-timestamp',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'user-signup' });

        // The suite's own environment is non-production — that IS the local branch.
        assert.equal(ctx.isProduction(), false, 'the suite must run outside production for this test');

        const calls = withConsoleRecorder((recorded) => {
          ctx.log('Created user');
          return recorded;
        });

        const prefix = calls.log[0][0];

        // Nothing stamps a plain local run, so the logger does it.
        assert.equal(LOCAL_LINE.test(prefix), true, `local line should open with [HH:MM:SS] then the tag, got: ${prefix}`);
        assert.equal(prefix.endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), true, prefix);
      },
    },

    {
      name: 'in-production-the-tag-stands-alone-no-timestamp-bracket',
      run: async ({ assert, Manager }) => {
        const line = withProductionEnvironment(() => {
          const ctx = Manager.RouteContext({}, { functionName: 'user-signup' });

          assert.equal(ctx.isProduction(), true, 'the production branch was not reached');

          const calls = withConsoleRecorder((recorded) => {
            ctx.log('Created user');
            return recorded;
          });

          return { prefix: calls.log[0][0], id: ctx.id };
        });

        // Cloud Logging stamps the entry; a hand-written time would be a second one.
        assert.equal(line.prefix, `[@omega.js/backend:user-signup] ${line.id}:`, line.prefix);
        assert.equal(/^\[\d{2}:\d{2}:\d{2}\]/.test(line.prefix), false, `production line carries a timestamp: ${line.prefix}`);
        assert.equal(/^\[\d{4}-\d{2}-\d{2}T/.test(line.prefix), false, `production line carries a timestamp: ${line.prefix}`);
      },
    },

    {
      name: 'under-the-emulator-the-line-is-stamped-like-any-local-run',
      run: async ({ assert, Manager }) => {
        const saved = process.env.FUNCTIONS_EMULATOR;
        const savedTestMode = process.env.OMEGA_TEST_MODE;
        const savedEnvironment = process.env.ENVIRONMENT;
        process.env.FUNCTIONS_EMULATOR = 'true';
        // Drop the runner's test-mode flag AND its ENVIRONMENT so getEnvironment()
        // genuinely resolves through the FUNCTIONS_EMULATOR branch — with either
        // set, resolution short-circuits before the emulator check and this test
        // would duplicate the local-run one.
        delete process.env.OMEGA_TEST_MODE;
        delete process.env.ENVIRONMENT;
        try {
          const ctx = Manager.RouteContext({}, { functionName: 'user-signup' });

          // The emulator's `>` functions prefix carries no time, so emulator lines
          // are stamped exactly like any other non-production run.
          assert.equal(Manager.getEnvironment(), 'development', 'the emulator branch must resolve as development');

          const calls = withConsoleRecorder((recorded) => {
            ctx.log('Created user');
            return recorded;
          });

          const prefix = calls.log[0][0];
          assert.equal(LOCAL_LINE.test(prefix), true, `emulator line should open with [HH:MM:SS], got: ${prefix}`);
          assert.equal(prefix.endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), true, prefix);
        } finally {
          if (saved === undefined) {
            delete process.env.FUNCTIONS_EMULATOR;
          } else {
            process.env.FUNCTIONS_EMULATOR = saved;
          }
          if (savedTestMode === undefined) {
            delete process.env.OMEGA_TEST_MODE;
          } else {
            process.env.OMEGA_TEST_MODE = savedTestMode;
          }
          if (savedEnvironment === undefined) {
            delete process.env.ENVIRONMENT;
          } else {
            process.env.ENVIRONMENT = savedEnvironment;
          }
        }
      },
    },

    {
      name: 'a-log-prefix-follows-the-tag',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'cron' });

        ctx.setLogPrefix('cron/daily()');

        const calls = withConsoleRecorder((recorded) => {
          ctx.log('Starting...');
          return recorded;
        });

        assert.equal(calls.log[0][0].endsWith(`[@omega.js/backend:cron] ${ctx.id} cron/daily():`), true, calls.log[0][0]);
      },
    },

    {
      name: 'every-level-carries-the-same-tag',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'user-signup' });

        const calls = withConsoleRecorder((recorded) => {
          ctx.error('Something broke');
          return recorded;
        });

        assert.equal(calls.error[0][0].endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), true, calls.error[0][0]);
        assert.equal(LOCAL_LINE.test(calls.error[0][0]), true, `every level gets the local stamp: ${calls.error[0][0]}`);
        assert.equal(calls.error[0][1], 'Something broke');
      },
    },
  ],
});
