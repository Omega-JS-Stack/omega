// boot-harness: hands the booted main-process instance to the boot test lane's
// harness. The runner sets OMEGA_TEST_BOOT=1 + OMEGA_TEST_BOOT_HARNESS=<absolute path>
// + OMEGA_TEST_BOOT_SPEC=<path> before spawning electron; the harness emits
// __OMEGA_TEST__ JSON lines on stdout (parsed by test/runners/boot.js) then
// app.exit()s.
//
// A runtime env-var path, never a static `require('./test/harness/...')`:
// @omega.js/desktop is bundled into the consumer's bundle, and a static require would
// either get inlined (bundling test code into production) or dead-code-eliminated.
// An env-var path stays external and can only resolve when the runner sets it.

const { TEST_EVENT_PREFIX } = require('./test-events.js');

/**
 * Start the boot harness against `omega` when this process is a boot test run.
 * @param {object} omega - the initialized main-process instance.
 */
function startBootHarness(omega) {
  // Only a boot test run carries the flag; every other boot returns here
  if (process.env.OMEGA_TEST_BOOT !== '1') {
    return;
  }

  global.__omega_instance = omega;
  const harnessPath = process.env.OMEGA_TEST_BOOT_HARNESS;

  if (!harnessPath) {
    fail('OMEGA_TEST_BOOT=1 but OMEGA_TEST_BOOT_HARNESS not set');
    return;
  }

  // Defer the harness so the consumer's `omega.initialize().then(() => { ... })`
  // callback gets a chance to run first. @omega.js/desktop doesn't auto-create any
  // windows; the consumer's main.js does it inside .then(). Run synchronously and
  // that callback hasn't fired yet, so `omega.windows.get('main')` would be null.
  // setImmediate flushes the microtask queue (where promise callbacks live)
  // before the boot harness inspects state.
  setImmediate(() => {
    try {
      // A variable specifier, so the bundler leaves the call alone and it
      // resolves at RUNTIME against the path the runner set (see above).
      const harness = require(harnessPath);
      harness.run(omega);
    } catch (e) {
      fail(`boot harness failed to load: ${e.message}`);
    }
  });
}

// Report a fatal harness event on the runner's channel and end the run
function fail(message) {
  process.stdout.write(`${TEST_EVENT_PREFIX}${JSON.stringify({ event: 'fatal', message })}\n`);
  require('electron').app.exit(1);
}

module.exports = startBootHarness;
