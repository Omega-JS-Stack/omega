/**
 * Test: POST /user/token
 * Tests the user create custom token endpoint
 * Requires user authentication (uses Api.resolveUser with adminRequired: true which means user must be authenticated)
 */
module.exports = {
  description: 'User create custom token',
  type: 'group',
  tests: [
    // Test 1: Authenticated user can create custom token
    {
      name: 'authenticated-user-succeeds',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.post('backend-manager/user/token', {});

        assert.isSuccess(response, 'Create custom token should succeed for authenticated user');
        assert.hasProperty(response, 'data.token', 'Response should contain token');
        assert.ok(
          typeof response.data.token === 'string' && response.data.token.length > 0,
          'Token should be a non-empty string'
        );
      },
    },

    // Test 2: Token has valid JWT format
    {
      name: 'token-is-valid-jwt',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.post('backend-manager/user/token', {});

        assert.isSuccess(response, 'Create custom token should succeed');

        // JWT tokens have 3 parts separated by dots
        const parts = response.data.token.split('.');
        assert.equal(parts.length, 3, 'Token should be a valid JWT with 3 parts');
      },
    },

    // Test 3: Premium user can create custom token
    // Note: Admin via admin key can't create tokens without a UID since it's not a real user
    {
      name: 'premium-user-succeeds',
      auth: 'premium-active',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.post('backend-manager/user/token', {});

        assert.isSuccess(response, 'Create custom token should succeed for premium user');
        assert.hasProperty(response, 'data.token', 'Response should contain token');
      },
    },

    // Test 4: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.post('backend-manager/user/token', {});

        assert.isError(response, 401, 'Create custom token should fail without authentication');
      },
    },

    // Test 5: The wire shape both token callers speak — `{ token }` at the TOP
    // level, no legacy `response` envelope. Pinned here (single-package HTTP
    // contract) since #46; the auth-token e2e lane keeps only the cross-boundary
    // round trip. A broken read of this shape (`data.response.token`) is exactly
    // what shipped unnoticed before the desktop/extension flow had coverage.
    {
      name: 'wire-shape-is-token-at-top-level',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.post('backend-manager/user/token', {});

        assert.isSuccess(response, 'Create custom token should succeed');
        assert.equal(typeof response.data.token, 'string', 'Token should be at the TOP level of the body');
        assert.equal(response.data.response, undefined, 'The legacy response envelope must not exist');
      },
    },

    // Test 6: The retired legacy command lane must not mint tokens — a POST to
    // the API root with a `command` body is no longer dispatched.
    {
      name: 'legacy-command-lane-does-not-mint',
      auth: 'basic',
      timeout: 15000,

      async run({ http, assert }) {
        const response = await http.post('backend-manager', {
          command: 'user:create-custom-token',
          payload: {},
        });

        assert.isError(response, null, 'Legacy command dispatch must not succeed');
      },
    },
  ],
};
