/**
 * Test: GET /user
 * Tests the user resolve endpoint
 * Returns user account info for authenticated users
 * Validates that User() correctly structures user data
 */
const { getFirstPaidProduct } = require('../../../dist/test/test-accounts.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'User resolve (account info)',
  type: 'group',
  tests: [
    // Test 1: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user', {});

        expect(response, 'Resolve should fail without authentication').toBeError(401);
      },
    },

    // Test 2: Basic user - verify resolved properties
    {
      name: 'basic-user-resolved-correctly',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect, accounts }) {
        const response = await http.get('omega/user', {});

        expect(response, 'Resolve should succeed for basic user').toBeSuccess();

        const user = response.data.user;

        // Verify auth properties
        expect(user.auth.uid, 'UID should match test account').toBe(accounts.basic.uid);
        expect(user.auth.email, 'Email should match test account').toBe(accounts.basic.email);
        // The 200 IS the verdict: the route answers 401 to a signed-out caller, and
        // the user rides the wire as its stored document (no computed getters)

        // Verify subscription properties - basic user should have basic subscription
        expect(user.subscription.product.id, 'Subscription ID should be basic').toBe('basic');
        expect(user.subscription.status, 'Subscription status should be active').toBe('active');

        // Verify roles - basic user has no special roles
        expect(user.roles.admin, 'Basic user should not be admin').toBe(false);

        // Verify usage structure exists
        expect(user.usage !== undefined, 'Usage object should be present').toBeTruthy();
        expect(user.usage.requests !== undefined, 'Usage.requests should be present').toBeTruthy();
      },
    },

    // Test 3: Real admin account (_test-admin) - verify admin role from Firestore
    {
      name: 'admin-account-resolved-correctly',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect, accounts }) {
        // Authenticate with the real admin test account's privateKey
        const response = await http.withPrivateKey(accounts.admin.privateKey).get('omega/user', {});

        expect(response, 'Resolve should succeed for admin account').toBeSuccess();

        const user = response.data.user;

        // Verify auth properties - should match the real admin account
        expect(user.auth.uid, 'UID should match admin test account').toBe(accounts.admin.uid);
        expect(user.auth.email, 'Email should match admin test account').toBe(accounts.admin.email);

        // Verify roles - admin account has roles.admin = true in Firestore
        expect(user.roles.admin, 'Admin account should have admin role').toBe(true);

        // Verify subscription - admin account is on basic subscription
        expect(user.subscription.product.id, 'Admin subscription ID should be basic').toBe('basic');
      },
    },

    // Test 4: admin key only - shell account with admin role, no real user
    {
      name: 'admin-key-shell-account',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect, accounts }) {
        const response = await http.get('omega/user', {});

        expect(response, 'Resolve should succeed with admin key').toBeSuccess();

        const user = response.data.user;

        // Verify roles - admin key grants admin role
        expect(user.roles.admin, 'admin key should grant admin role').toBe(true);

        // Should NOT have the real admin account's UID (it's a shell account)
        expect(user.auth.uid, 'Should not be the real admin account').not.toBe(accounts.admin.uid);
      },
    },

    // Test 5: Premium active user - verify premium subscription is retained
    {
      name: 'premium-active-user-resolved-correctly',
      auth: 'resolve-premium-active',
      timeout: 15000,

      async run({ http, expect, accounts, config }) {
        const paidProduct = getFirstPaidProduct(config);
        const response = await http.get('omega/user', {});

        expect(response, 'Resolve should succeed for premium user').toBeSuccess();

        const user = response.data.user;

        // Verify auth properties
        expect(user.auth.uid, 'UID should match premium test account').toBe(accounts['resolve-premium-active'].uid);

        // Verify subscription - premium user should retain paid subscription
        expect(user.subscription.product.id, 'Subscription ID should match first paid product').toBe(paidProduct.id);
        expect(user.subscription.status, 'Subscription status should be active').toBe('active');

        // Verify expires is in the future
        const expiresTimestamp = user.subscription.expires?.timestampUNIX || 0;
        const now = Math.floor(Date.now() / 1000);
        expect(expiresTimestamp > now, 'Premium subscription expires should be in the future').toBeTruthy();
      },
    },

    // Test 6: Premium expired user - verify subscription retains product but shows cancelled status
    {
      name: 'premium-expired-user-cancelled',
      auth: 'resolve-premium-expired',
      timeout: 15000,

      async run({ http, expect, accounts, config }) {
        const paidProduct = getFirstPaidProduct(config);
        const response = await http.get('omega/user', {});

        expect(response, 'Resolve should succeed for expired premium user').toBeSuccess();

        const user = response.data.user;

        // Verify auth properties
        expect(user.auth.uid, 'UID should match expired premium test account').toBe(accounts['resolve-premium-expired'].uid);

        // Verify subscription - product.id stays as paid product, status reflects cancellation
        expect(user.subscription.product.id, 'Product ID should remain paid product').toBe(paidProduct.id);
        expect(user.subscription.status, 'Status should be cancelled').toBe('cancelled');
      },
    },
  ],
});
