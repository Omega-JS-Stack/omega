/**
 * Test: POST /admin/firestore/query
 * Tests the admin Firestore query endpoint
 * Requires admin authentication
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const TEST_COLLECTION = '_test_query';

module.exports = defineCases({
  description: 'Admin Firestore query operation',
  type: 'suite',
  timeout: 30000,

  tests: [
    // Test 1: Setup - write test documents
    {
      name: 'setup-test-documents',
      async run({ http, expect, state }) {
        state.testDocs = [
          { name: 'doc1', category: 'alpha', value: 10 },
          { name: 'doc2', category: 'alpha', value: 20 },
          { name: 'doc3', category: 'beta', value: 30 },
        ];

        for (let i = 0; i < state.testDocs.length; i++) {
          const doc = state.testDocs[i];
          const response = await http.as('admin').post('omega/admin/firestore', {
            path: `${TEST_COLLECTION}/doc${i + 1}`,
            document: doc,
          });
          expect(response, `Setup: Writing doc${i + 1} should succeed`).toBeSuccess();
        }
      },
    },

    // Test 2: Query all documents in collection
    {
      name: 'query-all-documents',
      async run({ http, expect, state }) {
        const queryResponse = await http.as('admin').post('omega/admin/firestore/query', {
          queries: [
            { collection: TEST_COLLECTION },
          ],
        });

        expect(queryResponse, 'Query should succeed').toBeSuccess();
        expect(Array.isArray(queryResponse.data), 'Response should be an array').toBeTruthy();
        expect(queryResponse.data.length >= 3, `Should find at least 3 documents, found ${queryResponse.data.length}`).toBeTruthy();
      },
    },

    // Test 3: Query with where clause
    {
      name: 'query-with-where',
      async run({ http, expect }) {
        const queryResponse = await http.as('admin').post('omega/admin/firestore/query', {
          queries: [
            {
              collection: TEST_COLLECTION,
              where: [
                { field: 'category', operator: '==', value: 'alpha' },
              ],
            },
          ],
        });

        expect(queryResponse, 'Query with where should succeed').toBeSuccess();
        expect(Array.isArray(queryResponse.data), 'Response should be an array').toBeTruthy();
        expect(queryResponse.data.length, 'Should find exactly 2 alpha documents').toBe(2);

        queryResponse.data.forEach(doc => {
          expect(doc.data.category, 'All results should be category alpha').toBe('alpha');
        });
      },
    },

    // Test 4: Query with limit
    {
      name: 'query-with-limit',
      async run({ http, expect }) {
        const queryResponse = await http.as('admin').post('omega/admin/firestore/query', {
          queries: [
            {
              collection: TEST_COLLECTION,
              limit: 2,
            },
          ],
        });

        expect(queryResponse, 'Query with limit should succeed').toBeSuccess();
        expect(queryResponse.data.length <= 2, `Should return at most 2 documents, got ${queryResponse.data.length}`).toBeTruthy();
      },
    },

    // Test 5: Query with orderBy
    {
      name: 'query-with-orderBy',
      async run({ http, expect }) {
        const queryResponse = await http.as('admin').post('omega/admin/firestore/query', {
          queries: [
            {
              collection: TEST_COLLECTION,
              orderBy: [
                { field: 'value', order: 'desc' },
              ],
            },
          ],
        });

        expect(queryResponse, 'Query with orderBy should succeed').toBeSuccess();
        expect(Array.isArray(queryResponse.data) && queryResponse.data.length >= 2, 'Should have at least 2 results to verify order').toBeTruthy();

        for (let i = 0; i < queryResponse.data.length - 1; i++) {
          expect(queryResponse.data[i].data.value >= queryResponse.data[i + 1].data.value, 'Results should be in descending order by value').toBeTruthy();
        }
      },
    },

    // Test 6: Query with empty collection returns empty array
    {
      name: 'query-empty-collection',
      async run({ http, expect }) {
        const queryResponse = await http.as('admin').post('omega/admin/firestore/query', {
          queries: [
            { collection: '_test_nonexistent_collection_12345' },
          ],
        });

        expect(queryResponse, 'Query on empty collection should succeed').toBeSuccess();
        expect(Array.isArray(queryResponse.data), 'Response should be an array').toBeTruthy();
        expect(queryResponse.data.length, 'Empty collection should return empty array').toBe(0);
      },
    },

    // Test 7: Query with no collection specified returns empty
    {
      name: 'query-no-collection',
      async run({ http, expect }) {
        const queryResponse = await http.as('admin').post('omega/admin/firestore/query', {
          queries: [{}],
        });

        expect(queryResponse, 'Query with no collection should succeed (returns empty)').toBeSuccess();
        expect(Array.isArray(queryResponse.data), 'Response should be an array').toBeTruthy();
      },
    },

    // Test 8: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      async run({ http, expect }) {
        const queryResponse = await http.as('none').post('omega/admin/firestore/query', {
          queries: [{ collection: TEST_COLLECTION }],
        });

        expect(queryResponse, 'Query should fail without authentication').toBeError(401);
      },
    },

    // Test 9: Non-admin user fails
    {
      name: 'non-admin-rejected',
      async run({ http, expect }) {
        const queryResponse = await http.as('basic').post('omega/admin/firestore/query', {
          queries: [{ collection: TEST_COLLECTION }],
        });

        expect(queryResponse, 'Query should fail for non-admin user').toBeError(403);
      },
    },

  ],
});
