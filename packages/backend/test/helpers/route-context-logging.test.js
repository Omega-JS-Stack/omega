/**
 * Test: Context logging — the ONE identity tag
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
 * writes to); the ctx is a real one, a real Context.
 *
 * Run: npx omega test backend:helpers/route-context-logging
 */

// Record every console call the thunk makes, restoring console afterward.

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const Context = require('../../dist/omega/context.js');
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
// these vars live on every call, so swapping them is the real switch — the test
// lane's OMEGA_ENVIRONMENT=testing is overwritten, and the ambient signals come off.
function withProductionEnvironment(fn) {
  const original = {
    OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT,
    ENVIRONMENT: process.env.ENVIRONMENT,
    TERM_PROGRAM: process.env.TERM_PROGRAM,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
  };

  delete process.env.TERM_PROGRAM;
  delete process.env.FUNCTIONS_EMULATOR;
  // The ONE environment input (#817): a deployed production run is what this
  // simulates, so the lane names it outright.
  process.env.OMEGA_ENVIRONMENT = 'production';
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
      run: async ({ expect, omega }) => {
        const ctx = new Context(omega, {}, { functionName: 'user-signup' });

        const calls = withConsoleRecorder((recorded) => {
          ctx.log('Created user');
          return recorded;
        });

        expect(calls.log[0][0].endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), calls.log[0][0]).toBe(true);
        expect(calls.log[0][1]).toBe('Created user');
      },
    },

    {
      name: 'outside-production-the-line-opens-with-a-local-timestamp',
      run: async ({ expect, omega }) => {
        const ctx = new Context(omega, {}, { functionName: 'user-signup' });

        // The suite's own environment is non-production — that IS the local branch.
        expect(ctx.isProduction(), 'the suite must run outside production for this test').toBe(false);

        const calls = withConsoleRecorder((recorded) => {
          ctx.log('Created user');
          return recorded;
        });

        const prefix = calls.log[0][0];

        // Nothing stamps a plain local run, so the logger does it.
        expect(LOCAL_LINE.test(prefix), `local line should open with [HH:MM:SS] then the tag, got: ${prefix}`).toBe(true);
        expect(prefix.endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), prefix).toBe(true);
      },
    },

    {
      name: 'in-production-the-tag-stands-alone-no-timestamp-bracket',
      run: async ({ expect, omega }) => {
        const line = withProductionEnvironment(() => {
          const ctx = new Context(omega, {}, { functionName: 'user-signup' });

          expect(ctx.isProduction(), 'the production branch was not reached').toBe(true);

          const calls = withConsoleRecorder((recorded) => {
            ctx.log('Created user');
            return recorded;
          });

          return { prefix: calls.log[0][0], id: ctx.id };
        });

        // Cloud Logging stamps the entry; a hand-written time would be a second one.
        expect(line.prefix, line.prefix).toBe(`[@omega.js/backend:user-signup] ${line.id}:`);
        expect(/^\[\d{2}:\d{2}:\d{2}\]/.test(line.prefix), `production line carries a timestamp: ${line.prefix}`).toBe(false);
        expect(/^\[\d{4}-\d{2}-\d{2}T/.test(line.prefix), `production line carries a timestamp: ${line.prefix}`).toBe(false);
      },
    },

    {
      name: 'under-the-emulator-the-line-is-stamped-like-any-local-run',
      run: async ({ expect, omega }) => {
        const saved = process.env.FUNCTIONS_EMULATOR;
        const savedEnvironment = process.env.ENVIRONMENT;
        const savedInput = process.env.OMEGA_ENVIRONMENT;
        process.env.FUNCTIONS_EMULATOR = 'true';
        // An emulator run is a DEVELOPMENT lane, and the boot names the input
        // from exactly that ambient answer (#817). Naming it here is what a real
        // emulator boot leaves in the process, over the lane's own `testing`, so
        // this does not duplicate the local-run case.
        delete process.env.ENVIRONMENT;
        process.env.OMEGA_ENVIRONMENT = 'development';
        try {
          const ctx = new Context(omega, {}, { functionName: 'user-signup' });

          // The emulator's `>` functions prefix carries no time, so emulator lines
          // are stamped exactly like any other non-production run.
          expect(omega.getEnvironment(), 'the emulator branch must resolve as development').toBe('development');

          const calls = withConsoleRecorder((recorded) => {
            ctx.log('Created user');
            return recorded;
          });

          const prefix = calls.log[0][0];
          expect(LOCAL_LINE.test(prefix), `emulator line should open with [HH:MM:SS], got: ${prefix}`).toBe(true);
          expect(prefix.endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), prefix).toBe(true);
        } finally {
          if (saved === undefined) {
            delete process.env.FUNCTIONS_EMULATOR;
          } else {
            process.env.FUNCTIONS_EMULATOR = saved;
          }
          if (savedEnvironment === undefined) {
            delete process.env.ENVIRONMENT;
          } else {
            process.env.ENVIRONMENT = savedEnvironment;
          }
          if (savedInput === undefined) {
            delete process.env.OMEGA_ENVIRONMENT;
          } else {
            process.env.OMEGA_ENVIRONMENT = savedInput;
          }
        }
      },
    },

    {
      name: 'a-log-prefix-follows-the-tag',
      run: async ({ expect, omega }) => {
        const ctx = new Context(omega, {}, { functionName: 'cron' });

        ctx.setLogPrefix('cron/daily()');

        const calls = withConsoleRecorder((recorded) => {
          ctx.log('Starting...');
          return recorded;
        });

        expect(calls.log[0][0].endsWith(`[@omega.js/backend:cron] ${ctx.id} cron/daily():`), calls.log[0][0]).toBe(true);
      },
    },

    {
      name: 'every-level-carries-the-same-tag',
      run: async ({ expect, omega }) => {
        const ctx = new Context(omega, {}, { functionName: 'user-signup' });

        const calls = withConsoleRecorder((recorded) => {
          ctx.error('Something broke');
          return recorded;
        });

        expect(calls.error[0][0].endsWith(`[@omega.js/backend:user-signup] ${ctx.id}:`), calls.error[0][0]).toBe(true);
        expect(LOCAL_LINE.test(calls.error[0][0]), `every level gets the local stamp: ${calls.error[0][0]}`).toBe(true);
        expect(calls.error[0][1]).toBe('Something broke');
      },
    },
  ],
});
