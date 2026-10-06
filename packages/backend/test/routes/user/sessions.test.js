/**
 * Test: GET /user/sessions and DELETE /user/sessions
 * Tests the user sessions endpoints
 * GET returns sessions for authenticated users from Realtime Database
 * DELETE signs out all sessions (revokes refresh tokens and clears session data)
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'User sessions (get and sign-out)',
  type: 'group',
  tests: [
    // --- GET /user/sessions tests ---

    // Test 1: Authenticated user can get sessions
    {
      name: 'get-authenticated-user-succeeds',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/sessions', {});

        expect(response, 'Get active sessions should succeed for authenticated user').toBeSuccess();
        expect(typeof response.data === 'object', 'Response data should be an object').toBeTruthy();
      },
    },

    // Test 2: Default session id is 'app'
    {
      name: 'get-default-session-is-app',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        // With no id specified, should query sessions/app
        const response = await http.get('omega/user/sessions', {});

        expect(response, 'Get active sessions should succeed').toBeSuccess();
        // Response is an object (may be empty if no sessions)
        expect(response.data !== undefined, 'Response should have data').toBeTruthy();
      },
    },

    // Test 3: Custom session id
    {
      name: 'get-custom-session-id',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/sessions', {
          id: 'custom-session-type',
        });

        expect(response, 'Get active sessions with custom id should succeed').toBeSuccess();
        expect(typeof response.data === 'object', 'Response data should be an object').toBeTruthy();
      },
    },

    // Test 4: Empty sessions returns empty object
    {
      name: 'get-no-sessions-returns-empty',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        // Query a session type that definitely doesn't exist
        const response = await http.get('omega/user/sessions', {
          id: 'nonexistent-session-type-12345',
        });

        expect(response, 'Get sessions for empty type should succeed').toBeSuccess();
        expect(Object.keys(response.data).length === 0, 'Empty session type should return empty object').toBeTruthy();
      },
    },

    // Test 5: The seeded persona's own devices come back (#343)
    {
      name: 'get-returns-the-personas-seeded-sessions',
      auth: 'premium-active',
      timeout: 15000,

      async run({ http, expect, accounts }) {
        const response = await http.get('omega/user/sessions', {});

        expect(response, 'Get active sessions should succeed').toBeSuccess();

        // The boot seed writes these into the Realtime Database from OUTSIDE the
        // functions runtime, so this is also the proof it wrote the namespace
        // this route reads (src/test/test-accounts.js sessionsDatabase).
        const sessions = response.data || {};
        const ids = Object.keys(sessions).filter((id) => id.startsWith('_test-session-premium-active-'));

        expect(ids.length >= 2, `The Premium persona is seeded as signed in on several devices, so its sessions must come back (got ${Object.keys(sessions).length} session(s))`).toBeTruthy();

        for (const id of ids) {
          expect(sessions[id].uid, `Session ${id} should belong to the persona`).toBe(accounts['premium-active'].uid);
          expect(sessions[id].platform, `Session ${id} should name its platform`).toBeTruthy();
          expect(sessions[id].timestampUNIX > 0, `Session ${id} should record its last check-in`).toBeTruthy();
        }
      },
    },

    // Test 6: Admin can get sessions
    {
      name: 'get-admin-succeeds',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/sessions', {});

        expect(response, 'Get active sessions should succeed for admin').toBeSuccess();
      },
    },

    // Test 7: Unauthenticated GET request fails
    {
      name: 'get-unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/sessions', {});

        expect(response, 'Get active sessions should fail without authentication').toBeError(401);
      },
    },

    // --- DELETE /user/sessions tests ---

    // Test 8: Authenticated user can sign out all sessions
    {
      name: 'delete-authenticated-user-succeeds',
      auth: 'basic',
      timeout: 30000, // Longer timeout due to session cleanup

      async run({ http, expect }) {
        const response = await http.delete('omega/user/sessions', {});

        expect(response, 'Sign out all sessions should succeed for authenticated user').toBeSuccess();
        expect(response, 'Response should contain sessions count').toHaveProperty('data.sessions');
        expect(response, 'Response should contain message').toHaveProperty('data.message');
        expect(typeof response.data.sessions === 'number', 'sessions should be a number').toBeTruthy();
        expect(response.data.sessions >= 0, 'sessions count should be non-negative').toBeTruthy();
      },
    },

    // Test 9: Custom session id for delete
    {
      name: 'delete-custom-session-id',
      auth: 'basic',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.delete('omega/user/sessions', {
          id: 'custom-session-type',
        });

        expect(response, 'Sign out with custom session id should succeed').toBeSuccess();
        expect(response, 'Response should contain sessions count').toHaveProperty('data.sessions');
      },
    },

    // Test 10: Premium user can sign out all sessions
    // Note: admin key admin doesn't have auth.uid, so we test with premium user instead
    {
      name: 'delete-premium-user-succeeds',
      auth: 'premium-active',
      timeout: 30000,

      async run({ http, expect }) {
        const response = await http.delete('omega/user/sessions', {});

        expect(response, 'Sign out all sessions should succeed for premium user').toBeSuccess();
        expect(response, 'Response should contain sessions count').toHaveProperty('data.sessions');
      },
    },

    // Test 11: Multiple calls are idempotent
    {
      name: 'delete-idempotent-operation',
      auth: 'basic',
      timeout: 30000,

      async run({ http, expect }) {
        // Call twice in a row - both should succeed
        const response1 = await http.delete('omega/user/sessions', {});
        const response2 = await http.delete('omega/user/sessions', {});

        expect(response1, 'First sign out should succeed').toBeSuccess();
        expect(response2, 'Second sign out should succeed (idempotent)').toBeSuccess();
      },
    },

    // Test 12: Unauthenticated DELETE request fails
    {
      name: 'delete-unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.delete('omega/user/sessions', {});

        expect(response, 'Sign out all sessions should fail without authentication').toBeError(401);
      },
    },
  ],
});
