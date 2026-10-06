/**
 * Test: GET/POST /admin/firestore
 * Tests the admin Firestore read/write endpoints
 * Requires admin authentication
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const TEST_PATH = '_test/firestore-test-doc';

module.exports = defineCases({
  description: 'Admin Firestore read/write operations',
  type: 'group',
  tests: [
    // Test 1: Setup - write a test document first
    {
      name: 'setup-test-document',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const testData = {
          testField: 'read-test-value',
          timestamp: new Date().toISOString(),
          nested: {
            field1: 'nested-value',
            field2: 42,
          },
        };

        const writeResponse = await http.post('omega/admin/firestore', {
          path: TEST_PATH,
          document: testData,
        });

        expect(writeResponse, 'Setup: Firestore write should succeed').toBeSuccess();
      },
    },

    // Test 2: Admin can read document
    {
      name: 'admin-read-succeeds',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/firestore', {
          path: TEST_PATH,
        });

        expect(readResponse, 'Firestore read should succeed with admin auth').toBeSuccess();
        expect(readResponse, 'Response should contain test data').toHaveProperty('data.testField');
        expect(readResponse.data.testField, 'Read data should match written data').toBe('read-test-value');
        expect(readResponse, 'Response should contain nested data').toHaveProperty('data.nested.field1');
        expect(readResponse.data.nested.field2, 'Nested field should match written data').toBe(42);
      },
    },

    // Test 3: Reading non-existent document returns empty/undefined/null
    {
      name: 'read-nonexistent-returns-empty',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/firestore', {
          path: '_test/nonexistent-document-12345',
        });

        expect(readResponse, 'Reading non-existent document should succeed').toBeSuccess();
        const isEmpty = readResponse.data === undefined
          || readResponse.data === null
          || (typeof readResponse.data === 'object' && Object.keys(readResponse.data).length === 0);
        expect(isEmpty, 'Non-existent document should return undefined, null, or empty object').toBeTruthy();
      },
    },

    // Test 4: Missing path returns 400 error
    {
      name: 'missing-path-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/firestore', {});

        expect(readResponse, 'Missing path should return 400').toBeError(400);
      },
    },

    // Test 5: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/firestore', {
          path: TEST_PATH,
        });

        expect(readResponse, 'Firestore read should fail without authentication').toBeError(401);
      },
    },

    // Test 6: Non-admin user fails
    {
      name: 'non-admin-rejected',
      auth: 'user',
      timeout: 15000,

      async run({ http, expect }) {
        const readResponse = await http.get('omega/admin/firestore', {
          path: TEST_PATH,
        });

        expect(readResponse, 'Firestore read should fail for non-admin user').toBeError(403);
      },
    },

  ],
});
