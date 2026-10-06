/**
 * Test: POST /payments/portal - Validation errors
 * Tests rejection cases before any provider call is made.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment portal endpoint: validation errors',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'rejects-unauthenticated',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        expect(response, 'Should reject unauthenticated request').toBeError(401);
      },
    },

    {
      name: 'rejects-basic-user',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        expect(response, 'Should reject basic user with no paid subscription').toBeError(400);
      },
    },

    {
      name: 'rejects-no-provider',
      async run({ http, expect }) {
        // portal-no-provider starts with payment.provider=null
        const response = await http.as('portal-no-provider').post('omega/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        expect(response, 'Should reject when no provider is set').toBeError(400);
      },
    },

    {
      name: 'rejects-unknown-provider',
      async run({ http, expect }) {
        // portal-unknown-provider starts with provider='unknown-provider'
        const response = await http.as('portal-unknown-provider').post('omega/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        expect(response, 'Should reject unknown provider').toBeError(400);
      },
    },

    {
      name: 'succeeds-with-test-provider',
      async run({ http, expect, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['journey-payments-portal-route'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices?.monthly);
        if (!paidProduct) {
          skip('No paid product with monthly price configured in this brand');
        }

        // Set up a paid subscription with the test provider
        const intentResponse = await http.as('journey-payments-portal-route').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(intentResponse, 'Intent should succeed').toBeSuccess();

        // Wait for the auto-webhook to activate the subscription
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.payment?.provider === 'test'
            && userDoc?.subscription?.status === 'active';
        }, 15000, 500);

        // Call the portal endpoint
        const portalResponse = await http.as('journey-payments-portal-route').post('omega/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        expect(portalResponse, 'Portal should succeed').toBeSuccess();
        expect(portalResponse.data.url, 'Should return a URL').toBeTruthy();
      },
    },
  ],
});
