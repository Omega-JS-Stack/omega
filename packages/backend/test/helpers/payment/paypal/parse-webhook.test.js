/**
 * Test: PayPal parseWebhook()
 * Unit tests for the PayPal webhook provider's event categorization and routing
 *
 * Verifies that parseWebhook() correctly determines category, resourceType, resourceId,
 * and uid for each supported event type. Mirrors stripe-parse-webhook.js for consistent coverage.
 */
const paypalProvider = require('../../../../dist/omega/routes/payments/webhook/providers/paypal.js');

// Real PayPal sandbox fixtures
const FIXTURE_ORDER_APPROVED = require('../../../fixtures/paypal/order-approved.json');
const FIXTURE_SUBSCRIPTION_ACTIVE = require('../../../fixtures/paypal/subscription-active.json');
const FIXTURE_CAPTURE_REFUNDED = require('../../../fixtures/paypal/capture-refunded.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

function parseWebhook(event) {
  return paypalProvider.parseWebhook({ body: event });
}

module.exports = defineCases({
  description: 'PayPal parseWebhook() event categorization',
  type: 'group',

  tests: [
    // ─── isSupported() ───

    {
      name: 'supports-subscription-activated',
      async run({ expect }) {
        expect(paypalProvider.isSupported('BILLING.SUBSCRIPTION.ACTIVATED'), 'Should support BILLING.SUBSCRIPTION.ACTIVATED').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-updated',
      async run({ expect }) {
        expect(paypalProvider.isSupported('BILLING.SUBSCRIPTION.UPDATED'), 'Should support BILLING.SUBSCRIPTION.UPDATED').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-cancelled',
      async run({ expect }) {
        expect(paypalProvider.isSupported('BILLING.SUBSCRIPTION.CANCELLED'), 'Should support BILLING.SUBSCRIPTION.CANCELLED').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-suspended',
      async run({ expect }) {
        expect(paypalProvider.isSupported('BILLING.SUBSCRIPTION.SUSPENDED'), 'Should support BILLING.SUBSCRIPTION.SUSPENDED').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-expired',
      async run({ expect }) {
        expect(paypalProvider.isSupported('BILLING.SUBSCRIPTION.EXPIRED'), 'Should support BILLING.SUBSCRIPTION.EXPIRED').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-reactivated',
      async run({ expect }) {
        expect(paypalProvider.isSupported('BILLING.SUBSCRIPTION.RE-ACTIVATED'), 'Should support BILLING.SUBSCRIPTION.RE-ACTIVATED').toBeTruthy();
      },
    },

    {
      name: 'supports-payment-sale-completed',
      async run({ expect }) {
        expect(paypalProvider.isSupported('PAYMENT.SALE.COMPLETED'), 'Should support PAYMENT.SALE.COMPLETED').toBeTruthy();
      },
    },

    {
      name: 'supports-payment-sale-denied',
      async run({ expect }) {
        expect(paypalProvider.isSupported('PAYMENT.SALE.DENIED'), 'Should support PAYMENT.SALE.DENIED').toBeTruthy();
      },
    },

    {
      name: 'supports-payment-sale-refunded',
      async run({ expect }) {
        expect(paypalProvider.isSupported('PAYMENT.SALE.REFUNDED'), 'Should support PAYMENT.SALE.REFUNDED').toBeTruthy();
      },
    },

    {
      name: 'supports-checkout-order-approved',
      async run({ expect }) {
        expect(paypalProvider.isSupported('CHECKOUT.ORDER.APPROVED'), 'Should support CHECKOUT.ORDER.APPROVED').toBeTruthy();
      },
    },

    {
      name: 'supports-payment-capture-refunded',
      async run({ expect }) {
        // One-time purchases this framework creates go through v2 Orders, and a
        // v2 capture refunds as PAYMENT.CAPTURE.REFUNDED — not the v1
        // PAYMENT.SALE.REFUNDED the accepted list stopped at. Dropping it meant
        // a refund of a modern PayPal purchase never entered the pipeline at
        // all ([#240](https://github.com/Omega-JS-Stack/omega/issues/240)).
        expect(paypalProvider.isSupported('PAYMENT.CAPTURE.REFUNDED'), 'Should support PAYMENT.CAPTURE.REFUNDED').toBeTruthy();
      },
    },

    {
      name: 'the-sibling-capture-events-stay-unsupported',
      async run({ expect }) {
        // Reviewed with #240 and deliberately left out. COMPLETED/PENDING/DENIED
        // describe the capture this framework performs ITSELF inside
        // fetchResource('order'), so accepting them would process one purchase
        // twice. REVERSED is a money-out event like a refund, but nothing has
        // ever exercised it here — it needs its own payload and its own issue
        // rather than a guess folded into this one.
        for (const eventType of ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.REVERSED']) {
          expect(paypalProvider.isSupported(eventType), `${eventType} should not be accepted yet`).toBe(false);
        }
      },
    },

    {
      name: 'rejects-unsupported-event',
      async run({ expect }) {
        expect(paypalProvider.isSupported('PAYMENT.ORDER.CREATED'), 'Should not support PAYMENT.ORDER.CREATED').toBe(false);
        expect(paypalProvider.isSupported('CUSTOMER.CREATED'), 'Should not support CUSTOMER.CREATED').toBe(false);
      },
    },

    // ─── Validation ───

    {
      name: 'throws-on-empty-body',
      async run({ expect }) {
        try {
          parseWebhook(null);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e.message, 'Should mention invalid payload').toMatch(/Invalid/);
        }
      },
    },

    {
      name: 'throws-on-missing-id',
      async run({ expect }) {
        try {
          parseWebhook({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: {} });
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e.message, 'Should mention invalid payload').toMatch(/Invalid/);
        }
      },
    },

    {
      name: 'throws-on-missing-event-type',
      async run({ expect }) {
        try {
          parseWebhook({ id: 'WH-123', resource: {} });
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e.message, 'Should mention invalid payload').toMatch(/Invalid/);
        }
      },
    },

    // ─── BILLING.SUBSCRIPTION.* events ───

    {
      name: 'subscription-activated-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-activated',
          event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
          resource: { id: 'I-SUB123', custom_id: 'uid:user-abc,orderId:ord-1' },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be subscription ID').toBe('I-SUB123');
        expect(result.uid, 'UID should come from custom_id').toBe('user-abc');
        expect(result.eventId, 'Event ID should match').toBe('WH-activated');
        expect(result.eventType, 'Event type should match').toBe('BILLING.SUBSCRIPTION.ACTIVATED');
      },
    },

    {
      name: 'subscription-updated-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-updated',
          event_type: 'BILLING.SUBSCRIPTION.UPDATED',
          resource: { id: 'I-SUB456', custom_id: 'uid:user-def,orderId:ord-2' },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('I-SUB456');
        expect(result.uid, 'UID should match').toBe('user-def');
      },
    },

    {
      name: 'subscription-cancelled-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-cancelled',
          event_type: 'BILLING.SUBSCRIPTION.CANCELLED',
          resource: { id: 'I-SUB789', custom_id: 'uid:user-ghi,orderId:ord-3' },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('I-SUB789');
        expect(result.uid, 'UID should match').toBe('user-ghi');
      },
    },

    {
      name: 'subscription-suspended-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-suspended',
          event_type: 'BILLING.SUBSCRIPTION.SUSPENDED',
          resource: { id: 'I-SUSPENDED', custom_id: 'uid:user-sus,orderId:ord-4' },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('I-SUSPENDED');
        expect(result.uid, 'UID should match').toBe('user-sus');
      },
    },

    {
      name: 'subscription-expired-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-expired',
          event_type: 'BILLING.SUBSCRIPTION.EXPIRED',
          resource: { id: 'I-EXPIRED', custom_id: 'uid:user-exp,orderId:ord-5' },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('I-EXPIRED');
        expect(result.uid, 'UID should match').toBe('user-exp');
      },
    },

    {
      name: 'subscription-reactivated-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-reactivated',
          event_type: 'BILLING.SUBSCRIPTION.RE-ACTIVATED',
          resource: { id: 'I-REACTIVATED', custom_id: 'uid:user-re,orderId:ord-6' },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('I-REACTIVATED');
        expect(result.uid, 'UID should match').toBe('user-re');
      },
    },

    {
      name: 'subscription-event-null-uid-when-no-custom-id',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-no-uid',
          event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
          resource: { id: 'I-NO-UID' },
        });

        expect(result.uid, 'UID should be null when no custom_id').toBe(null);
        expect(result.category, 'Category should still be subscription').toBe('subscription');
      },
    },

    {
      name: 'subscription-event-null-uid-when-empty-custom-id',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-empty-uid',
          event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
          resource: { id: 'I-EMPTY-UID', custom_id: '' },
        });

        expect(result.uid, 'UID should be null when custom_id is empty').toBe(null);
      },
    },

    // ─── PAYMENT.SALE.COMPLETED — subscription payment ───

    {
      name: 'sale-completed-subscription-payment',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-sale-sub',
          event_type: 'PAYMENT.SALE.COMPLETED',
          resource: {
            id: 'SALE-123',
            billing_agreement_id: 'I-SUB-BILLING',
            custom_id: 'uid:user-sale,orderId:ord-sale',
          },
        });

        expect(result.category, 'Subscription sale → subscription category').toBe('subscription');
        expect(result.resourceType, 'Should fetch subscription, not sale').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be the subscription ID').toBe('I-SUB-BILLING');
        expect(result.uid, 'UID from custom_id').toBe('user-sale');
      },
    },

    {
      name: 'sale-completed-no-billing-agreement-skipped',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-sale-onetime',
          event_type: 'PAYMENT.SALE.COMPLETED',
          resource: {
            id: 'SALE-456',
            // No billing_agreement_id → not a subscription payment
          },
        });

        expect(result.category, 'No billing agreement → null category (skipped)').toBe(null);
        expect(result.resourceType, 'No resource type').toBe(null);
        expect(result.resourceId, 'No resource ID').toBe(null);
      },
    },

    // ─── PAYMENT.SALE.DENIED — subscription payment failure ───

    {
      name: 'sale-denied-subscription-payment',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-sale-denied',
          event_type: 'PAYMENT.SALE.DENIED',
          resource: {
            id: 'SALE-DENIED',
            billing_agreement_id: 'I-SUB-DENIED',
            custom_id: 'uid:user-denied,orderId:ord-denied',
          },
        });

        expect(result.category, 'Denied subscription sale → subscription').toBe('subscription');
        expect(result.resourceType, 'Should fetch subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be subscription ID').toBe('I-SUB-DENIED');
        expect(result.uid, 'UID from custom_id').toBe('user-denied');
      },
    },

    {
      name: 'sale-denied-no-billing-agreement-skipped',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-sale-denied-onetime',
          event_type: 'PAYMENT.SALE.DENIED',
          resource: { id: 'SALE-DENIED-OT' },
        });

        expect(result.category, 'No billing agreement → null (skipped)').toBe(null);
      },
    },

    // ─── PAYMENT.SALE.REFUNDED ───

    {
      name: 'sale-refunded-subscription-linked',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-refund-sub',
          event_type: 'PAYMENT.SALE.REFUNDED',
          resource: {
            id: 'REFUND-123',
            billing_agreement_id: 'I-SUB-REFUND',
            custom_id: 'uid:user-refund,orderId:ord-refund',
          },
        });

        expect(result.category, 'Subscription refund → subscription').toBe('subscription');
        expect(result.resourceType, 'Should fetch subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be subscription ID').toBe('I-SUB-REFUND');
        expect(result.refundId, 'The refund\'s own id survives the reassignment — its amounts are looked up by it ([#510])').toBe('REFUND-123');
        expect(result.uid, 'UID from custom_id').toBe('user-refund');
      },
    },

    {
      name: 'sale-refunded-no-billing-agreement-is-one-time',
      async run({ expect }) {
        // A refunded sale with no billing agreement behind it is the refund of a
        // one-time purchase. Dropping it (category null) meant that refund never
        // entered the pipeline at all — the Stripe twin of this gap is what
        // [#212](https://github.com/Omega-JS-Stack/omega/issues/212) fixed first.
        const result = parseWebhook({
          id: 'WH-refund-onetime',
          event_type: 'PAYMENT.SALE.REFUNDED',
          resource: {
            id: 'REFUND-OT',
            sale_id: 'SALE-OT',
            custom_id: 'uid:user-onetime-refund,orderId:ord-onetime,productId:credits-100',
          },
        });

        expect(result.category, 'No billing agreement → one-time refund').toBe('one-time');
        expect(result.resourceType, 'The sale the refund reversed is the resource').toBe('sale');
        expect(result.resourceId, 'Resource ID should be the sale ID').toBe('SALE-OT');
        expect(result.refundId, 'The refund\'s own id survives the reassignment — its amounts are looked up by it ([#510])').toBe('REFUND-OT');
        expect(result.uid, 'UID from custom_id').toBe('user-onetime-refund');
      },
    },

    {
      name: 'sale-refunded-falls-back-to-the-refund-id',
      async run({ expect }) {
        // Not every refund resource names its sale — the refund itself is then
        // the only id the event carries
        const result = parseWebhook({
          id: 'WH-refund-onetime-no-sale',
          event_type: 'PAYMENT.SALE.REFUNDED',
          resource: { id: 'REFUND-OT-BARE' },
        });

        expect(result.category, 'No billing agreement → one-time refund').toBe('one-time');
        expect(result.resourceId, 'Resource ID falls back to the refund ID').toBe('REFUND-OT-BARE');
        expect(result.uid, 'A refund carrying no custom_id resolves its uid downstream').toBe(null);
      },
    },

    // ─── CHECKOUT.ORDER.APPROVED — one-time order ───

    {
      name: 'order-approved-one-time',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-order-approved',
          event_type: 'CHECKOUT.ORDER.APPROVED',
          resource: {
            id: 'ORDER-123',
            purchase_units: [{
              custom_id: 'uid:user-order,orderId:ord-order,productId:credits-100',
            }],
          },
        });

        expect(result.category, 'Category should be one-time').toBe('one-time');
        expect(result.resourceType, 'Resource type should be order').toBe('order');
        expect(result.resourceId, 'Resource ID should be the order ID').toBe('ORDER-123');
        expect(result.uid, 'UID should come from purchase_units custom_id').toBe('user-order');
        expect(result.eventType, 'Event type should match').toBe('CHECKOUT.ORDER.APPROVED');
      },
    },

    {
      name: 'order-approved-null-uid-when-no-purchase-units',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-order-no-units',
          event_type: 'CHECKOUT.ORDER.APPROVED',
          resource: { id: 'ORDER-NO-UNITS' },
        });

        expect(result.category, 'Category should still be one-time').toBe('one-time');
        expect(result.resourceType, 'Resource type should be order').toBe('order');
        expect(result.uid, 'UID should be null when no purchase_units').toBe(null);
      },
    },

    {
      name: 'order-approved-null-uid-when-empty-custom-id',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-order-empty',
          event_type: 'CHECKOUT.ORDER.APPROVED',
          resource: {
            id: 'ORDER-EMPTY',
            purchase_units: [{ custom_id: '' }],
          },
        });

        expect(result.uid, 'UID should be null when custom_id is empty').toBe(null);
        expect(result.category, 'Category should still be one-time').toBe('one-time');
      },
    },

    // ─── Custom ID parsing edge cases ───

    {
      name: 'custom-id-with-colon-in-uid',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-colon',
          event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
          resource: {
            id: 'I-COLON',
            custom_id: 'uid:firebase:auth:user123,orderId:ord-c',
          },
        });

        expect(result.uid, 'Should handle colons in uid value').toBe('firebase:auth:user123');
      },
    },

    {
      name: 'custom-id-uid-only',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-uid-only',
          event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
          resource: {
            id: 'I-UID-ONLY',
            custom_id: 'uid:user-only',
          },
        });

        expect(result.uid, 'Should parse uid without orderId').toBe('user-only');
      },
    },

    // ─── Raw passthrough ───

    {
      name: 'raw-contains-full-event',
      async run({ expect }) {
        const event = {
          id: 'WH-raw',
          event_type: 'BILLING.SUBSCRIPTION.UPDATED',
          resource: { id: 'I-RAW', custom_id: 'uid:user-raw,orderId:ord-raw' },
          extra_field: 'preserved',
        };

        const result = parseWebhook(event);
        expect(result.raw, 'Raw should be the full event object').toBe(event);
        expect(result.raw.extra_field, 'Extra fields preserved in raw').toBe('preserved');
      },
    },

    // ─── Unsupported event type passthrough ───

    {
      name: 'unsupported-event-returns-null-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-unsupported',
          event_type: 'PAYMENT.ORDER.CREATED',
          resource: { id: 'ORDER-123' },
        });

        expect(result.category, 'Unsupported event → null category').toBe(null);
        expect(result.resourceType, 'No resource type').toBe(null);
        expect(result.resourceId, 'No resource ID').toBe(null);
        expect(result.eventId, 'Should still return event ID').toBe('WH-unsupported');
        expect(result.eventType, 'Should still return event type').toBe('PAYMENT.ORDER.CREATED');
      },
    },

    // ─── Real PayPal sandbox fixtures ───

    {
      name: 'fixture-subscription-activated-parses-correctly',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-fixture-sub',
          event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
          resource: FIXTURE_SUBSCRIPTION_ACTIVE,
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID from fixture').toBe('I-MTPRX0B9LV4R');
        expect(result.uid, 'UID from fixture custom_id').toBe('test-user-789');
        expect(result.eventType, 'Event type should match').toBe('BILLING.SUBSCRIPTION.ACTIVATED');
      },
    },

    {
      name: 'fixture-order-approved-parses-correctly',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-fixture-order',
          event_type: 'CHECKOUT.ORDER.APPROVED',
          resource: FIXTURE_ORDER_APPROVED,
        });

        expect(result.category, 'Category should be one-time').toBe('one-time');
        expect(result.resourceType, 'Resource type should be order').toBe('order');
        expect(result.resourceId, 'Resource ID from fixture').toBe('5UX02069M9686893E');
        expect(result.uid, 'UID from fixture purchase_units custom_id').toBe('test-user-123');
        expect(result.eventType, 'Event type should match').toBe('CHECKOUT.ORDER.APPROVED');
      },
    },

    // ─── PAYMENT.CAPTURE.REFUNDED — the v2 one-time refund ───

    {
      name: 'fixture-capture-refunded-is-a-one-time-refund',
      async run({ expect }) {
        // The v2 refund resource names the CAPTURE it reversed through its
        // HATEOAS `up` link — there is no parent_payment to walk, and the
        // capture reads back at /v2/payments/captures/{id}
        // ([#240](https://github.com/Omega-JS-Stack/omega/issues/240)).
        const result = parseWebhook({
          id: 'WH-fixture-capture-refund',
          event_type: 'PAYMENT.CAPTURE.REFUNDED',
          resource: FIXTURE_CAPTURE_REFUNDED,
        });

        expect(result.category, 'Category should be one-time').toBe('one-time');
        expect(result.resourceType, 'The capture the refund reversed is the resource').toBe('capture');
        expect(result.resourceId, 'Resource ID is the capture from the up link').toBe('2GG279541U471931P');
        expect(result.uid, 'UID from the refund custom_id').toBe('test-user-123');
        expect(result.eventType, 'Event type should match').toBe('PAYMENT.CAPTURE.REFUNDED');
      },
    },

    {
      name: 'capture-refunded-reads-an-explicit-capture-id-first',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'WH-capture-refund-explicit',
          event_type: 'PAYMENT.CAPTURE.REFUNDED',
          resource: {
            id: 'REFUND-V2',
            capture_id: 'CAPTURE-EXPLICIT',
            custom_id: 'uid:user-capture,orderId:ord-capture,productId:credits-100',
            links: [{ href: 'https://api.paypal.com/v2/payments/captures/CAPTURE-FROM-LINK', rel: 'up', method: 'GET' }],
          },
        });

        expect(result.resourceId, 'An explicit capture_id wins over the link').toBe('CAPTURE-EXPLICIT');
        expect(result.refundId, 'The refund\'s own id survives the reassignment — its amounts are looked up by it ([#510])').toBe('REFUND-V2');
        expect(result.uid, 'UID from custom_id').toBe('user-capture');
      },
    },

    {
      name: 'capture-refunded-without-a-capture-link-falls-back-to-the-refund-id',
      async run({ expect }) {
        // Nothing names the capture: the refund itself is the only id the event
        // carries, same fallback the v1 sale path takes.
        const result = parseWebhook({
          id: 'WH-capture-refund-bare',
          event_type: 'PAYMENT.CAPTURE.REFUNDED',
          resource: { id: 'REFUND-BARE' },
        });

        expect(result.category, 'Still a one-time refund').toBe('one-time');
        expect(result.resourceId, 'Resource ID falls back to the refund ID').toBe('REFUND-BARE');
        expect(result.uid, 'A refund carrying no custom_id resolves its uid downstream').toBe(null);
      },
    },

    {
      name: 'capture-refunded-ignores-links-that-are-not-captures',
      async run({ expect }) {
        // A `up` link pointing at the ORDER (not a capture) is not a capture id.
        const result = parseWebhook({
          id: 'WH-capture-refund-order-link',
          event_type: 'PAYMENT.CAPTURE.REFUNDED',
          resource: {
            id: 'REFUND-ORDER-LINK',
            links: [
              { href: 'https://api.paypal.com/v2/payments/refunds/REFUND-ORDER-LINK', rel: 'self', method: 'GET' },
              { href: 'https://api.paypal.com/v2/checkout/orders/ORDER-123', rel: 'up', method: 'GET' },
            ],
          },
        });

        expect(result.resourceId, 'Only a captures link names a capture').toBe('REFUND-ORDER-LINK');
      },
    },
  ],
});
