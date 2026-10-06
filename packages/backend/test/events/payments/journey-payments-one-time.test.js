/**
 * Test: Payment Journey - One-Time Purchase
 * Simulates: user → test intent (one-time product) → auto-webhook → purchase-completed
 *
 * Uses the test provider to exercise the full intent→webhook→trigger pipeline
 * for one-time payments. Unlike subscriptions, one-time payments only write to
 * payments-orders/{orderId} — they do NOT modify users/{uid}.subscription.
 *
 * Requires at least one product with type: 'one-time' in config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: one-time purchase via test intent → purchase-completed',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'resolve-one-time-product',
      async run({ accounts, firestore, expect, state, config, skip }) {
        const uid = accounts['journey-payments-one-time'].uid;
        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();

        // Resolve first one-time product from config. If the brand has none configured,
        // skip the entire journey — this is a config-gap, not a code failure.
        const oneTimeProduct = config.payment.products.find(p => p.type === 'one-time' && p.prices?.once);
        if (!oneTimeProduct) {
          skip('No one-time product configured in this brand');
        }

        state.uid = uid;
        state.productId = oneTimeProduct.id;
        state.productName = oneTimeProduct.name;
        state.price = oneTimeProduct.prices.once;

        // Snapshot subscription before purchase — should remain unchanged after
        state.subscriptionBefore = userDoc.subscription || null;
      },
    },

    {
      name: 'create-one-time-intent',
      async run({ http, expect, state }) {
        const response = await http.as('journey-payments-one-time').post('omega/payments/intent', {
          provider: 'test',
          productId: state.productId,
        });

        expect(response, 'Intent should succeed').toBeSuccess();
        expect(response.data.id, 'Should return intent ID').toBeTruthy();
        expect(response.data.orderId, 'Should return orderId').toBeTruthy();
        expect(response.data.orderId, 'orderId should be XXXX-XXXX-XXXX format').toMatch(/^\d{4}-\d{4}-\d{4}$/);
        expect(response.data.url, 'Should return URL').toBeTruthy();

        state.intentId = response.data.id;
        state.orderId = response.data.orderId;

        // Derive webhook event ID from intent ID (same timestamp)
        state.eventId = response.data.id.replace('_test-cs-', '_test-evt-');
      },
    },

    {
      name: 'webhook-transition-purchase-completed',
      async run({ firestore, expect, state, waitFor }) {
        // Poll until the webhook is processed
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        expect(webhookDoc, 'Webhook doc should exist').toBeTruthy();
        expect(webhookDoc.transition, 'Transition should be purchase-completed').toBe('purchase-completed');
        expect(webhookDoc.orderId, 'Webhook doc orderId should match intent').toBe(state.orderId);
        expect(webhookDoc.event?.category, 'Category should be one-time').toBe('one-time');
      },
    },

    {
      name: 'order-doc-created',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.id, 'ID should match orderId').toBe(state.orderId);
        expect(orderDoc.type, 'Type should be one-time').toBe('one-time');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);
        expect(orderDoc.provider, 'Provider should be test').toBe('test');
        expect(orderDoc.unified.product.id, `Product should be ${state.productId}`).toBe(state.productId);
        expect(orderDoc.unified.payment.provider, 'Unified provider should be test').toBe('test');
        expect(orderDoc.unified.payment.orderId, 'Unified orderId should match').toBe(state.orderId);
        expect(orderDoc.requests !== undefined, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be null').toBe(null);
        expect(orderDoc.requests.refund, 'requests.refund should be null').toBe(null);
      },
    },

    {
      name: 'subscription-unchanged',
      async run({ firestore, expect, state }) {
        // One-time payments must NOT modify users/{uid}.subscription
        const userDoc = await firestore.get(`users/${state.uid}`);
        const subAfter = userDoc.subscription || null;

        expect(subAfter?.product?.id, 'Subscription product should be unchanged after one-time purchase').toEqual(state.subscriptionBefore?.product?.id);
        expect(subAfter?.status, 'Subscription status should be unchanged after one-time purchase').toEqual(state.subscriptionBefore?.status);
      },
    },

    {
      name: 'webhook-without-metadata-resolves-from-the-order',
      async run({ http, firestore, expect, state, config, waitFor }) {
        // A redelivery that carries no metadata (no uid, no orderId) — the shape a
        // provider sends when the checkout's metadata never made it onto the event.
        // The test provider answers it the way a real API would: from the order the
        // first webhook already wrote, matched on its resourceId.
        state.bareEventId = `_test-evt-one-time-bare-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.bareEventId,
          type: 'checkout.session.completed',
          data: {
            object: {
              id: state.intentId,
              object: 'checkout.session',
              mode: 'payment',
              status: 'complete',
            },
          },
        });

        expect(response, 'Webhook should be accepted').toBeSuccess();

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.bareEventId}`);
          return doc?.status === 'completed' || doc?.status === 'failed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.bareEventId}`);

        expect(webhookDoc.status, `Webhook should complete (error: ${webhookDoc.error || 'none'})`).toBe('completed');
        expect(webhookDoc.owner, 'UID should be reconstructed from the order').toBe(state.uid);
        expect(webhookDoc.orderId, 'Order ID should be reconstructed from the order').toBe(state.orderId);
      },
    },

    {
      name: 'intent-doc-completed',
      async run({ firestore, expect, state }) {
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);

        expect(intentDoc, 'Intent doc should exist').toBeTruthy();
        expect(intentDoc.id, 'ID should match orderId').toBe(state.orderId);
        expect(intentDoc.intentId, 'Intent ID should match provider session ID').toBe(state.intentId);
        expect(intentDoc.owner, 'Owner should match').toBe(state.uid);
        expect(intentDoc.provider, 'Provider should be test').toBe('test');
        expect(intentDoc.status, 'Intent status should be completed after webhook processing').toBe('completed');
        expect(intentDoc.productId, `Product should be ${state.productId}`).toBe(state.productId);
        expect(intentDoc.metadata?.completed?.timestampUNIX > 0, 'Completed timestamp should be set').toBeTruthy();
      },
    },
  ],
});
