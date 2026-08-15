/**
 * Test: the "missing analyticsId" notice is a debug-level line
 * ([#230](https://github.com/Omega-JS-Stack/omega/issues/230)).
 *
 * A brand with no GA4 id constructs Analytics() on every request (and on every
 * seeded user), and the answer never changes — so the notice sits at debug: silent
 * on a normal run, one `OMEGA_DEBUG=1` away when you are hunting a missing id. The
 * SKIP itself is untouched — every construction still returns un-initialized.
 *
 * The only stand-in here is `console` (the sink the logger writes to); the Manager
 * and ctx are the real booted ones, and the module under test is the real one.
 *
 * Run: npx omega test framework:helpers/analytics-no-id-notice
 */

const Analytics = require('../../src/manager/helpers/analytics.js');

// Record every console call the thunk makes, restoring console afterward.
function withConsoleRecorder(fn) {
  const calls = { log: [], debug: [], error: [] };
  const original = { log: console.log, debug: console.debug, error: console.error };

  console.log = (...args) => calls.log.push(args);
  console.debug = (...args) => calls.debug.push(args);
  console.error = (...args) => calls.error.push(args);

  try {
    fn();
    return calls;
  } finally {
    console.log = original.log;
    console.debug = original.debug;
    console.error = original.error;
  }
}

// Run the thunk with the debug switch in a known state — the logger reads it live.
function withDebug(value, fn) {
  const saved = process.env.OMEGA_DEBUG;

  if (value === undefined) {
    delete process.env.OMEGA_DEBUG;
  } else {
    process.env.OMEGA_DEBUG = value;
  }

  try {
    return fn();
  } finally {
    if (saved === undefined) {
      delete process.env.OMEGA_DEBUG;
    } else {
      process.env.OMEGA_DEBUG = saved;
    }
  }
}

// Run the thunk with the brand's GA4 id off — the real config object, restored
// after, the same way the logging suite swaps the real environment.
function withoutAnalyticsId(Manager, fn) {
  const google = Manager.config?.analytics?.providers?.google;
  const saved = google?.id;

  if (google) {
    google.id = undefined;
  }

  try {
    return fn();
  } finally {
    if (google) {
      google.id = saved;
    }
  }
}

const NOTICE = 'analytics(): Not initializing because missing analyticsId';

module.exports = {
  description: 'analytics(): the missing-analyticsId notice is debug-level',
  type: 'group',

  tests: [
    {
      name: 'the-notice-is-silent-on-a-normal-run',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'analytics-gate' });

        const calls = withConsoleRecorder(() => {
          withDebug(undefined, () => {
            withoutAnalyticsId(Manager, () => {
              new Analytics(Manager, { ctx: ctx });
              new Analytics(Manager, { ctx: ctx });
            });
          });
        });

        const notices = [...calls.log, ...calls.debug].filter((args) => args[1] === NOTICE);

        assert.equal(notices.length, 0, `the notice should be quiet by default, got ${notices.length}`);
      },
    },

    {
      name: 'the-notice-is-there-with-omega-debug',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'analytics-gate' });

        const calls = withConsoleRecorder(() => {
          withDebug('1', () => {
            withoutAnalyticsId(Manager, () => {
              new Analytics(Manager, { ctx: ctx });
              new Analytics(Manager, { ctx: ctx });
            });
          });
        });

        // No latch: with the gate open you asked for every occurrence.
        const notices = calls.debug.filter((args) => args[1] === NOTICE);

        assert.equal(notices.length, 2, `each construction should report under OMEGA_DEBUG, got ${notices.length}`);
        assert.equal(calls.log.filter((args) => args[1] === NOTICE).length, 0, 'the notice must not ride the log level');
      },
    },

    {
      name: 'the-quiet-construction-still-skips-analytics',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'analytics-gate' });

        let analytics;

        withConsoleRecorder(() => {
          withDebug(undefined, () => {
            withoutAnalyticsId(Manager, () => {
              analytics = new Analytics(Manager, { ctx: ctx });
            });
          });
        });

        assert.equal(analytics.initialized, false, 'a missing analyticsId must still skip initialization');
      },
    },
  ],
};
