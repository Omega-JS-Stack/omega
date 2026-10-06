/**
 * Test: POST /admin/notification
 * Tests the admin send notification (FCM) endpoint
 * Requires admin authentication
 */
const { TEST_DATA } = require('../../../dist/test/test-accounts.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Admin send notification (FCM)',
  type: 'group',
  tests: [
    // Test 1: Admin can call send-notification with no subscribers
    {
      name: 'admin-succeeds-empty-collection',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: '@omega.js/backend Test Notification',
            body: 'Testing from @omega.js/backend test suite',
            clickAction: 'https://example.com/test',
          },
        });

        expect(response, 'Send notification should succeed for admin').toBeSuccess();
        expect(response, 'Response should have sent count').toHaveProperty('data.sent');
        expect(response, 'Response should have deleted count').toHaveProperty('data.deleted');
      },
    },

    // Test 2: Notification with owner filter
    {
      name: 'with-owner-filter',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: 'Filtered Notification',
            body: 'Testing owner filter',
          },
          filters: {
            owner: TEST_DATA.filterUid,
            limit: 10,
          },
        });

        expect(response, 'Send notification with filters should succeed').toBeSuccess();
        expect(response, 'Response should have sent count').toHaveProperty('data.sent');
      },
    },

    // Test 3: Notification with tags filter
    {
      name: 'with-tags-filter',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: 'Tagged Notification',
            body: 'Testing tags filter',
          },
          filters: {
            tags: ['test-tag', 'another-tag'],
          },
        });

        expect(response, 'Send notification with tags filter should succeed').toBeSuccess();
      },
    },

    // Test 4: Notification with limit filter
    {
      name: 'with-limit-filter',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: 'Limited Notification',
            body: 'Testing limit filter',
          },
          filters: {
            limit: 5,
          },
        });

        expect(response, 'Send notification with limit should succeed').toBeSuccess();
        expect(response, 'Response should have sent count').toHaveProperty('data.sent');
      },
    },

    // Test 5: Default notification values applied when notification is omitted
    {
      name: 'default-values-applied',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        // Omit notification entirely to test schema defaults are applied
        const response = await http.post('omega/admin/notification', {
          filters: {
            limit: 1,
          },
        });

        expect(response, 'Send notification with defaults should succeed').toBeSuccess();
      },
    },

    // Test 6: Send to real FCM token (requires TEST_FCM_TOKEN env var)
    {
      name: 'send-to-real-token',
      auth: 'admin',
      timeout: 30000,
      skip: !process.env.TEST_FCM_TOKEN ? 'TEST_FCM_TOKEN env var not set' : false,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: '@omega.js/backend Test Notification',
            body: `Test sent at ${new Date().toISOString()}`,
            clickAction: `https://${config.domain}/?test-notification=true`,
          },
          filters: {
            token: process.env.TEST_FCM_TOKEN,
          },
        });

        expect(response, 'Send notification to real token should succeed').toBeSuccess();
        expect(response, 'Response should have sent count').toHaveProperty('data.sent');
      },
    },

    // Test 7: Send to fake token (API succeeds, FCM fails silently)
    {
      name: 'fake-token-api-succeeds',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: 'Fake Token Test',
            body: 'Testing with invalid token',
          },
          filters: {
            token: 'fake-invalid-token-for-testing',
          },
        });

        expect(response, 'Send notification to fake token should succeed API-wise').toBeSuccess();
      },
    },

    // Test 8: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: 'Test Notification',
            body: 'This is a test',
          },
        });

        expect(response, 'Send notification should fail without authentication').toBeError(401);
      },
    },

    // Test 9: Non-admin user fails
    {
      name: 'non-admin-rejected',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/notification', {
          notification: {
            title: 'Test Notification',
            body: 'This is a test',
          },
        });

        expect(response, 'Send notification should fail for non-admin user').toBeError(403);
      },
    },
  ],
});
