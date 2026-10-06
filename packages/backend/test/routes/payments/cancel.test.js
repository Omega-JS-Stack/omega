/**
 * Test: POST /payments/cancel - Validation errors
 * Tests rejection cases before any provider call is made.
 * See test/events/payments/journey-payments-cancel-endpoint.js for the full end-to-end journey.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment cancel endpoint: validation errors',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'rejects-unauthenticated',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/payments/cancel', {
          confirmed: true,
        });

        expect(response, 'Should reject unauthenticated request').toBeError(401);
      },
    },

    {
      name: 'rejects-missing-confirmed',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/cancel', {
          reason: 'Too expensive',
        });

        expect(response, 'Should reject missing confirmed field').toBeError(400);
      },
    },

    {
      name: 'rejects-basic-user',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/cancel', {
          confirmed: true,
        });

        expect(response, 'Should reject basic user with no paid subscription').toBeError(400);
      },
    },

    {
      name: 'rejects-no-provider-or-resource-id',
      async run({ http, expect }) {
        // cancel-no-provider starts with payment.provider=null
        const response = await http.as('cancel-no-provider').post('omega/payments/cancel', {
          confirmed: true,
        });

        expect(response, 'Should reject when no provider or resourceId is set').toBeError(400);
      },
    },

    {
      name: 'rejects-already-pending-cancellation',
      async run({ http, expect }) {
        // cancel-already-pending starts with cancellation.pending=true
        const response = await http.as('cancel-already-pending').post('omega/payments/cancel', {
          confirmed: true,
        });

        expect(response, 'Should reject when cancellation already pending').toBeError(400);
      },
    },

    {
      name: 'rejects-subscription-younger-than-24-hours',
      async run({ http, expect }) {
        // cancel-too-young starts with startDate set to now (< 24 hours old)
        const response = await http.as('cancel-too-young').post('omega/payments/cancel', {
          confirmed: true,
        });

        expect(response, 'Should reject subscription younger than 24 hours').toBeError(400);
      },
    },

    {
      name: 'rejects-unknown-provider',
      async run({ http, expect }) {
        // cancel-unknown-provider starts with provider='unknown-provider'
        const response = await http.as('cancel-unknown-provider').post('omega/payments/cancel', {
          confirmed: true,
        });

        expect(response, 'Should reject unknown provider').toBeError(400);
      },
    },

    {
      name: 'allows-suspended-subscription',
      async run({ http, expect, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['cancel-suspended'].uid;

        const response = await http.as('cancel-suspended').post('omega/payments/cancel', {
          confirmed: true,
          reason: 'Subscription was suspended',
          skipGuards: true,
        });

        expect(response, 'Should allow cancelling a suspended subscription').toBeSuccess();
        expect(response.data.success, 'Should return success: true').toBe(true);

        // Verify the subscription was reset to cancelled (via fallback or webhook)
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.status === 'cancelled'
            || userDoc?.subscription?.cancellation?.pending === true;
        }, 15000, 500);
      },
    },

    {
      name: 'succeeds-with-test-provider',
      async run({ http, expect, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['route-cancel-success'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices?.monthly);
        if (!paidProduct) {
          skip('No paid product with monthly price configured in this brand');
        }

        // Step 1: Create a test subscription intent to set up a proper paid subscription
        const intentResponse = await http.as('route-cancel-success').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: 'monthly',
        });

        expect(intentResponse, 'Intent should succeed').toBeSuccess();

        // Wait for the auto-webhook to activate the subscription
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.payment?.provider === 'test'
            && userDoc?.subscription?.payment?.resourceId
            && userDoc?.subscription?.status === 'active';
        }, 15000, 500);

        // Step 2: Call the cancel endpoint (skipGuards bypasses the 24-hour age guard)
        const cancelResponse = await http.as('route-cancel-success').post('omega/payments/cancel', {
          confirmed: true,
          reason: 'Too expensive',
          skipGuards: true,
        });

        expect(cancelResponse, 'Cancel should succeed').toBeSuccess();
        expect(cancelResponse.data.success, 'Should return success: true').toBe(true);

        // Step 3: Verify cancellation.pending was set via the webhook pipeline
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.cancellation?.pending === true;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.subscription?.cancellation?.pending, 'Cancellation should be pending').toBe(true);
      },
    },
  ],
});
