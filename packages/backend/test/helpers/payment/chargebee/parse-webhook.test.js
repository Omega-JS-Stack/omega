/**
 * Test: Chargebee parseWebhook()
 * Unit tests for the Chargebee webhook provider's event categorization and routing
 *
 * Verifies that parseWebhook() correctly determines category, resourceType, resourceId,
 * and uid for each supported event type.
 */
const chargebeeProvider = require('../../../../dist/omega/routes/payments/webhook/providers/chargebee.js');

// Chargebee webhook fixtures
const FIXTURE_SUB_CREATED = require('../../../fixtures/chargebee/webhook-subscription-created.json');
const FIXTURE_PAYMENT_FAILED = require('../../../fixtures/chargebee/webhook-payment-failed.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

function parseWebhook(event) {
  return chargebeeProvider.parseWebhook({ body: event });
}

module.exports = defineCases({
  description: 'Chargebee parseWebhook() event categorization',
  type: 'group',

  tests: [
    // ─── isSupported() ───

    {
      name: 'supports-subscription-created',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_created'), 'Should support subscription_created').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-cancelled',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_cancelled'), 'Should support subscription_cancelled').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-activated',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_activated'), 'Should support subscription_activated').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-changed',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_changed'), 'Should support subscription_changed').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-renewed',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_renewed'), 'Should support subscription_renewed').toBeTruthy();
      },
    },

    {
      name: 'supports-subscription-reactivated',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_reactivated'), 'Should support subscription_reactivated').toBeTruthy();
      },
    },

    {
      name: 'supports-cancellation-scheduled',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_cancellation_scheduled'), 'Should support subscription_cancellation_scheduled').toBeTruthy();
      },
    },

    {
      name: 'supports-cancellation-removed',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('subscription_scheduled_cancellation_removed'), 'Should support scheduled_cancellation_removed').toBeTruthy();
      },
    },

    {
      name: 'supports-payment-failed',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('payment_failed'), 'Should support payment_failed').toBeTruthy();
      },
    },

    {
      name: 'supports-payment-succeeded',
      async run({ expect }) {
        // The paid signal for a one-time purchase. Without it subscribed, a
        // Chargebee one-time sale reached the pipeline as `invoice_generated`
        // alone — an event that says nothing about payment
        // ([#729](https://github.com/Omega-JS-Stack/omega/issues/729)).
        expect(chargebeeProvider.isSupported('payment_succeeded'), 'Should support payment_succeeded').toBeTruthy();
      },
    },

    {
      name: 'supports-payment-refunded',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('payment_refunded'), 'Should support payment_refunded').toBeTruthy();
      },
    },

    {
      name: 'supports-invoice-generated',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('invoice_generated'), 'Should support invoice_generated').toBeTruthy();
      },
    },

    {
      name: 'rejects-unsupported-event',
      async run({ expect }) {
        expect(chargebeeProvider.isSupported('customer_created'), 'Should not support customer_created').toBe(false);
        expect(chargebeeProvider.isSupported('coupon_created'), 'Should not support coupon_created').toBe(false);
        expect(chargebeeProvider.isSupported('subscription_deleted'), 'Should not support subscription_deleted').toBe(false);
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
          parseWebhook({ event_type: 'subscription_created', content: {} });
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
          parseWebhook({ id: 'ev_123', content: {} });
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e.message, 'Should mention invalid payload').toMatch(/Invalid/);
        }
      },
    },

    // ─── Subscription events ───

    {
      name: 'subscription-created-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_sub_created',
          event_type: 'subscription_created',
          content: {
            subscription: {
              id: 'sub_123',
              meta_data: '{"uid":"user-abc"}',
            },
            customer: { id: 'cust_123' },
          },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be subscription ID').toBe('sub_123');
        expect(result.uid, 'UID should come from meta_data').toBe('user-abc');
        expect(result.eventId, 'Event ID should match').toBe('ev_sub_created');
        expect(result.eventType, 'Event type should match').toBe('subscription_created');
      },
    },

    {
      name: 'subscription-cancelled-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_sub_cancelled',
          event_type: 'subscription_cancelled',
          content: {
            subscription: {
              id: 'sub_456',
              meta_data: '{"uid":"user-def"}',
            },
          },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should match').toBe('sub_456');
        expect(result.uid, 'UID should match').toBe('user-def');
      },
    },

    {
      name: 'subscription-cancellation-scheduled-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_cancel_scheduled',
          event_type: 'subscription_cancellation_scheduled',
          content: {
            subscription: {
              id: 'sub_789',
              meta_data: '{"uid":"user-ghi"}',
              status: 'non_renewing',
            },
          },
        });

        expect(result.category, 'Category should be subscription').toBe('subscription');
        expect(result.uid, 'UID should match').toBe('user-ghi');
      },
    },

    {
      name: 'subscription-event-uid-from-legacy-cf',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_legacy_uid',
          event_type: 'subscription_renewed',
          content: {
            subscription: {
              id: 'sub_legacy',
              cf_uid: 'legacy-user-123',
            },
          },
        });

        expect(result.uid, 'UID should fall back to cf_uid').toBe('legacy-user-123');
      },
    },

    {
      name: 'subscription-event-null-uid-when-missing',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_no_uid',
          event_type: 'subscription_created',
          content: {
            subscription: { id: 'sub_no_uid' },
          },
        });

        expect(result.uid, 'UID should be null when not available').toBe(null);
        expect(result.category, 'Category should still be subscription').toBe('subscription');
      },
    },

    // ─── payment_failed ───

    {
      name: 'payment-failed-subscription-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_pay_fail',
          event_type: 'payment_failed',
          content: {
            subscription: {
              id: 'sub_fail',
              meta_data: '{"uid":"user-fail"}',
            },
            invoice: { id: 'inv_fail', subscription_id: 'sub_fail' },
          },
        });

        expect(result.category, 'With subscription → subscription category').toBe('subscription');
        expect(result.resourceType, 'Should fetch subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be subscription ID').toBe('sub_fail');
        expect(result.uid, 'UID from subscription').toBe('user-fail');
      },
    },

    {
      name: 'payment-failed-one-time-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_pay_fail_onetime',
          event_type: 'payment_failed',
          content: {
            invoice: { id: 'inv_onetime_fail' },
            customer: { id: 'cust_onetime' },
          },
        });

        expect(result.category, 'No subscription → one-time').toBe('one-time');
        expect(result.resourceType, 'Should fetch invoice').toBe('invoice');
        expect(result.resourceId, 'Resource ID should be invoice ID').toBe('inv_onetime_fail');
      },
    },

    // ─── payment_succeeded ───

    {
      name: 'payment-succeeded-one-time-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_pay_ok_onetime',
          event_type: 'payment_succeeded',
          content: {
            invoice: { id: 'inv_onetime_paid' },
            customer: { id: 'cust_onetime', meta_data: '{"uid":"user-onetime-paid"}' },
          },
        });

        expect(result.category, 'No subscription → one-time').toBe('one-time');
        expect(result.resourceType, 'Should fetch invoice').toBe('invoice');
        expect(result.resourceId, 'Resource ID should be invoice ID').toBe('inv_onetime_paid');
        expect(result.uid, 'UID from customer').toBe('user-onetime-paid');
      },
    },

    {
      name: 'payment-succeeded-with-subscription-skipped',
      async run({ expect }) {
        // A renewal's charge. `subscription_renewed` already carries that revenue,
        // so storing this one too would book the renewal twice — the same
        // double-count the Stripe provider documents for `invoice.paid`
        // ([#729](https://github.com/Omega-JS-Stack/omega/issues/729)).
        const result = parseWebhook({
          id: 'ev_pay_ok_sub',
          event_type: 'payment_succeeded',
          content: {
            subscription: { id: 'sub_paid', meta_data: '{"uid":"user-paid"}' },
            invoice: { id: 'inv_renewal', subscription_id: 'sub_paid' },
          },
        });

        expect(result.category, 'With a subscription → null (subscription_renewed owns it)').toBe(null);
      },
    },

    // ─── payment_refunded ───

    {
      name: 'payment-refunded-subscription-category',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_refund',
          event_type: 'payment_refunded',
          content: {
            subscription: {
              id: 'sub_refund',
              meta_data: '{"uid":"user-refund"}',
            },
          },
        });

        expect(result.category, 'With subscription → subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID should be subscription').toBe('sub_refund');
        expect(result.uid, 'UID from subscription').toBe('user-refund');
      },
    },

    {
      name: 'payment-refunded-no-subscription-is-one-time',
      async run({ expect }) {
        // A refund with an invoice and no subscription is the refund of a one-time
        // purchase — the same invoice the one-time payment_failed branch names.
        // Dropping it meant that refund never entered the pipeline at all
        // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
        const result = parseWebhook({
          id: 'ev_refund_onetime',
          event_type: 'payment_refunded',
          content: {
            invoice: { id: 'inv_onetime_refund' },
            transaction: { id: 'txn_refund' },
            customer: { id: 'cust_onetime', meta_data: '{"uid":"user-onetime-refund"}' },
          },
        });

        expect(result.category, 'No subscription → one-time refund').toBe('one-time');
        expect(result.resourceType, 'Should fetch the invoice').toBe('invoice');
        expect(result.resourceId, 'Resource ID should be the invoice ID').toBe('inv_onetime_refund');
        expect(result.uid, 'UID from customer').toBe('user-onetime-refund');
      },
    },

    {
      name: 'payment-refunded-with-neither-subscription-nor-invoice-skipped',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_refund_no_sub',
          event_type: 'payment_refunded',
          content: {
            transaction: { id: 'txn_refund' },
          },
        });

        expect(result.category, 'Nothing to resolve the purchase from → null (skipped)').toBe(null);
      },
    },

    // ─── invoice_generated ───

    {
      name: 'invoice-generated-non-recurring-one-time',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_inv_gen',
          event_type: 'invoice_generated',
          content: {
            invoice: { id: 'inv_onetime_001' },
            customer: { id: 'cust_onetime' },
          },
        });

        expect(result.category, 'Non-recurring invoice → one-time').toBe('one-time');
        expect(result.resourceType, 'Should fetch invoice').toBe('invoice');
        expect(result.resourceId, 'Resource ID should be invoice ID').toBe('inv_onetime_001');
      },
    },

    {
      name: 'invoice-generated-recurring-skipped',
      async run({ expect }) {
        const result = parseWebhook({
          id: 'ev_inv_recurring',
          event_type: 'invoice_generated',
          content: {
            invoice: { id: 'inv_recurring', subscription_id: 'sub_existing' },
          },
        });

        expect(result.category, 'Recurring invoice → null (skipped)').toBe(null);
      },
    },

    // ─── Fixture tests ───

    {
      name: 'fixture-subscription-created',
      async run({ expect }) {
        const result = parseWebhook(FIXTURE_SUB_CREATED);

        expect(result.eventId, 'Event ID matches fixture').toBe(FIXTURE_SUB_CREATED.id);
        expect(result.eventType, 'Event type matches').toBe('subscription_created');
        expect(result.category, 'Category is subscription').toBe('subscription');
        expect(result.resourceType, 'Resource type is subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID from content.subscription.id').toBe('cb_sub_active_001');
        expect(result.uid, 'UID from meta_data').toBe('test-uid-001');
      },
    },

    {
      name: 'fixture-payment-failed',
      async run({ expect }) {
        const result = parseWebhook(FIXTURE_PAYMENT_FAILED);

        expect(result.eventId, 'Event ID matches fixture').toBe(FIXTURE_PAYMENT_FAILED.id);
        expect(result.eventType, 'Event type matches').toBe('payment_failed');
        expect(result.category, 'Category is subscription (has subscription)').toBe('subscription');
        expect(result.resourceType, 'Resource type is subscription').toBe('subscription');
        expect(result.resourceId, 'Resource ID from content.subscription.id').toBe('cb_sub_active_001');
        expect(result.uid, 'UID from subscription meta_data').toBe('test-uid-001');
      },
    },

    // ─── raw passthrough ───

    {
      name: 'raw-contains-full-event',
      async run({ expect }) {
        const event = {
          id: 'ev_raw',
          event_type: 'subscription_changed',
          content: {
            subscription: { id: 'sub_raw', meta_data: '{"uid":"user-raw"}' },
          },
          extra_field: 'preserved',
        };

        const result = parseWebhook(event);
        expect(result.raw, 'Raw should be the full event object').toBe(event);
        expect(result.raw.extra_field, 'Extra fields preserved in raw').toBe('preserved');
      },
    },
  ],
});
