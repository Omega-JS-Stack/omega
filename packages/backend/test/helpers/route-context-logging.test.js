/**
 * Test: RouteContext logging — the ONE identity tag
 * ([#121](https://github.com/Omega-JS-Stack/omega/issues/121)).
 *
 * Every ctx line opens with `[@omega.js/backend:<module>]`, where the module
 * segment is the invocation's function name. Backend is server-side — Cloud
 * Logging stamps every entry — so the tag stands ALONE: no timestamp bracket.
 * The invocation id and any log prefix follow the tag.
 *
 * The only stand-in here is `console` itself (the external sink the logger
 * writes to); the ctx is a real one, built by Manager.RouteContext().
 *
 * Run: npx omega test backend:helpers/route-context-logging
 */

// Record every console call the thunk makes, restoring console afterward.
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

module.exports = {
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

        assert.equal(calls.log[0][0], `[@omega.js/backend:user-signup] ${ctx.id}:`);
        assert.equal(calls.log[0][1], 'Created user');
      },
    },

    {
      name: 'the-tag-stands-alone-no-timestamp-bracket',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'user-signup' });

        const calls = withConsoleRecorder((recorded) => {
          ctx.log('Created user');
          return recorded;
        });

        const prefix = calls.log[0][0];

        // The platform stamps the time; the line must open with the tag itself.
        assert.equal(prefix.startsWith('[@omega.js/backend:'), true);
        assert.equal(/^\[\d{4}-\d{2}-\d{2}T/.test(prefix), false);
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

        assert.equal(calls.log[0][0], `[@omega.js/backend:cron] ${ctx.id} cron/daily():`);
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

        assert.equal(calls.error[0][0], `[@omega.js/backend:user-signup] ${ctx.id}:`);
        assert.equal(calls.error[0][1], 'Something broke');
      },
    },
  ],
};
