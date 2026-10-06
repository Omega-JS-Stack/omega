/**
 * Test: Payment Journey - Invoice Payment Failure
 * Simulates: basic → paid subscription → invoice.payment_failed → suspended
 *
 * Unlike journey-payments-suspend (which uses customer.subscription.updated with past_due),
 * this test uses the invoice.payment_failed event with billing_reason: subscription_cycle.
 * This verifies the new parseWebhook routing that determines category from invoice data.
 *
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: paid → invoice.payment_failed → suspended',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, expect, state, config, http, waitFor, skip, payments }) {
        const uid = accounts['journey-payments-failure'].uid;

        // Resolve first paid subscription product. If the brand has none configured,
        // skip the entire journey — this is a config-gap, not a code failure.
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.type === 'subscription' && p.prices);
        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        state.uid = uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];

        state.paidProductName = paidProduct.name;

        // Create subscription via test intent
        const response = await http.as('journey-payments-failure').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: state.product.frequency,
        });
        expect(response, 'Intent should succeed').toBeSuccess();
        state.orderId = response.data.orderId;

        // Wait for subscription to activate
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.product?.id === paidProduct.id;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc.subscription?.product?.id, `Should start as ${paidProduct.id}`).toBe(paidProduct.id);
        expect(userDoc.subscription?.status, 'Should be active').toBe('active');
        expect(userDoc.subscription?.payment?.orderId, 'Order ID should match intent').toBe(state.orderId);

        state.subscriptionId = userDoc.subscription.payment.resourceId;
      },
    },

    {
      name: 'send-invoice-payment-failed',
      async run({ http, expect, state, config }) {
        state.eventId = `_test-evt-journey-failure-${Date.now()}`;

        // Send invoice.payment_failed with subscription billing reason
        // This tests the new parseWebhook routing: billing_reason=subscription_cycle → subscription category
        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId,
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: `in_test_failure_${Date.now()}`,
              object: 'invoice',
              billing_reason: 'subscription_cycle',
              amount_due: 999,
              amount_paid: 0,
              status: 'open',
              parent: {
                subscription_details: {
                  subscription: state.subscriptionId,
                  metadata: { uid: state.uid, orderId: state.orderId },
                },
                type: 'subscription_details',
              },
            },
          },
        });

        expect(response, 'Webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'verify-webhook-categorized-as-subscription',
      async run({ firestore, expect, state, waitFor }) {
        // Wait for webhook doc to be saved
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed' || doc?.status === 'failed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        expect(webhookDoc, 'Webhook doc should exist').toBeTruthy();
        expect(webhookDoc.event?.category, 'Category should be subscription').toBe('subscription');
        expect(webhookDoc.event?.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(webhookDoc.event?.resourceId, 'Resource ID should be subscription ID').toBe(state.subscriptionId);
        expect(webhookDoc.transition, 'Transition should be payment-failed').toBe('payment-failed');
      },
    },

    {
      name: 'subscription-suspended',
      async run({ firestore, expect, state }) {
        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'Status should be suspended after payment failure').toBe('suspended');
        expect(userDoc.subscription.product.id, `Product should still be ${state.paidProductId}`).toBe(state.paidProductId);
      },
    },

    {
      name: 'order-doc-verified',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.type, 'Type should be subscription').toBe('subscription');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);
        expect(orderDoc.requests !== undefined, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be null').toBe(null);
        expect(orderDoc.requests.refund, 'requests.refund should be null').toBe(null);
      },
    },

    {
      name: 'intent-doc-completed',
      async run({ firestore, expect, state }) {
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);

        expect(intentDoc, 'Intent doc should exist').toBeTruthy();
        expect(intentDoc.id, 'ID should match orderId').toBe(state.orderId);
        expect(intentDoc.status, 'Intent status should be completed after initial webhook processing').toBe('completed');
        expect(intentDoc.metadata?.completed?.timestampUNIX > 0, 'Completed timestamp should be set').toBeTruthy();
      },
    },
  ],
});
