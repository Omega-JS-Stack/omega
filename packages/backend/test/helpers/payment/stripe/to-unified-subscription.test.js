/**
 * Test: Stripe toUnifiedSubscription()
 * Unit tests for the Stripe library's raw subscription → unified subscription transformation
 *
 * Tests the pure function directly — no emulator, no Firestore, no HTTP
 */
const Stripe = require('../../../../dist/omega/libraries/payment/providers/stripe.js');

// Real Stripe CLI fixtures (generated via `stripe trigger`)
const FIXTURE_ACTIVE = require('../../../fixtures/stripe/subscription-active.json');
const FIXTURE_CANCELED = require('../../../fixtures/stripe/subscription-canceled.json');
const FIXTURE_TRIALING = require('../../../fixtures/stripe/subscription-trialing.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

// Mock config matching the @omega.js/backend template (new flat price structure)
const MOCK_CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { requests: 100 } },
      {
        id: 'plus', name: 'Plus', type: 'subscription',
        prices: { monthly: 9.99, annually: 99.99 },
        stripe: { productId: 'prod_plus' },
      },
      {
        id: 'pro', name: 'Pro', type: 'subscription',
        prices: { monthly: 29.99, annually: 299.99 },
        stripe: { productId: 'prod_pro', legacyProductIds: ['prod_pro_old'] },
      },
    ],
  },
};

function toUnifiedSubscription(rawSubscription, options) {
  return Stripe.toUnifiedSubscription(rawSubscription, { config: MOCK_CONFIG, ...options });
}

module.exports = defineCases({
  description: 'Stripe toUnifiedSubscription() transformation',
  type: 'group',

  tests: [
    // ─── Status mapping ───

    {
      name: 'status-active',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'active' });
        expect(result.status, 'Stripe active → unified active').toBe('active');
      },
    },

    {
      name: 'status-trialing',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'trialing', trial_start: 1000, trial_end: 2000 });
        expect(result.status, 'Stripe trialing → unified active').toBe('active');
      },
    },

    {
      name: 'status-past-due',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'past_due' });
        expect(result.status, 'Stripe past_due → unified suspended').toBe('suspended');
      },
    },

    {
      name: 'status-unpaid',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'unpaid' });
        expect(result.status, 'Stripe unpaid → unified suspended').toBe('suspended');
      },
    },

    {
      name: 'status-canceled',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'canceled' });
        expect(result.status, 'Stripe canceled → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-incomplete',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'incomplete' });
        expect(result.status, 'Stripe incomplete → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-incomplete-expired',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'incomplete_expired' });
        expect(result.status, 'Stripe incomplete_expired → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-unknown-defaults-to-cancelled',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'some_future_status' });
        expect(result.status, 'Unknown status → cancelled').toBe('cancelled');
      },
    },

    // ─── Product resolution ───

    {
      name: 'product-resolves-from-plan-product',
      async run({ expect }) {
        const result = toUnifiedSubscription({ plan: { product: 'prod_plus' } });
        expect(result.product.id, 'Should resolve to plus').toBe('plus');
        expect(result.product.name, 'Should have correct name').toBe('Plus');
      },
    },

    {
      name: 'product-resolves-pro-from-plan-product',
      async run({ expect }) {
        const result = toUnifiedSubscription({ plan: { product: 'prod_pro' } });
        expect(result.product.id, 'Should resolve to pro').toBe('pro');
        expect(result.product.name, 'Should have correct name').toBe('Pro');
      },
    },

    {
      name: 'product-resolves-from-items-array',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          items: { data: [{ price: { product: 'prod_plus' } }] },
        });
        expect(result.product.id, 'Should resolve from items.data[0].price.product').toBe('plus');
      },
    },

    {
      name: 'product-resolves-legacy-product-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          items: { data: [{ price: { product: 'prod_pro_old' } }] },
        });
        expect(result.product.id, 'Legacy product ID → pro').toBe('pro');
        expect(result.product.name, 'Legacy product ID → Pro name').toBe('Pro');
      },
    },

    {
      name: 'product-falls-back-to-basic-on-unknown-product',
      async run({ expect }) {
        const result = toUnifiedSubscription({ plan: { product: 'prod_nonexistent' } });
        expect(result.product.id, 'Unknown product → basic').toBe('basic');
        expect(result.product.name, 'Unknown product → Basic name').toBe('Basic');
      },
    },

    {
      name: 'product-falls-back-to-basic-on-missing-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.product.id, 'No plan → basic').toBe('basic');
      },
    },

    {
      name: 'product-falls-back-to-basic-without-config',
      async run({ expect }) {
        const result = Stripe.toUnifiedSubscription({ plan: { product: 'prod_plus' } }, {});
        expect(result.product.id, 'No config → basic').toBe('basic');
      },
    },

    // ─── Frequency resolution ───

    {
      name: 'frequency-month',
      async run({ expect }) {
        const result = toUnifiedSubscription({ plan: { interval: 'month' } });
        expect(result.payment.frequency, 'month → monthly').toBe('monthly');
      },
    },

    {
      name: 'frequency-year',
      async run({ expect }) {
        const result = toUnifiedSubscription({ plan: { interval: 'year' } });
        expect(result.payment.frequency, 'year → annually').toBe('annually');
      },
    },

    {
      name: 'frequency-week',
      async run({ expect }) {
        const result = toUnifiedSubscription({ plan: { interval: 'week' } });
        expect(result.payment.frequency, 'week → weekly').toBe('weekly');
      },
    },

    {
      name: 'frequency-day',
      async run({ expect }) {
        const result = toUnifiedSubscription({ plan: { interval: 'day' } });
        expect(result.payment.frequency, 'day → daily').toBe('daily');
      },
    },

    {
      name: 'frequency-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.frequency, 'Missing interval → null').toBe(null);
      },
    },

    {
      name: 'frequency-from-items-recurring',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          items: { data: [{ price: { recurring: { interval: 'year' } } }] },
        });
        expect(result.payment.frequency, 'items recurring year → annually').toBe('annually');
      },
    },

    // ─── Trial resolution ───

    {
      name: 'trial-claimed-when-both-dates-present',
      async run({ expect }) {
        const result = toUnifiedSubscription({ trial_start: 1700000000, trial_end: 1701209600 });
        expect(result.trial.claimed, 'Both trial dates → claimed').toBe(true);
        expect(result.trial.expires.timestampUNIX > 0, 'Trial expires should be set').toBeTruthy();
      },
    },

    {
      name: 'trial-not-claimed-when-no-dates',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.trial.claimed, 'No trial dates → not claimed').toBe(false);
      },
    },

    {
      name: 'trial-not-claimed-when-only-start',
      async run({ expect }) {
        const result = toUnifiedSubscription({ trial_start: 1700000000 });
        expect(result.trial.claimed, 'Only trial_start → not claimed').toBe(false);
      },
    },

    {
      name: 'trial-not-claimed-when-null-dates',
      async run({ expect }) {
        const result = toUnifiedSubscription({ trial_start: null, trial_end: null });
        expect(result.trial.claimed, 'Null trial dates → not claimed').toBe(false);
      },
    },

    // ─── Cancellation resolution ───

    {
      name: 'cancellation-pending-when-cancel-at-period-end',
      async run({ expect }) {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30;
        const result = toUnifiedSubscription({
          cancel_at_period_end: true,
          cancel_at: futureTimestamp,
          current_period_end: futureTimestamp,
        });
        expect(result.cancellation.pending, 'cancel_at_period_end → pending').toBe(true);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'cancellation-pending-uses-period-end-when-no-cancel-at',
      async run({ expect }) {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30;
        const result = toUnifiedSubscription({
          cancel_at_period_end: true,
          current_period_end: futureTimestamp,
        });
        expect(result.cancellation.pending, 'Should be pending').toBe(true);
      },
    },

    {
      name: 'cancellation-already-cancelled',
      async run({ expect }) {
        const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
        const result = toUnifiedSubscription({
          cancel_at_period_end: false,
          canceled_at: pastTimestamp,
        });
        expect(result.cancellation.pending, 'Already cancelled → not pending').toBe(false);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'cancellation-none',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          cancel_at_period_end: false,
          canceled_at: null,
        });
        expect(result.cancellation.pending, 'No cancellation → not pending').toBe(false);
      },
    },

    // ─── Expiration and start date ───

    {
      name: 'expires-from-period-end',
      async run({ expect }) {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30;
        const result = toUnifiedSubscription({ current_period_end: futureTimestamp });
        expect(result.expires.timestampUNIX > 0, 'Should have expiration').toBeTruthy();
      },
    },

    {
      name: 'expires-defaults-to-epoch-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.expires.timestampUNIX, 'Missing period_end → epoch').toBe(0);
      },
    },

    {
      name: 'start-date-from-raw',
      async run({ expect }) {
        const startTimestamp = Math.floor(Date.now() / 1000) - 86400 * 30;
        const result = toUnifiedSubscription({ start_date: startTimestamp });
        expect(result.payment.startDate.timestampUNIX > 0, 'Should have start date').toBeTruthy();
      },
    },

    {
      name: 'start-date-defaults-to-epoch-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.startDate.timestampUNIX, 'Missing start_date → epoch').toBe(0);
      },
    },

    // ─── Payment metadata ───

    {
      name: 'payment-provider-always-stripe',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.provider, 'Provider should always be stripe').toBe('stripe');
      },
    },

    {
      name: 'payment-resource-id-from-subscription-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({ id: 'sub_abc123' });
        expect(result.payment.resourceId, 'resourceId should be subscription ID').toBe('sub_abc123');
      },
    },

    {
      name: 'payment-resource-id-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.resourceId, 'Missing ID → null resourceId').toBe(null);
      },
    },

    {
      name: 'payment-order-id-from-metadata',
      async run({ expect }) {
        const result = toUnifiedSubscription({ metadata: { orderId: '1234-5678-9012' } });
        expect(result.payment.orderId, 'orderId should come from metadata').toBe('1234-5678-9012');
      },
    },

    {
      name: 'payment-order-id-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.orderId, 'Missing metadata → null orderId').toBe(null);
      },
    },

    {
      name: 'payment-event-metadata-passed-through',
      async run({ expect }) {
        const result = toUnifiedSubscription({}, { eventName: 'customer.subscription.created', eventId: 'evt_123' });
        expect(result.payment.updatedBy.event.name, 'Event name passed through').toBe('customer.subscription.created');
        expect(result.payment.updatedBy.event.id, 'Event ID passed through').toBe('evt_123');
      },
    },

    {
      name: 'payment-event-metadata-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.updatedBy.event.name, 'Missing event name → null').toBe(null);
        expect(result.payment.updatedBy.event.id, 'Missing event ID → null').toBe(null);
      },
    },

    // ─── Full unified shape ───

    {
      name: 'full-active-subscription-shape',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_full_test',
          status: 'active',
          plan: { product: 'prod_pro', interval: 'month' },
          current_period_end: now + 86400 * 30,
          current_period_start: now,
          start_date: now - 86400 * 60,
          cancel_at_period_end: false,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
        }, { eventName: 'customer.subscription.updated', eventId: 'evt_full' });

        // Verify all top-level keys exist
        expect(result.product, 'Should have product').toBeTruthy();
        expect(result.status, 'Should have status').toBeTruthy();
        expect(result.expires, 'Should have expires').toBeTruthy();
        expect(result.trial, 'Should have trial').toBeTruthy();
        expect(result.cancellation, 'Should have cancellation').toBeTruthy();
        expect(result.payment, 'Should have payment').toBeTruthy();

        // Verify values
        expect(result.product.id, 'Product should be pro').toBe('pro');
        expect(result.status, 'Status should be active').toBe('active');
        expect(result.trial.claimed, 'Trial should not be claimed').toBe(false);
        expect(result.cancellation.pending, 'Should not be pending cancellation').toBe(false);
        expect(result.payment.provider, 'Provider should be stripe').toBe('stripe');
        expect(result.payment.resourceId, 'Resource ID should match').toBe('sub_full_test');
        expect(result.payment.frequency, 'Frequency should be monthly').toBe('monthly');
        expect(result.payment.updatedBy.event.name, 'Event name should match').toBe('customer.subscription.updated');
      },
    },

    {
      name: 'empty-subscription-gets-safe-defaults',
      async run({ expect }) {
        const result = toUnifiedSubscription({});

        expect(result.product.id, 'Empty → basic product').toBe('basic');
        expect(result.status, 'Empty → cancelled (no status field)').toBe('cancelled');
        expect(result.trial.claimed, 'Empty → trial not claimed').toBe(false);
        expect(result.cancellation.pending, 'Empty → not pending').toBe(false);
        expect(result.payment.provider, 'Empty → still stripe').toBe('stripe');
        expect(result.payment.orderId, 'Empty → null orderId').toBe(null);
        expect(result.payment.resourceId, 'Empty → null resourceId').toBe(null);
        expect(result.payment.frequency, 'Empty → null frequency').toBe(null);
      },
    },

    // ─── Real Stripe fixtures (via `stripe trigger`) ───

    {
      name: 'fixture-active-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);
        expect(result.status, 'Real active fixture → active').toBe('active');
        expect(result.payment.provider, 'Provider is stripe').toBe('stripe');
        expect(result.payment.resourceId, 'resourceId matches fixture ID').toBe(FIXTURE_ACTIVE.id);
      },
    },

    {
      name: 'fixture-active-frequency',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);
        expect(result.payment.frequency, 'Real active fixture → monthly').toBe('monthly');
      },
    },

    {
      name: 'fixture-active-dates',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);
        expect(result.expires.timestampUNIX > 0, 'Should have real expiration').toBeTruthy();
        expect(result.payment.startDate.timestampUNIX > 0, 'Should have real start date').toBeTruthy();
        expect(result.trial.claimed, 'No trial on active fixture').toBe(false);
        expect(result.cancellation.pending, 'No cancellation on active fixture').toBe(false);
      },
    },

    {
      name: 'fixture-active-product-falls-back',
      async run({ expect }) {
        // Fixture product IDs won't match our mock config, so it should fall back to basic
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);
        expect(result.product.id, 'Unknown product → basic fallback').toBe('basic');
      },
    },

    {
      name: 'fixture-canceled-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_CANCELED);
        expect(result.status, 'Real canceled fixture → cancelled').toBe('cancelled');
        expect(result.cancellation.pending, 'Not pending — already cancelled').toBe(false);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'fixture-canceled-has-ended-at',
      async run({ expect }) {
        expect(FIXTURE_CANCELED.ended_at, 'Canceled fixture should have ended_at').toBeTruthy();
        expect(FIXTURE_CANCELED.canceled_at, 'Canceled fixture should have canceled_at').toBeTruthy();
        const result = toUnifiedSubscription(FIXTURE_CANCELED);
        expect(result.payment.resourceId, 'resourceId matches').toBe(FIXTURE_CANCELED.id);
      },
    },

    {
      name: 'fixture-trialing-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_TRIALING);
        expect(result.status, 'Real trialing fixture → active').toBe('active');
        expect(result.trial.claimed, 'Trialing fixture → trial claimed').toBe(true);
        expect(result.trial.expires.timestampUNIX > 0, 'Trial expiration should be set').toBeTruthy();
      },
    },

    {
      name: 'fixture-trialing-dates',
      async run({ expect }) {
        expect(FIXTURE_TRIALING.trial_start, 'Trialing fixture should have trial_start').toBeTruthy();
        expect(FIXTURE_TRIALING.trial_end, 'Trialing fixture should have trial_end').toBeTruthy();
        const result = toUnifiedSubscription(FIXTURE_TRIALING);
        expect(result.cancellation.pending, 'No cancellation on trialing fixture').toBe(false);
        expect(result.payment.frequency, 'Trialing fixture → monthly').toBe('monthly');
      },
    },

    {
      name: 'fixture-all-have-unified-shape',
      async run({ expect }) {
        const fixtures = [FIXTURE_ACTIVE, FIXTURE_CANCELED, FIXTURE_TRIALING];
        const names = ['active', 'canceled', 'trialing'];

        for (let i = 0; i < fixtures.length; i++) {
          const result = toUnifiedSubscription(fixtures[i]);
          const label = names[i];

          expect(result.product, `${label}: should have product`).toBeTruthy();
          expect(result.product.id, `${label}: should have product.id`).toBeTruthy();
          expect(result.product.name, `${label}: should have product.name`).toBeTruthy();
          expect(result.status, `${label}: status should be string`).toBeTypeOf('string');
          expect(result.expires, `${label}: should have expires`).toBeTruthy();
          expect(result.trial, `${label}: should have trial`).toBeTruthy();
          expect(result.cancellation, `${label}: should have cancellation`).toBeTruthy();
          expect(result.payment, `${label}: should have payment`).toBeTruthy();
          expect(result.payment.provider, `${label}: provider should be stripe`).toBe('stripe');
          expect(result.payment.updatedBy, `${label}: should have updatedBy`).toBeTruthy();
          expect(result.payment.updatedBy.date, `${label}: should have updatedBy.date`).toBeTruthy();
        }
      },
    },

    // ─── Combination / edge-case scenarios ───

    {
      name: 'combo-trialing-with-pending-cancel',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_trial_cancel',
          status: 'trialing',
          trial_start: now - 86400 * 3,
          trial_end: now + 86400 * 11,
          cancel_at_period_end: true,
          cancel_at: now + 86400 * 11,
          canceled_at: null,
          current_period_end: now + 86400 * 11,
          start_date: now - 86400 * 3,
          plan: { product: 'prod_plus', interval: 'month' },
        });

        expect(result.status, 'Trialing + cancel → still active').toBe('active');
        expect(result.trial.claimed, 'Trial should be claimed').toBe(true);
        expect(result.cancellation.pending, 'Cancel should be pending').toBe(true);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancel date').toBeTruthy();
      },
    },

    {
      name: 'combo-trial-payment-fails',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_trial_fail',
          status: 'incomplete_expired',
          trial_start: now - 86400 * 14,
          trial_end: now - 86400,
          cancel_at_period_end: false,
          canceled_at: now,
          current_period_end: now - 86400,
          start_date: now - 86400 * 14,
          plan: { product: 'prod_plus', interval: 'month' },
        });

        expect(result.status, 'Failed trial → cancelled').toBe('cancelled');
        expect(result.trial.claimed, 'Trial was still claimed').toBe(true);
        expect(result.cancellation.pending, 'Not pending — already done').toBe(false);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'combo-active-with-past-trial',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_past_trial',
          status: 'active',
          trial_start: now - 86400 * 30,
          trial_end: now - 86400 * 16,
          cancel_at_period_end: false,
          canceled_at: null,
          current_period_end: now + 86400 * 14,
          start_date: now - 86400 * 30,
          plan: { product: 'prod_pro', interval: 'month' },
        });

        expect(result.status, 'Active with past trial → active').toBe('active');
        expect(result.trial.claimed, 'Past trial → still claimed').toBe(true);
        expect(result.cancellation.pending, 'No cancellation').toBe(false);
        expect(result.product.id, 'Should resolve product').toBe('pro');
      },
    },

    {
      name: 'combo-pending-cancel-reactivated',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_reactivated',
          status: 'active',
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
          current_period_end: now + 86400 * 20,
          start_date: now - 86400 * 40,
          trial_start: null,
          trial_end: null,
          plan: { product: 'prod_pro', interval: 'month' },
        });

        expect(result.status, 'Reactivated → active').toBe('active');
        expect(result.cancellation.pending, 'Cancel reverted → not pending').toBe(false);
      },
    },

    {
      name: 'combo-suspended-with-pending-cancel',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_suspended_cancel',
          status: 'past_due',
          cancel_at_period_end: true,
          cancel_at: now + 86400 * 5,
          canceled_at: null,
          current_period_end: now + 86400 * 5,
          start_date: now - 86400 * 60,
          trial_start: null,
          trial_end: null,
          plan: { product: 'prod_plus', interval: 'month' },
        });

        expect(result.status, 'Past due → suspended').toBe('suspended');
        expect(result.cancellation.pending, 'Cancel still pending').toBe(true);
      },
    },

    {
      name: 'combo-trialing-past-due',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_trial_past_due',
          status: 'past_due',
          trial_start: now - 86400 * 14,
          trial_end: now - 86400,
          cancel_at_period_end: false,
          canceled_at: null,
          current_period_end: now + 86400,
          start_date: now - 86400 * 14,
          plan: { product: 'prod_plus', interval: 'month' },
        });

        expect(result.status, 'Trial ended + payment failed → suspended').toBe('suspended');
        expect(result.trial.claimed, 'Trial was claimed').toBe(true);
        expect(result.cancellation.pending, 'No cancellation pending').toBe(false);
      },
    },
  ],
});
