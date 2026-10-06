/**
 * Test: Stripe parseWebhook()
 * Unit tests for the Stripe webhook provider's event categorization and routing
 *
 * Verifies that parseWebhook() correctly determines category, resourceType, resourceId,
 * and uid for each supported event type. Uses real Stripe CLI fixtures where available.
 */
const stripeProvider = require('../../../../dist/omega/routes/payments/webhook/providers/stripe.js');

// Real Stripe CLI fixtures
const FIXTURE_INVOICE_MANUAL = require('../../../fixtures/stripe/invoice-payment-failed.json');
const FIXTURE_CHECKOUT_PAYMENT = require('../../../fixtures/stripe/checkout-session-completed.json');

// Hand-crafted fixture (subscription-related invoice failure)
const FIXTURE_INVOICE_SUB = require('../../../fixtures/stripe/invoice-subscription-payment-failed.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

function parseWebhook(event) {
  return stripeProvider.parseWebhook({ body: event });
}

module.exports = defineCases({
  description: 'Stripe parseWebhook() event categorization',
  type: 'group',

  tests: [
    // ─── isSupported() ───

    {
      name: 'supports-subscription-created',
      async run({ expect }) {
        expect(stripeProvider.isSupported('customer.subscription.created'), 'Should support customer.subscription.created').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-updated',
      async run({ expect }) {
        expect(stripeProvider.isSupported('customer.subscription.updated'), 'Should support customer.subscription.updated').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-deleted',
      async run({ expect }) {
        expect(stripeProvider.isSupported('customer.subscription.deleted'), 'Should support customer.subscription.deleted').toBeTruthy();
      },
    },

    {
      name: 'supports-invoice-payment-failed',
      async run({ expect }) {
        expect(stripeProvider.isSupported('invoice.payment_failed'), 'Should support invoice.payment_failed').toBeTruthy();
      },
    },

    {
      name: 'supports-checkout-session-completed',
      async run({ expect }) {
        expect(stripeProvider.isSupported('checkout.session.completed'), 'Should support checkout.session.completed').toBeTruthy();
      },
    },

    {
      name: 'rejects-unsupported-event',
      async run({ expect }) {
        expect(stripeProvider.isSupported('charge.succeeded'), 'Should not support charge.succeeded').toBe(false);
        expect(stripeProvider.isSupported('customer.created'), 'Should not support customer.created').toBe(false);
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
          parseWebhook({ type: 'customer.subscription.updated', data: { object: {} } });
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e.message, 'Should mention invalid payload').toMatch(/Invalid/);
        }
      },
    },

    {
      name: 'throws-on-missing-type',
      async run({ expect }) {
        try {
          parseWebhook({ id: 'evt_123', data: { object: {} } });
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e.message, 'Should mention invalid payload').toMatch(/Invalid/);
        }
      },
    },

    // ─── customer.subscription.* events ───

    {
      name: 'subscription-created-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_sub_created',
          type: 'customer.subscription.created',
          data: { object: { id: 'sub_123', metadata: { uid: 'user-abc' } } },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be subscription ID').toBe('sub_123');
        expect(result.uid, 'UID should come from metadata').toBe('user-abc');
        expect(result.eventId, 'Event ID should match').toBe('evt_sub_created');
        expect(result.eventType, 'Event type should match').toBe('customer.subscription.created');
      },
    },

    {
      name: 'subscription-updated-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_sub_updated',
          type: 'customer.subscription.updated',
          data: { object: { id: 'sub_456', metadata: { uid: 'user-def' } } },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('sub_456');
        expect(result.uid, 'UID should match').toBe('user-def');
      },
    },

    {
      name: 'subscription-deleted-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_sub_deleted',
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_789', metadata: { uid: 'user-ghi' } } },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('sub_789');
        expect(result.uid, 'UID should match').toBe('user-ghi');
      },
    },

    {
      name: 'subscription-event-null-uid-when-missing-metadata',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_no_uid',
          type: 'customer.subscription.created',
          data: { object: { id: 'sub_no_uid', metadata: {} } },
        });

        expect(result.uid, 'UID should be null when not in metadata').toBe(null);
        expect(result.category, 'Category should still be subscription').toBe('subscription');
      },
    },

    // ─── invoice.payment_failed — subscription-related ───

    {
      name: 'invoice-sub-failure-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_inv_sub_fail',
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: 'in_sub_fail',
              billing_reason: 'subscription_cycle',
              parent: {
                subscription_details: {
                  subscription: 'sub_target',
                  metadata: { uid: 'user-sub-fail' },
                },
              },
            },
          },
        });

        expect(result.category, 'Subscription invoice failure → subscription category').toBe('subscription');
        expect(result.resourceType, 'Should fetch the subscription, not the invoice').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be the subscription ID').toBe('sub_target');
        expect(result.uid, 'UID should come from subscription metadata').toBe('user-sub-fail');
      },
    },

    {
      name: 'invoice-sub-failure-from-fixture',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_fixture_sub_fail',
          type: 'invoice.payment_failed',
          data: { object: FIXTURE_INVOICE_SUB },
        });

        expect(result.category, 'Fixture: should be subscription category').toBe('subscription');
        expect(result.resourceType, 'Fixture: should fetch subscription').toBe('subscription');
        expect(result.resourceId, 'Fixture: resource ID from parent.subscription_details').toBe('sub_test_failed_sub');
        expect(result.uid, 'Fixture: UID from subscription metadata').toBe('test-uid-sub-fail');
      },
    },

    {
      name: 'invoice-sub-failure-subscription-create-reason',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_inv_sub_create',
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: 'in_sub_create_fail',
              billing_reason: 'subscription_create',
              parent: {
                subscription_details: {
                  subscription: 'sub_new',
                  metadata: { uid: 'user-new' },
                },
              },
            },
          },
        });

        expect(result.category, 'subscription_create billing reason → subscription').toBe('subscription');
        expect(result.resourceId, 'Should use subscription ID').toBe('sub_new');
      },
    },

    {
      name: 'invoice-sub-failure-legacy-subscription-field',
      async run({ expect }) {
        // Older Stripe API versions use data.object.subscription instead of parent
        const result = parseWebhook({
          id: 'evt_inv_legacy',
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: 'in_legacy',
              billing_reason: 'subscription_cycle',
              subscription: 'sub_legacy',
              metadata: { uid: 'user-legacy' },
            },
          },
        });

        expect(result.category, 'Legacy format → subscription').toBe('subscription');
        expect(result.resourceType, 'Should still fetch subscription').toBe('subscription');
        expect(result.resourceId, 'Should use legacy subscription field').toBe('sub_legacy');
        expect(result.uid, 'UID falls back to invoice metadata').toBe('user-legacy');
      },
    },

    // ─── invoice.payment_failed — one-time ───

    {
      name: 'invoice-onetime-failure-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_inv_manual_fail',
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: 'in_manual_fail',
              billing_reason: 'manual',
              metadata: { uid: 'user-manual' },
            },
          },
        });

        expect(result.category, 'Manual billing reason → one-time').toBe('one-time');
        expect(result.resourceType, 'Should fetch the invoice').toBe('invoice');
        expect(result.resourceId, 'Resource ID should be invoice ID').toBe('in_manual_fail');
        expect(result.uid, 'UID from invoice metadata').toBe('user-manual');
      },
    },

    {
      name: 'invoice-onetime-failure-from-fixture',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_fixture_manual',
          type: 'invoice.payment_failed',
          data: { object: FIXTURE_INVOICE_MANUAL },
        });

        expect(result.category, 'Fixture: manual billing → one-time').toBe('one-time');
        expect(result.resourceType, 'Fixture: should fetch invoice').toBe('invoice');
        expect(result.resourceId, 'Fixture: resource ID is invoice ID').toBe(FIXTURE_INVOICE_MANUAL.id);
        expect(result.uid, 'Fixture: no uid in metadata (CLI-generated)').toBe(null);
      },
    },

    {
      name: 'invoice-failure-no-billing-reason-defaults-to-onetime',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_inv_no_reason',
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: 'in_no_reason',
              metadata: { uid: 'user-no-reason' },
            },
          },
        });

        expect(result.category, 'No billing reason → one-time').toBe('one-time');
        expect(result.resourceType, 'Should fetch invoice').toBe('invoice');
      },
    },

    // ─── checkout.session.completed — one-time payment ───

    {
      name: 'checkout-payment-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_cs_payment',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_payment',
              mode: 'payment',
              metadata: { uid: 'user-checkout' },
            },
          },
        });

        expect(result.category, 'Payment mode → one-time').toBe('one-time');
        expect(result.resourceType, 'Should fetch session').toBe('session');
        expect(result.resourceId, 'Resource ID should be session ID').toBe('cs_test_payment');
        expect(result.uid, 'UID from session metadata').toBe('user-checkout');
      },
    },

    {
      name: 'checkout-payment-from-fixture',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_fixture_checkout',
          type: 'checkout.session.completed',
          data: { object: FIXTURE_CHECKOUT_PAYMENT },
        });

        expect(result.category, 'Fixture: payment mode → one-time').toBe('one-time');
        expect(result.resourceType, 'Fixture: should fetch session').toBe('session');
        expect(result.resourceId, 'Fixture: resource ID is session ID').toBe(FIXTURE_CHECKOUT_PAYMENT.id);
        expect(result.uid, 'Fixture: no uid in metadata (CLI-generated)').toBe(null);
      },
    },

    // ─── checkout.session.completed — subscription mode (skipped) ───

    {
      name: 'checkout-subscription-skipped',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_cs_sub',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_sub',
              mode: 'subscription',
              metadata: { uid: 'user-cs-sub' },
            },
          },
        });

        expect(result.category, 'Subscription checkout → null (skipped)').toBe(null);
        expect(result.resourceType, 'No resource type for skipped events').toBe(null);
        expect(result.resourceId, 'No resource ID for skipped events').toBe(null);
      },
    },

    {
      name: 'checkout-unknown-mode-skipped',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_cs_unknown',
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_unknown',
              mode: 'setup',
              metadata: {},
            },
          },
        });

        expect(result.category, 'Unknown checkout mode → null').toBe(null);
      },
    },

    // ─── Unsupported event type passthrough ───

    {
      name: 'unsupported-event-returns-null-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'evt_unsupported',
          type: 'charge.succeeded',
          data: { object: { id: 'ch_123' } },
        });

        expect(result.category, 'Unsupported event → null category').toBe(null);
        expect(result.resourceType, 'No resource type').toBe(null);
        expect(result.resourceId, 'No resource ID').toBe(null);
        expect(result.eventId, 'Should still return event ID').toBe('evt_unsupported');
        expect(result.eventType, 'Should still return event type').toBe('charge.succeeded');
      },
    },

    // ─── raw passthrough ───

    {
      name: 'raw-contains-full-event',
      async run({ expect }) {
        const event = {
          id: 'evt_raw',
          type: 'customer.subscription.updated',
          data: { object: { id: 'sub_raw', metadata: { uid: 'user-raw' } } },
          extra_field: 'preserved',
        };

        const result = parseWebhook(event);
        expect(result.raw, 'Raw should be the full event object').toBe(event);
        expect(result.raw.extra_field, 'Extra fields preserved in raw').toBe('preserved');
      },
    },
  ],
});
