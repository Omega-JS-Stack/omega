/**
 * Test: POST /payments/refund
 * Tests rejection cases and a full end-to-end refund flow with the test provider.
 *
 * Refund requires the subscription to be cancelled or pending cancellation.
 * The test provider simulates refund by writing a customer.subscription.deleted
 * webhook which triggers the existing pipeline.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment refund endpoint',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'rejects-unauthenticated',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Too expensive',
        });

        expect(response, 'Should reject unauthenticated request').toBeError(401);
      },
    },

    {
      name: 'rejects-missing-confirmed',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/refund', {
          reason: 'Too expensive',
        });

        expect(response, 'Should reject missing confirmed field').toBeError(400);
      },
    },

    {
      name: 'rejects-missing-reason',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/refund', {
          confirmed: true,
        });

        expect(response, 'Should reject missing reason field').toBeError(400);
      },
    },

    {
      name: 'rejects-basic-user',
      async run({ http, expect }) {
        const response = await http.as('basic').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Too expensive',
        });

        expect(response, 'Should reject basic user with no paid subscription').toBeError(400);
      },
    },

    {
      name: 'rejects-active-subscription-without-cancellation',
      async run({ http, expect }) {
        // refund-active-no-cancel has an active subscription without pending cancellation
        const response = await http.as('refund-active-no-cancel').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Too expensive',
        });

        expect(response, 'Should reject active subscription that is not cancelled or pending cancellation').toBeError(400);
      },
    },

    {
      name: 'rejects-payment-older-than-6-months',
      async run({ http, expect }) {
        // refund-expired-payment has a cancelled subscription with a payment older than 6 months
        const response = await http.as('refund-expired-payment').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Too expensive',
        });

        expect(response, 'Should reject payment older than 6 months').toBeError(400);
      },
    },

    {
      name: 'rejects-no-provider-or-resource-id',
      async run({ http, expect }) {
        // refund-no-provider has a cancelled subscription but no provider
        const response = await http.as('refund-no-provider').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Too expensive',
        });

        expect(response, 'Should reject when no provider or resourceId is set').toBeError(400);
      },
    },

    {
      name: 'rejects-unknown-provider',
      async run({ http, expect }) {
        // refund-unknown-provider has a cancelled subscription with unknown provider
        const response = await http.as('refund-unknown-provider').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Too expensive',
        });

        expect(response, 'Should reject unknown provider').toBeError(400);
      },
    },

    {
      name: 'succeeds-with-test-provider',
      async run({ http, expect, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['route-refund-success'].uid;
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices?.monthly);
        if (!paidProduct) {
          skip('No paid product with monthly price configured in this brand');
        }

        // Step 1: Create a test subscription intent to set up a proper paid subscription
        const intentResponse = await http.as('route-refund-success').post('omega/payments/intent', {
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

        // Step 2: Cancel the subscription first (refund requires cancellation).
        // skipGuards bypasses the 24-hour subscription-age guard on the cancel route.
        const cancelResponse = await http.as('route-refund-success').post('omega/payments/cancel', {
          confirmed: true,
          reason: 'Too expensive',
          skipGuards: true,
        });

        expect(cancelResponse, 'Cancel should succeed').toBeSuccess();

        // Wait for cancellation.pending to be set via the webhook pipeline
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.cancellation?.pending === true;
        }, 15000, 500);

        // Step 3: Request a refund
        const refundResponse = await http.as('route-refund-success').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Not satisfied with the service',
          feedback: 'Testing refund flow',
        });

        expect(refundResponse, 'Refund should succeed').toBeSuccess();
        expect(refundResponse.data.success, 'Should return success: true').toBeTruthy();
        expect(refundResponse.data.refund, 'Should return refund details').toBeTruthy();
        expect(refundResponse.data.refund.amount, 'Refund amount should be a number').toBeTypeOf('number');
        expect(refundResponse.data.refund.full, 'Should be a full refund (test provider)').toBe(true);

        // Step 4: Verify subscription is cancelled via the webhook pipeline
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.status === 'cancelled';
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc?.subscription?.status, 'Subscription should be cancelled after refund').toBe('cancelled');
      },
    },
  ],
});
