/**
 * Test: GET /user/subscription
 * Tests the user get subscription info endpoint
 * Returns subscription details for authenticated users
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'User get subscription info',
  type: 'group',
  tests: [
    // Test 1: Basic user can get subscription info
    {
      name: 'basic-user-succeeds',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/subscription', {});

        expect(response, 'Get subscription info should succeed for authenticated user').toBeSuccess();
        expect(response, 'Response should contain subscription object').toHaveProperty('data.subscription');
        expect(response, 'Subscription should have id').toHaveProperty('data.subscription.product.id');
        expect(response, 'Subscription should have expires').toHaveProperty('data.subscription.expires');
        expect(response, 'Subscription should have trial info').toHaveProperty('data.subscription.trial');
        expect(response, 'Subscription should have payment info').toHaveProperty('data.subscription.payment');
      },
    },

    // Test 2: Subscription has correct structure
    {
      name: 'subscription-structure-valid',
      auth: 'basic',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/subscription', {});

        expect(response, 'Get subscription info should succeed').toBeSuccess();

        const subscription = response.data.subscription;

        // Check expires structure
        expect(response, 'expires should have timestamp').toHaveProperty('data.subscription.expires.timestamp');
        expect(response, 'expires should have timestampUNIX').toHaveProperty('data.subscription.expires.timestampUNIX');

        // Check trial structure
        expect(typeof subscription.trial.claimed === 'boolean', 'trial.claimed should be boolean').toBeTruthy();

        // Check payment structure
        expect(response, 'subscription should have payment').toHaveProperty('data.subscription.payment');
      },
    },

    // Test 3: Premium user has active subscription
    {
      name: 'premium-user-has-active-subscription',
      auth: 'premium-active',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/subscription', {});

        expect(response, 'Get subscription info should succeed for premium user').toBeSuccess();
        expect(response, 'Premium user should have subscription id').toHaveProperty('data.subscription.product.id');
        expect(response, 'Premium user should have payment info').toHaveProperty('data.subscription.payment');
      },
    },

    // Test 4: Expired premium user still gets info
    {
      name: 'expired-premium-returns-info',
      auth: 'premium-expired',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/subscription', {});

        expect(response, 'Get subscription info should succeed for expired premium').toBeSuccess();
        expect(response, 'Should still have subscription id').toHaveProperty('data.subscription.product.id');
        expect(response, 'Should have expires timestamp').toHaveProperty('data.subscription.expires.timestampUNIX');
      },
    },

    // Test 5: Unauthenticated request fails
    {
      name: 'unauthenticated-rejected',
      auth: 'none',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.get('omega/user/subscription', {});

        expect(response, 'Get subscription info should fail without authentication').toBeError(401);
      },
    },
  ],
});
