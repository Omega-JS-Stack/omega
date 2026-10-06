/**
 * Test: POST /user/token
 * Tests the user create custom token endpoint
 * Requires user authentication (uses Api.resolveUser with adminRequired: true which means user must be authenticated)
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'User create custom token',
  type: 'group',
  tests: [
    // Test 1: Authenticated user can create custom token
    {
      name: 'authenticated-user-succeeds',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/token', {});

        expect(response, 'Create custom token should succeed for authenticated user').toBeSuccess();
        expect(response, 'Response should contain token').toHaveProperty('data.token');
        expect(typeof response.data.token === 'string' && response.data.token.length > 0, 'Token should be a non-empty string').toBeTruthy();
      },
    },

    // Test 2: Token has valid JWT format
    {
      name: 'token-is-valid-jwt',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/token', {});

        expect(response, 'Create custom token should succeed').toBeSuccess();

        // JWT tokens have 3 parts separated by dots
        const parts = response.data.token.split('.');
        expect(parts.length, 'Token should be a valid JWT with 3 parts').toBe(3);
      },
    },

    // Test 3: Premium user can create custom token
    // Note: Admin via admin key can't create tokens without a UID since it's not a real user
    {
      name: 'premium-user-succeeds',
      auth: 'premium-active',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/token', {});

        expect(response, 'Create custom token should succeed for premium user').toBeSuccess();
        expect(response, 'Response should contain token').toHaveProperty('data.token');
      },
    },

    // Test 4: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/user/token', {});

        expect(response, 'Create custom token should fail without authentication').toBeError(401);
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

      async run({ http, expect }) {
        const response = await http.post('omega/user/token', {});

        expect(response, 'Create custom token should succeed').toBeSuccess();
        expect(typeof response.data.token, 'Token should be at the TOP level of the body').toBe('string');
        expect(response.data.response, 'The legacy response envelope must not exist').toBe(undefined);
      },
    },

    // Test 6: The retired legacy command lane must not mint tokens — a POST to
    // the API root with a `command` body is no longer dispatched.
    {
      name: 'legacy-command-lane-does-not-mint',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega', {
          command: 'user:create-custom-token',
          payload: {},
        });

        expect(response, 'Legacy command dispatch must not succeed').toBeError();
      },
    },
  ],
});
