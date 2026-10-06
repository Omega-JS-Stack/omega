/**
 * Test: GET/POST /admin/database
 * Tests the admin Realtime Database read/write endpoints
 * Requires admin authentication
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const TEST_PATH = '_test/database-test';

module.exports = defineCases({
  description: 'Admin Realtime Database read/write operations',
  type: 'group',
  tests: [
    // Test 1: Setup - write test data first
    {
      name: 'setup-test-data',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const testData = {
          testField: 'database-test-value',
          timestamp: new Date().toISOString(),
          nested: {
            field1: 'nested-value',
            field2: 123,
          },
        };

        const writeResponse = await http.post('omega/admin/database', {
          path: TEST_PATH,
          document: testData,
        });

        expect(writeResponse, 'Setup: Database write should succeed').toBeSuccess();
      },
    },

    // Test 2: Admin can read data
    {
      name: 'admin-read-succeeds',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/database', {
          path: TEST_PATH,
        });

        expect(readResponse, 'Database read should succeed with admin auth').toBeSuccess();
        expect(readResponse, 'Response should contain test data').toHaveProperty('data.testField');
        expect(readResponse.data.testField, 'Read data should match written data').toBe('database-test-value');
        expect(readResponse, 'Response should contain nested data').toHaveProperty('data.nested.field1');
        expect(readResponse.data.nested.field2, 'Nested field should match written data').toBe(123);
      },
    },

    // Test 3: Reading non-existent path returns empty/null
    {
      name: 'read-nonexistent-returns-null',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/database', {
          path: '_test/nonexistent-path-12345',
        });

        expect(readResponse, 'Reading non-existent path should succeed').toBeSuccess();
        const data = readResponse.data;
        const isEmpty = data === null
          || data === undefined
          || (typeof data === 'object' && Object.keys(data).length === 0);
        expect(isEmpty, `Non-existent path should return null, undefined, or empty object, got: ${JSON.stringify(data)}`).toBeTruthy();
      },
    },

    // Test 4: Missing path returns 400 error
    {
      name: 'missing-path-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/database', {});

        expect(readResponse, 'Missing path should return 400').toBeError(400);
      },
    },

    // Test 5: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/database', {
          path: TEST_PATH,
        });

        expect(readResponse, 'Database read should fail without authentication').toBeError(401);
      },
    },

    // Test 6: Non-admin user fails
    {
      name: 'non-admin-rejected',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/database', {
          path: TEST_PATH,
        });

        expect(readResponse, 'Database read should fail for non-admin user').toBeError(403);
      },
    },

  ],
});
