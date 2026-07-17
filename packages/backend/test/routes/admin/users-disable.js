/**
 * Test: routes/admin/users/disable
 * POST /admin/users/disable — auth-level disable/enable with refresh-token
 * revocation on disable. Read back through GET /admin/users/list (the auth
 * join carries the disabled flag). The round-trip re-enables the persona so
 * the fixture is left exactly how it was found.
 *
 * Run: npx omega test routes/admin/users-disable
 */
module.exports = {
  description: 'routes/admin/users/disable',
  type: 'group',

  tests: [
    {
      name: 'disable-round-trip-via-auth-join',
      async run({ http, assert, accounts }) {
        const uid = accounts.refunded.uid;

        // Disable
        const disable = await http.as('admin').post('backend-manager/admin/users/disable', { uid });
        assert.isSuccess(disable, 'disable responds');
        assert.ok(disable.data.disabled === true, 'response reflects disabled');

        // Read back through the list route's auth join
        const listDisabled = await http.as('admin').get('backend-manager/admin/users/list', { search: uid });
        assert.isSuccess(listDisabled, 'list responds');
        assert.ok(listDisabled.data.users.length === 1, 'uid search finds the user');
        assert.ok(listDisabled.data.users[0].auth.disabled === true, 'auth join shows disabled');

        // Re-enable (leave the persona how we found it)
        const enable = await http.as('admin').post('backend-manager/admin/users/disable', { uid, disabled: false });
        assert.isSuccess(enable, 'enable responds');
        assert.ok(enable.data.disabled === false, 'response reflects enabled');

        const listEnabled = await http.as('admin').get('backend-manager/admin/users/list', { search: uid });
        assert.ok(listEnabled.data.users[0].auth.disabled === false, 'auth join shows enabled again');
      },
    },

    {
      name: 'self-disable-blocked',
      async run({ http, assert, accounts }) {
        // Authenticate AS the admin user (private key) — .as('admin') is the
        // admin KEY, which carries no uid for the self-guard to match
        const response = await http.withPrivateKey(accounts.admin.privateKey).post('backend-manager/admin/users/disable', { uid: accounts.admin.uid });

        assert.isError(response, 400, 'self-disable is refused');
      },
    },

    {
      name: 'unknown-uid-404s',
      async run({ http, assert }) {
        const response = await http.as('admin').post('backend-manager/admin/users/disable', { uid: 'no-such-user-omega-test' });

        assert.isError(response, 404, 'unknown uid 404s');
      },
    },
  ],
};
