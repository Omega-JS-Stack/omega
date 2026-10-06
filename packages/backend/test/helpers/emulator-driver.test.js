/**
 * Test: the `emulator` row driver, the one place a backend case gets its
 * extras: which auth a case's `http` carries, and the pre-flight that stops a
 * run before any case when the stack is not there.
 *
 * `applyAuth` is pure: a case in, `setAuth` calls out, read off a recording
 * `http` and a plain accounts table. The health check is real: a loopback port
 * nothing listens on, so no emulator is needed.
 *
 * Run: npx omega test backend:helpers/emulator-driver
 */
const { createEmulatorDriver, applyAuth } = require('../../dist/test/emulator-driver.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const ACCOUNTS = { basic: { privateKey: 'b' }, premium: { privateKey: 'p' } };
const ADMIN_KEY = 'the-admin-key';

// An http that only records what auth it was given.
function recordingHttp() {
  const calls = [];
  return { calls, setAuth: (type, credentials) => calls.push({ type, credentials }) };
}

// The auth one case resolves to, applied to a fresh recording http.
function authCalls(info) {
  const http = recordingHttp();
  applyAuth(http, info, { accounts: ACCOUNTS, adminKey: ADMIN_KEY });
  return http.calls;
}

module.exports = defineCases({
  description: 'the emulator driver: per-case auth, and the health check pre-flight',
  type: 'group',

  tests: [
    {
      name: 'case-117-a-case-takes-its-own-auth-else-the-suite-auth-else-none',
      async run({ expect }) {
        expect(authCalls({ auth: 'admin', suite: { auth: 'basic' } }), 'the case auth wins').toEqual([{ type: 'adminKey', credentials: { key: ADMIN_KEY } }]);
        expect(authCalls({ suite: { auth: 'basic' } }), 'the suite auth fills in').toEqual([{ type: 'privateKey', credentials: { privateKey: 'b' } }]);
        expect(authCalls({ auth: 'premium', suite: {} })).toEqual([{ type: 'privateKey', credentials: { privateKey: 'p' } }]);
        expect(authCalls({ auth: 'user', suite: {} }), 'user is the basic account').toEqual([{ type: 'privateKey', credentials: { privateKey: 'b' } }]);
        expect(authCalls({ suite: {} }).map(({ type }) => type), 'neither is none').toEqual(['none']);
      },
    },

    {
      name: 'case-118-start-rejects-naming-the-health-check-when-nothing-answers',
      timeout: 10000,
      async run({ expect }) {
        const driver = createEmulatorDriver({
          config: {
            apiUrl: 'http://127.0.0.1:1',
            timeout: 300,
            adminKey: ADMIN_KEY,
            webhookKey: 'the-webhook-key',
            brand: { id: 'emulator-driver-test' },
            domain: 'example.com',
          },
          admin: null,
          omega: null,
          ctx: null,
        });

        await expect(driver.start({ hooks: [] })).rejects.toThrow(/health/i);
      },
    },
  ],
});
