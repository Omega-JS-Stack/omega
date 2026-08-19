/**
 * Test: GET /user/sessions and DELETE /user/sessions
 * Tests the user sessions endpoints
 * GET returns sessions for authenticated users from Realtime Database
 * DELETE signs out all sessions (revokes refresh tokens and clears session data)
 */
module.exports = {
  description: 'User sessions (get and sign-out)',
  type: 'group',
  tests: [
    // --- GET /user/sessions tests ---

    // Test 1: Authenticated user can get sessions
    {
      name: 'get-authenticated-user-succeeds',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.get('backend-manager/user/sessions', {});

        assert.isSuccess(response, 'Get active sessions should succeed for authenticated user');
        assert.ok(
          typeof response.data === 'object',
          'Response data should be an object'
        );
      },
    },

    // Test 2: Default session id is 'app'
    {
      name: 'get-default-session-is-app',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        // With no id specified, should query sessions/app
        const response = await http.get('backend-manager/user/sessions', {});

        assert.isSuccess(response, 'Get active sessions should succeed');
        // Response is an object (may be empty if no sessions)
        assert.ok(
          response.data !== undefined,
          'Response should have data'
        );
      },
    },

    // Test 3: Custom session id
    {
      name: 'get-custom-session-id',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.get('backend-manager/user/sessions', {
          id: 'custom-session-type',
        });

        assert.isSuccess(response, 'Get active sessions with custom id should succeed');
        assert.ok(
          typeof response.data === 'object',
          'Response data should be an object'
        );
      },
    },

    // Test 4: Empty sessions returns empty object
    {
      name: 'get-no-sessions-returns-empty',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        // Query a session type that definitely doesn't exist
        const response = await http.get('backend-manager/user/sessions', {
          id: 'nonexistent-session-type-12345',
        });

        assert.isSuccess(response, 'Get sessions for empty type should succeed');
        assert.ok(
          Object.keys(response.data).length === 0,
          'Empty session type should return empty object'
        );
      },
    },

    // Test 5: The seeded persona's own devices come back (#343)
    {
      name: 'get-returns-the-personas-seeded-sessions',
      auth: 'premium-active',
      timeout: 15000,

      async run({ http, assert, accounts }) {
        const response = await http.get('backend-manager/user/sessions', {});

        assert.isSuccess(response, 'Get active sessions should succeed');

        // The boot seed writes these into the Realtime Database from OUTSIDE the
        // functions runtime, so this is also the proof it wrote the namespace
        // this route reads (src/test/test-accounts.js sessionsDatabase).
        const sessions = response.data || {};
        const ids = Object.keys(sessions).filter((id) => id.startsWith('_test-session-premium-active-'));

        assert.ok(
          ids.length >= 2,
          `The Premium persona is seeded as signed in on several devices, so its sessions must come back (got ${Object.keys(sessions).length} session(s))`
        );

        for (const id of ids) {
          assert.equal(sessions[id].uid, accounts['premium-active'].uid, `Session ${id} should belong to the persona`);
          assert.ok(sessions[id].platform, `Session ${id} should name its platform`);
          assert.ok(sessions[id].timestampUNIX > 0, `Session ${id} should record its last check-in`);
        }
      },
    },

    // Test 6: Admin can get sessions
    {
      name: 'get-admin-succeeds',
      auth: 'admin',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.get('backend-manager/user/sessions', {});

        assert.isSuccess(response, 'Get active sessions should succeed for admin');
      },
    },

    // Test 7: Unauthenticated GET request fails
    {
      name: 'get-unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.get('backend-manager/user/sessions', {});

        assert.isError(response, 401, 'Get active sessions should fail without authentication');
      },
    },

    // --- DELETE /user/sessions tests ---

    // Test 8: Authenticated user can sign out all sessions
    {
      name: 'delete-authenticated-user-succeeds',
      auth: 'basic',
      timeout: 30000, // Longer timeout due to session cleanup

      async run({ http, assert }) {
        const response = await http.delete('backend-manager/user/sessions', {});

        assert.isSuccess(response, 'Sign out all sessions should succeed for authenticated user');
        assert.hasProperty(response, 'data.sessions', 'Response should contain sessions count');
        assert.hasProperty(response, 'data.message', 'Response should contain message');
        assert.ok(
          typeof response.data.sessions === 'number',
          'sessions should be a number'
        );
        assert.ok(
          response.data.sessions >= 0,
          'sessions count should be non-negative'
        );
      },
    },

    // Test 9: Custom session id for delete
    {
      name: 'delete-custom-session-id',
      auth: 'basic',
      timeout: 30000,

      async run({ http, assert }) {
        const response = await http.delete('backend-manager/user/sessions', {
          id: 'custom-session-type',
        });

        assert.isSuccess(response, 'Sign out with custom session id should succeed');
        assert.hasProperty(response, 'data.sessions', 'Response should contain sessions count');
      },
    },

    // Test 10: Premium user can sign out all sessions
    // Note: admin key admin doesn't have auth.uid, so we test with premium user instead
    {
      name: 'delete-premium-user-succeeds',
      auth: 'premium-active',
      timeout: 30000,

      async run({ http, assert }) {
        const response = await http.delete('backend-manager/user/sessions', {});

        assert.isSuccess(response, 'Sign out all sessions should succeed for premium user');
        assert.hasProperty(response, 'data.sessions', 'Response should contain sessions count');
      },
    },

    // Test 11: Multiple calls are idempotent
    {
      name: 'delete-idempotent-operation',
      auth: 'basic',
      timeout: 30000,

      async run({ http, assert }) {
        // Call twice in a row - both should succeed
        const response1 = await http.delete('backend-manager/user/sessions', {});
        const response2 = await http.delete('backend-manager/user/sessions', {});

        assert.isSuccess(response1, 'First sign out should succeed');
        assert.isSuccess(response2, 'Second sign out should succeed (idempotent)');
      },
    },

    // Test 12: Unauthenticated DELETE request fails
    {
      name: 'delete-unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.delete('backend-manager/user/sessions', {});

        assert.isError(response, 401, 'Sign out all sessions should fail without authentication');
      },
    },
  ],
};
