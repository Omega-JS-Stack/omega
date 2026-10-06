/**
 * Test: GET /admin/stats
 * Tests the admin get stats endpoint
 * Requires admin authentication
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Admin get stats operation',
  type: 'group',
  tests: [
    // Test 1: Admin can get stats
    {
      name: 'admin-get-stats-succeeds',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.get('omega/admin/stats', {});

        expect(response, 'Get stats should succeed with admin auth').toBeSuccess();
        expect(typeof response.data === 'object', 'Response data should be an object').toBeTruthy();
      },
    },

    // Test 2: Stats contains users field
    {
      name: 'stats-contains-users',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.get('omega/admin/stats', {});

        expect(response, 'Get stats should succeed').toBeSuccess();
        expect(response, 'Stats should contain users field').toHaveProperty('data.users');
        expect(response, 'Users should have total field').toHaveProperty('data.users.total');
        expect(typeof response.data.users.total === 'number', 'users.total should be a number').toBeTruthy();
      },
    },

    // Test 3: Stats with update flag refreshes data
    {
      name: 'stats-with-update',
      auth: 'admin',
      timeout: 60000,

      async run({ http, expect }) {
        const response = await http.get('omega/admin/stats', {
          update: { users: true },
        });

        expect(response, 'Get stats with update should succeed').toBeSuccess();
        expect(response, 'Updated stats should have users.total').toHaveProperty('data.users.total');
        expect(response.data.users.total >= 0, 'users.total should be a non-negative number').toBeTruthy();
      },
    },

    // Test 4: Stats contains metadata
    {
      name: 'stats-has-metadata',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        await http.get('omega/admin/stats', {
          update: { users: true },
        });

        const response = await http.get('omega/admin/stats', {});

        expect(response, 'Get stats should succeed').toBeSuccess();
        if (response.data.metadata) {
          expect(response, 'Metadata should have updated timestamp').toHaveProperty('data.metadata.updated');
        }
      },
    },

    // Test 5: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/admin/stats', {});

        expect(response, 'Get stats should fail without authentication').toBeError(401);
      },
    },

    // Test 6: Non-admin user fails
    {
      name: 'non-admin-rejected',
      auth: 'user',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/admin/stats', {});

        expect(response, 'Get stats should fail for non-admin user').toBeError(403);
      },
    },
  ],
});
