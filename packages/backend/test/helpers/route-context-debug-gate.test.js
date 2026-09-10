/**
 * Test: `debug` is an opt-in level
 * ([#230](https://github.com/Omega-JS-Stack/omega/issues/230)).
 *
 * Every other level writes unconditionally. `debug` writes NOTHING unless
 * `OMEGA_DEBUG` is set in the environment — that is what makes "demote it to
 * debug" a real reduction rather than a rename: nothing is deleted, it is one
 * env var away.
 *
 * The only stand-in here is `console` (the sink the logger writes to); the ctx is
 * a real one, built by Manager.RouteContext().
 *
 * Run: npx omega test framework:helpers/route-context-debug-gate
 */

// Record every console call the thunk makes, restoring console afterward.

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
function withConsoleRecorder(fn) {
  const calls = { log: [], debug: [], warn: [], error: [] };
  const original = { log: console.log, debug: console.debug, warn: console.warn, error: console.error };

  console.log = (...args) => calls.log.push(args);
  console.debug = (...args) => calls.debug.push(args);
  console.warn = (...args) => calls.warn.push(args);
  console.error = (...args) => calls.error.push(args);

  try {
    fn();
    return calls;
  } finally {
    console.log = original.log;
    console.debug = original.debug;
    console.warn = original.warn;
    console.error = original.error;
  }
}

// Run the thunk with the debug switch in a known state. The logger reads it live
// on every line, so flipping the var IS the switch.
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

module.exports = defineCases({
  description: 'ctx.debug writes only when OMEGA_DEBUG is set',
  type: 'group',

  tests: [
    {
      name: 'debug-is-silent-by-default',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'debug-gate' });

        const calls = withConsoleRecorder(() => {
          withDebug(undefined, () => {
            ctx.debug('a big payload', { secret: 'sauce' });
          });
        });

        assert.equal(calls.debug.length, 0, 'a debug line must not reach console.debug by default');
        assert.equal(calls.log.length, 0, 'a debug line must not fall through to console.log either');
      },
    },

    {
      name: 'debug-writes-when-omega-debug-is-set',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'debug-gate' });

        const calls = withConsoleRecorder(() => {
          withDebug('1', () => {
            ctx.debug('a big payload', { secret: 'sauce' });
          });
        });

        assert.equal(calls.debug.length, 1, 'OMEGA_DEBUG should let the line through');
        assert.equal(calls.debug[0][0].endsWith(`[@omega.js/backend:debug-gate] ${ctx.id}:`), true, calls.debug[0][0]);
        assert.equal(calls.debug[0][1], 'a big payload', calls.debug[0][1]);
      },
    },

    {
      name: 'every-other-level-is-untouched-by-the-gate',
      run: async ({ assert, Manager }) => {
        const ctx = Manager.RouteContext({}, { functionName: 'debug-gate' });

        const calls = withConsoleRecorder(() => {
          withDebug(undefined, () => {
            ctx.log('log line');
            ctx.warn('warn line');
            ctx.error('error line');
          });
        });

        assert.equal(calls.log.length, 1, 'ctx.log must still write with the debug gate closed');
        assert.equal(calls.warn.length, 1, 'ctx.warn must still write with the debug gate closed');
        assert.equal(calls.error.length, 1, 'ctx.error must still write with the debug gate closed');
      },
    },
  ],
});
