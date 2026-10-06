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
 * genuine alarm, so it stays loud there, once: `omega.initialize()` can run more than
 * once inside a single process (the test runner, a custom server, a re-entrant
 * boot), and the banner is boot information, not per-init information.
 *
 * Real everything: the real omega module and the test-mode watcher module,
 * required fresh so their process-level latches start unset (this process
 * already spent the booted omega's one line),
 * booted against the same project dir the suite's omega booted from. The only
 * stand-in is `console`, the sink the logger writes to.
 *
 * Run: npx omega test framework:helpers/test-banner-latch
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const OMEGA_PATH = require.resolve('../../dist/omega/index.js');
const TEST_MODE_PATH = require.resolve('../../dist/test/utils/test-mode-file.js');

// A FRESH copy of the omega module (and the watcher it installs), so the banner
// and the resolved-mode latches start unset.
function freshOmegaModule() {
  delete require.cache[OMEGA_PATH];
  delete require.cache[TEST_MODE_PATH];

  return require(OMEGA_PATH);
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
    OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR,
  };

  // The ONE environment input (#817): a test lane names testing.
  process.env.OMEGA_ENVIRONMENT = 'testing';

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

// Two boots of a freshly-required omega module, with the console recorded.
function initTwice({ omega, expect, emulator }) {
  const { Omega } = freshOmegaModule();

  return withConsoleRecorder(() => {
    withTestEnvironment({ emulator: emulator }, () => {
      const first = new Omega();
      first.initialize({ cwd: omega.cwd, runnerHost: true });

      expect(first.isTesting(), 'the test-environment branch was not reached').toBe(true);

      new Omega().initialize({ cwd: omega.cwd, runnerHost: true });
    });
  });
}

module.exports = defineCases({
  description: 'the TEST-environment boot lines: quiet under the emulator, once when deployed',
  type: 'group',

  tests: [
    {
      name: 'deployed-two-inits-log-the-banner-once',
      run: async ({ expect, omega }) => {
        const calls = initTwice({ omega: omega, expect: expect, emulator: false });
        const banners = calls.log.filter((args) => String(args[1]).includes(BANNER));

        expect(banners.length, `the banner should log once per process, got ${banners.length}`).toBe(1);
      },
    },

    {
      name: 'deployed-two-inits-log-the-resolved-test-mode-once',
      run: async ({ expect, omega }) => {
        // The resolved-mode line rides the test-mode watcher, which installs
        // exactly once per process — this pins that it stays that way.
        const calls = initTwice({ omega: omega, expect: expect, emulator: false });
        const resolved = calls.log.filter((args) => String(args[1]).includes(RESOLVED));

        expect(resolved.length, `the resolved test-mode line should log once per process, got ${resolved.length}`).toBe(1);
      },
    },

    {
      name: 'under-the-emulator-neither-line-prints',
      run: async ({ expect, omega }) => {
        const calls = initTwice({ omega: omega, expect: expect, emulator: true });
        const banners = calls.log.filter((args) => String(args[1]).includes(BANNER));
        const resolved = calls.log.filter((args) => String(args[1]).includes(RESOLVED));

        expect(banners.length, `the emulator says it already — got ${banners.length} banner(s)`).toBe(0);
        expect(resolved.length, `the resolved test-mode line should be quiet under the emulator, got ${resolved.length}`).toBe(0);
      },
    },
  ],
});
