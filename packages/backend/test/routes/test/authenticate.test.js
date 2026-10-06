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
      async run({ http, expect }) {
        const response = await http.get('omega/test/authenticate');

        expect(response, 'Should succeed without auth').toBeSuccess();
        expect(response.data.authenticated, 'User should not be authenticated').toBe(false);
      },
    },

    // Test 2: Private key authentication
    {
      name: 'private-key',
      auth: 'basic',
      async run({ http, expect, accounts }) {
        const response = await http.as('basic').get('omega/test/authenticate');

        expect(response, 'Should succeed with privateKey').toBeSuccess();
        expect(response.data.authenticated, 'User should be authenticated').toBe(true);
        expect(response.data.user.auth.uid, 'UID should match').toBe(accounts.basic.uid);
      },
    },

    // Test 3: Invalid private key
    {
      name: 'invalid-private-key',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.withPrivateKey('invalid-key-12345').get('omega/test/authenticate');

        expect(response, 'Should succeed but not authenticate').toBeSuccess();
        expect(response.data.authenticated, 'Invalid key should not authenticate').toBe(false);
      },
    },

    // Test 4: Admin (admin key) authentication
    {
      name: 'admin-key-header',
      auth: 'admin',
      async run({ http, expect }) {
        const response = await http.as('admin').get('omega/test/authenticate');

        expect(response, 'Should succeed with admin key').toBeSuccess();
        expect(response.data.authenticated, 'User should be authenticated').toBe(true);
        expect(response.data.user.roles?.admin, 'Should have admin role').toBe(true);
      },
    },

    // Test 5: The RETIRED wire — the real admin key as a request parameter
    // must NOT grant admin (only the omega-admin-key header does). Query and
    // body merge into the SAME request.data object authenticate() used to
    // read, so the query variant kills both lanes (the route is GET-only).
    {
      name: 'legacy-key-field-dead',
      auth: 'none',
      async run({ http, expect, config }) {
        const viaQuery = await http.as('none').get('omega/test/authenticate', {
          backendManagerKey: config.adminKey,
        });

        expect(viaQuery, 'Request itself should succeed').toBeSuccess();
        expect(viaQuery.data.authenticated, 'Legacy backendManagerKey param must NOT authenticate').toBe(false);
        expect(viaQuery.data.user.roles?.admin ?? false, 'Legacy backendManagerKey param must NOT grant admin').toBe(false);
      },
    },
  ],
});
