/**
 * Test: test/authenticate
 * Tests different authentication methods using new RESTful API
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Authentication methods (RESTful)',
  type: 'group',
  tests: [
    // Test 1: Unauthenticated request
    {
      name: 'no-auth',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.get('backend-manager/test/authenticate');

        assert.isSuccess(response, 'Should succeed without auth');
        assert.equal(response.data.user.authenticated, false, 'User should not be authenticated');
      },
    },

    // Test 2: Private key authentication
    {
      name: 'private-key',
      auth: 'basic',
      async run({ http, assert, accounts }) {
        const response = await http.as('basic').get('backend-manager/test/authenticate');

        assert.isSuccess(response, 'Should succeed with privateKey');
        assert.equal(response.data.user.authenticated, true, 'User should be authenticated');
        assert.equal(response.data.user.auth.uid, accounts.basic.uid, 'UID should match');
      },
    },

    // Test 3: Invalid private key
    {
      name: 'invalid-private-key',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.withPrivateKey('invalid-key-12345').get('backend-manager/test/authenticate');

        assert.isSuccess(response, 'Should succeed but not authenticate');
        assert.equal(response.data.user.authenticated, false, 'Invalid key should not authenticate');
      },
    },

    // Test 4: Admin (admin key) authentication
    {
      name: 'admin-key-header',
      auth: 'admin',
      async run({ http, assert }) {
        const response = await http.as('admin').get('backend-manager/test/authenticate');

        assert.isSuccess(response, 'Should succeed with admin key');
        assert.equal(response.data.user.authenticated, true, 'User should be authenticated');
        assert.equal(response.data.user.roles?.admin, true, 'Should have admin role');
      },
    },

    // Test 5: The RETIRED wire — the real admin key as a request parameter
    // must NOT grant admin (only the omega-admin-key header does). Query and
    // body merge into the SAME request.data object authenticate() used to
    // read, so the query variant kills both lanes (the route is GET-only).
    {
      name: 'legacy-key-field-dead',
      auth: 'none',
      async run({ http, assert, config }) {
        const viaQuery = await http.as('none').get('backend-manager/test/authenticate', {
          backendManagerKey: config.adminKey,
        });

        assert.isSuccess(viaQuery, 'Request itself should succeed');
        assert.equal(viaQuery.data.user.authenticated, false, 'Legacy backendManagerKey param must NOT authenticate');
        assert.equal(viaQuery.data.user.roles?.admin ?? false, false, 'Legacy backendManagerKey param must NOT grant admin');
      },
    },
  ],
});
