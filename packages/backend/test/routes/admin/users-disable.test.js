/**
 * Test: routes/admin/users/disable
 * POST /admin/users/disable — auth-level disable/enable with refresh-token
 * revocation on disable. Read back through GET /admin/users/list (the auth
 * join carries the disabled flag). The round-trip re-enables the persona so
 * the fixture is left exactly how it was found.
 *
 * Run: npx omega test routes/admin/users-disable
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'routes/admin/users/disable',
  type: 'group',

  tests: [
    {
      name: 'disable-round-trip-via-auth-join',
      async run({ http, expect, accounts }) {
        const uid = accounts.refunded.uid;

        // Disable
        const disable = await http.as('admin').post('omega/admin/users/disable', { uid });
        expect(disable, 'disable responds').toBeSuccess();
        expect(disable.data.disabled === true, 'response reflects disabled').toBeTruthy();

        // Read back through the list route's auth join
        const listDisabled = await http.as('admin').get('omega/admin/users/list', { search: uid });
        expect(listDisabled, 'list responds').toBeSuccess();
        expect(listDisabled.data.users.length === 1, 'uid search finds the user').toBeTruthy();
        expect(listDisabled.data.users[0].auth.disabled === true, 'auth join shows disabled').toBeTruthy();

        // Re-enable (leave the persona how we found it)
        const enable = await http.as('admin').post('omega/admin/users/disable', { uid, disabled: false });
        expect(enable, 'enable responds').toBeSuccess();
        expect(enable.data.disabled === false, 'response reflects enabled').toBeTruthy();

        const listEnabled = await http.as('admin').get('omega/admin/users/list', { search: uid });
        expect(listEnabled.data.users[0].auth.disabled === false, 'auth join shows enabled again').toBeTruthy();
      },
    },

    {
      name: 'self-disable-blocked',
      async run({ http, expect, accounts }) {
        // Authenticate AS the admin user (private key) — .as('admin') is the
        // admin KEY, which carries no uid for the self-guard to match
        const response = await http.withPrivateKey(accounts.admin.privateKey).post('omega/admin/users/disable', { uid: accounts.admin.uid });

        expect(response, 'self-disable is refused').toBeError(400);
      },
    },

    {
      name: 'unknown-uid-404s',
      async run({ http, expect }) {
        const response = await http.as('admin').post('omega/admin/users/disable', { uid: 'no-such-user-omega-test' });

        expect(response, 'unknown uid 404s').toBeError(404);
      },
    },
  ],
});
