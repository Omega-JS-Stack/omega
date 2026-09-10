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
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        assert.isError(response, 401, 'Should reject unauthenticated request');
      },
    },

    {
      name: 'rejects-basic-user',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        assert.isError(response, 400, 'Should reject basic user with no paid subscription');
      },
    },

    {
      name: 'rejects-no-provider',
      async run({ http, assert }) {
        // portal-no-provider starts with payment.provider=null
        const response = await http.as('portal-no-provider').post('backend-manager/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        assert.isError(response, 400, 'Should reject when no provider is set');
      },
    },

    {
      name: 'rejects-unknown-provider',
      async run({ http, assert }) {
        // portal-unknown-provider starts with provider='unknown-provider'
        const response = await http.as('portal-unknown-provider').post('backend-manager/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        assert.isError(response, 400, 'Should reject unknown provider');
      },
    },

    {
      name: 'succeeds-with-test-provider',
      async run({ http, assert, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['journey-payments-portal-route'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices?.monthly);
        if (!paidProduct) {
          skip('No paid product with monthly price configured in this brand');
        }

        // Set up a paid subscription with the test provider
        const intentResponse = await http.as('journey-payments-portal-route').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        assert.isSuccess(intentResponse, 'Intent should succeed');

        // Wait for the auto-webhook to activate the subscription
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.payment?.provider === 'test'
            && userDoc?.subscription?.status === 'active';
        }, 15000, 500);

        // Call the portal endpoint
        const portalResponse = await http.as('journey-payments-portal-route').post('backend-manager/payments/portal', {
          returnUrl: 'https://example.com/account',
        });

        assert.isSuccess(portalResponse, 'Portal should succeed');
        assert.ok(portalResponse.data.url, 'Should return a URL');
      },
    },
  ],
});
