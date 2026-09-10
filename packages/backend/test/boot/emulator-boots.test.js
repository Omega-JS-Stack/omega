/**
 * Boot smoke — @omega.js/backend's framework self-test layer.
 *
 * Runs ONLY when `npx omega test` is invoked from the @omega.js/backend repo (the
 * runner points OMEGA_TEST_BOOT_PROJECT at src/test/fixtures/firebase-project and
 * sets isFrameworkSelfTest). It proves the whole self-test path works end to end:
 * the fixture's functions/index.js boots `Manager.init()` inside the emulator, the
 * `omega_api` function is wired, and the hosting rewrite routes to it.
 *
 * This is @omega.js/backend's equivalent of BXM's `boot/extension-loads` and UJM's site-boot
 * smoke. It is EXCLUDED from real-consumer runs (see runner.js discoverTests).
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Boot smoke — fixture emulator + omega_api reachable',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'omega_api-health-responds-over-hosting-rewrite',
      async run({ http, assert }) {
        const response = await http.get('omega/health');
        assert.isSuccess(response, 'omega_api /health should respond through the emulator hosting rewrite');
      },
    },
    {
      name: 'manager-booted-in-functions-runtime',
      async run({ http, assert }) {
        // /health is served by the omega_api function, which only exists if
        // Manager.init() ran in the fixture's functions runtime. A success here
        // means the local @omega.js/backend (symlinked into the fixture) booted.
        const response = await http.get('omega/health');
        assert.isSuccess(response, 'Manager.init() should have wired omega_api in the fixture functions runtime');
      },
    },
  ],
});
