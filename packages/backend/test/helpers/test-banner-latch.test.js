/**
 * Test: the TEST-environment boot lines under the emulator vs deployed
 * ([#230](https://github.com/Omega-JS-Stack/omega/issues/230)).
 *
 * Under the emulator the banner and the resolved-test-mode line are SUPPRESSED:
 * a fresh functions worker boots per invocation (measured: 53 workers for 92
 * invocations on one seed), so a per-process line still prints ~53 times to say
 * what the emulator itself already says.
 *
 * A DEPLOYED process that resolves test mode is the opposite case — that is a
 * genuine alarm, so it stays loud there, once: `Manager.init()` can run more than
 * once inside a single process (the test runner, a custom server, a re-entrant
 * boot), and the banner is boot information, not per-init information.
 *
 * Real everything: the real Manager module, required fresh so its process-level
 * latch starts unset (this process already spent the booted Manager's one line),
 * booted against the same project dir the suite's Manager booted from. The only
 * stand-in is `console`, the sink the logger writes to.
 *
 * Run: npx omega test framework:helpers/test-banner-latch
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const MANAGER_PATH = require.resolve('../../dist/manager/index.js');

// A FRESH copy of the manager module, so the banner latch starts unset.
function freshManagerModule() {
  delete require.cache[MANAGER_PATH];

  return require(MANAGER_PATH);
}

// Record every console call the thunk makes, restoring console afterward.
function withConsoleRecorder(fn) {
  const calls = { log: [], error: [] };
  const original = { log: console.log, error: console.error };

  console.log = (...args) => calls.log.push(args);
  console.error = (...args) => calls.error.push(args);

  try {
    fn();
    return calls;
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
}

// Run the thunk with the environment resolving to testing — the branch that
// carries the banner — and with the emulator signal in a known state.
// getEnvironment() and the suppression read these vars live on every call.
function withTestEnvironment({ emulator }, fn) {
  const saved = {
    OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
  };

  process.env.OMEGA_TEST_MODE = 'true';

  if (emulator) {
    process.env.FUNCTIONS_EMULATOR = 'true';
  } else {
    delete process.env.FUNCTIONS_EMULATOR;
  }

  try {
    return fn();
  } finally {
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

const BANNER = 'Running in TEST environment';
const RESOLVED = 'test-mode resolved TEST_EXTENDED_MODE=';

// Two inits of a freshly-required manager module, with the console recorded.
function initTwice({ Manager, assert, emulator }) {
  const FreshManager = freshManagerModule();

  return withConsoleRecorder(() => {
    withTestEnvironment({ emulator: emulator }, () => {
      const first = new FreshManager();
      first.init(null, { cwd: Manager.cwd, log: false });

      assert.equal(first.isTesting(), true, 'the test-environment branch was not reached');

      new FreshManager().init(null, { cwd: Manager.cwd, log: false });
    });
  });
}

module.exports = defineCases({
  description: 'the TEST-environment boot lines: quiet under the emulator, once when deployed',
  type: 'group',

  tests: [
    {
      name: 'deployed-two-inits-log-the-banner-once',
      run: async ({ assert, Manager }) => {
        const calls = initTwice({ Manager: Manager, assert: assert, emulator: false });
        const banners = calls.log.filter((args) => String(args[1]).includes(BANNER));

        assert.equal(banners.length, 1, `the banner should log once per process, got ${banners.length}`);
      },
    },

    {
      name: 'deployed-two-inits-log-the-resolved-test-mode-once',
      run: async ({ assert, Manager }) => {
        // The resolved-mode line rides the test-mode watcher, which installs
        // exactly once per process — this pins that it stays that way.
        const calls = initTwice({ Manager: Manager, assert: assert, emulator: false });
        const resolved = calls.log.filter((args) => String(args[1]).includes(RESOLVED));

        assert.equal(resolved.length, 1, `the resolved test-mode line should log once per process, got ${resolved.length}`);
      },
    },

    {
      name: 'under-the-emulator-neither-line-prints',
      run: async ({ assert, Manager }) => {
        const calls = initTwice({ Manager: Manager, assert: assert, emulator: true });
        const banners = calls.log.filter((args) => String(args[1]).includes(BANNER));
        const resolved = calls.log.filter((args) => String(args[1]).includes(RESOLVED));

        assert.equal(banners.length, 0, `the emulator says it already — got ${banners.length} banner(s)`);
        assert.equal(resolved.length, 0, `the resolved test-mode line should be quiet under the emulator, got ${resolved.length}`);
      },
    },
  ],
});
