/**
 * Test: PayPal toUnifiedSubscription()
 * Unit tests for the PayPal library's raw subscription → unified subscription transformation
 *
 * Tests the pure function directly — no emulator, no Firestore, no HTTP
 * Mirrors stripe/to-unified-subscription.js for consistent coverage
 */
const PayPal = require('../../../../dist/omega/libraries/payment/providers/paypal.js');

// Real PayPal sandbox fixtures
const FIXTURE_ACTIVE = require('../../../fixtures/paypal/subscription-active.json');
const FIXTURE_CANCELLED = require('../../../fixtures/paypal/subscription-cancelled.json');
const FIXTURE_SUSPENDED = require('../../../fixtures/paypal/subscription-suspended.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

// Mock config matching the @omega.js/backend template (new flat price structure)
const MOCK_CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { requests: 100 } },
      {
        id: 'plus', name: 'Plus', type: 'subscription',
        prices: { monthly: 9.99, annually: 99.99 },
        paypal: { productId: 'PROD-plus' },
      },
      {
        id: 'pro', name: 'Pro', type: 'subscription',
        prices: { monthly: 29.99, annually: 299.99 },
        paypal: { productId: 'PROD-pro' },
      },
    ],
  },
};

function toUnifiedSubscription(rawSubscription, options) {
  return PayPal.toUnifiedSubscription(rawSubscription, { config: MOCK_CONFIG, ...options });
}

module.exports = defineCases({
  description: 'PayPal toUnifiedSubscription() transformation',
  type: 'group',

  tests: [
    // ─── Status mapping ───

    {
      name: 'status-active',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'ACTIVE' });
        expect(result.status, 'PayPal ACTIVE → unified active').toBe('active');
      },
    },

    {
      name: 'status-approved',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'APPROVED' });
        expect(result.status, 'PayPal APPROVED → unified active').toBe('active');
      },
    },

    {
      name: 'status-suspended',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'SUSPENDED' });
        expect(result.status, 'PayPal SUSPENDED → unified suspended').toBe('suspended');
      },
    },

    {
      name: 'status-cancelled',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'CANCELLED' });
        expect(result.status, 'PayPal CANCELLED → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-expired',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'EXPIRED' });
        expect(result.status, 'PayPal EXPIRED → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-approval-pending',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'APPROVAL_PENDING' });
        expect(result.status, 'PayPal APPROVAL_PENDING → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-unknown-defaults-to-cancelled',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'SOME_FUTURE_STATUS' });
        expect(result.status, 'Unknown status → cancelled').toBe('cancelled');
      },
    },

    // ─── Product resolution ───

    {
      name: 'product-resolves-from-plan-product-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: { product_id: 'PROD-plus' },
        });
        expect(result.product.id, 'Should resolve to plus').toBe('plus');
        expect(result.product.name, 'Should have correct name').toBe('Plus');
      },
    },

    {
      name: 'product-resolves-pro-from-plan-product-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: { product_id: 'PROD-pro' },
        });
        expect(result.product.id, 'Should resolve to pro').toBe('pro');
        expect(result.product.name, 'Should have correct name').toBe('Pro');
      },
    },

    {
      name: 'product-falls-back-to-basic-on-unknown-product',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: { product_id: 'PROD-nonexistent' },
        });
        expect(result.product.id, 'Unknown product → basic').toBe('basic');
        expect(result.product.name, 'Unknown product → Basic name').toBe('Basic');
      },
    },

    {
      name: 'product-falls-back-to-basic-on-missing-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.product.id, 'No _plan → basic').toBe('basic');
      },
    },

    {
      name: 'product-falls-back-to-basic-without-config',
      async run({ expect }) {
        const result = PayPal.toUnifiedSubscription(
          { _plan: { product_id: 'PROD-plus' } },
          {},
        );
        expect(result.product.id, 'No config → basic').toBe('basic');
      },
    },

    // ─── Frequency resolution ───

    {
      name: 'frequency-month-from-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.frequency, 'MONTH → monthly').toBe('monthly');
      },
    },

    {
      name: 'frequency-year-from-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'YEAR', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.frequency, 'YEAR → annually').toBe('annually');
      },
    },

    {
      name: 'frequency-week-from-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'WEEK', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.frequency, 'WEEK → weekly').toBe('weekly');
      },
    },

    {
      name: 'frequency-day-from-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'DAY', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.frequency, 'DAY → daily').toBe('daily');
      },
    },

    {
      name: 'frequency-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.frequency, 'Missing plan → null').toBe(null);
      },
    },

    {
      name: 'frequency-from-inline-plan',
      async run({ expect }) {
        // PayPal ?fields=plan returns plan inline
        const result = toUnifiedSubscription({
          plan: {
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'YEAR', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.frequency, 'Inline plan year → annually').toBe('annually');
      },
    },

    {
      name: 'frequency-prefers-plan-over-inline',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
          plan: {
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'YEAR', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.frequency, '_plan takes priority over inline plan').toBe('monthly');
      },
    },

    // ─── Trial resolution ───

    {
      name: 'trial-claimed-when-plan-has-trial-cycle',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          start_time: '2024-01-01T00:00:00Z',
          _plan: {
            billing_cycles: [
              {
                tenure_type: 'TRIAL',
                frequency: { interval_unit: 'DAY', interval_count: 1 },
                total_cycles: 14,
              },
              {
                tenure_type: 'REGULAR',
                frequency: { interval_unit: 'MONTH', interval_count: 1 },
              },
            ],
          },
        });
        expect(result.trial.claimed, 'Plan with trial cycle → claimed').toBe(true);
        expect(result.trial.expires.timestampUNIX > 0, 'Trial expires should be set').toBeTruthy();
      },
    },

    {
      name: 'trial-not-claimed-when-no-trial-cycle',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            billing_cycles: [
              {
                tenure_type: 'REGULAR',
                frequency: { interval_unit: 'MONTH', interval_count: 1 },
              },
            ],
          },
        });
        expect(result.trial.claimed, 'No trial cycle → not claimed').toBe(false);
      },
    },

    {
      name: 'trial-not-claimed-when-no-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.trial.claimed, 'No plan → not claimed').toBe(false);
      },
    },

    {
      name: 'trial-claimed-with-no-start-time-has-epoch-expiry',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            billing_cycles: [
              {
                tenure_type: 'TRIAL',
                frequency: { interval_unit: 'DAY', interval_count: 1 },
                total_cycles: 7,
              },
            ],
          },
        });
        expect(result.trial.claimed, 'Trial cycle exists → claimed').toBe(true);
        expect(result.trial.expires.timestampUNIX, 'No start_time → epoch expiry').toBe(0);
      },
    },

    {
      name: 'trial-month-based-cycle',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          start_time: '2024-01-01T00:00:00Z',
          _plan: {
            billing_cycles: [
              {
                tenure_type: 'TRIAL',
                frequency: { interval_unit: 'MONTH', interval_count: 1 },
                total_cycles: 1,
              },
            ],
          },
        });
        expect(result.trial.claimed, 'Monthly trial → claimed').toBe(true);
        expect(result.trial.expires.timestampUNIX > 0, 'Should have computed trial end').toBeTruthy();
      },
    },

    // ─── Cancellation resolution ───

    {
      name: 'cancellation-when-status-cancelled',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          status: 'CANCELLED',
          status_update_time: '2024-06-15T12:00:00Z',
        });
        expect(result.cancellation.pending, 'Already cancelled → not pending').toBe(false);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'cancellation-cancelled-no-update-time',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          status: 'CANCELLED',
        });
        expect(result.cancellation.pending, 'Already cancelled → not pending').toBe(false);
        expect(result.cancellation.date.timestampUNIX, 'No update time → epoch').toBe(0);
      },
    },

    {
      name: 'cancellation-none-when-active',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          status: 'ACTIVE',
        });
        expect(result.cancellation.pending, 'Active → not pending').toBe(false);
        expect(result.cancellation.date.timestampUNIX, 'No cancellation date').toBe(0);
      },
    },

    // ─── Expiration resolution ───

    {
      name: 'expires-from-next-billing-time',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          billing_info: { next_billing_time: '2024-07-01T00:00:00Z' },
        });
        expect(result.expires.timestampUNIX > 0, 'Should have expiration').toBeTruthy();
      },
    },

    {
      name: 'expires-defaults-to-epoch-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.expires.timestampUNIX, 'Missing billing_info → epoch').toBe(0);
      },
    },

    // ─── Start date resolution ───

    {
      name: 'start-date-from-start-time',
      async run({ expect }) {
        const result = toUnifiedSubscription({ start_time: '2024-01-15T00:00:00Z' });
        expect(result.payment.startDate.timestampUNIX > 0, 'Should have start date from start_time').toBeTruthy();
      },
    },

    {
      name: 'start-date-from-create-time-fallback',
      async run({ expect }) {
        const result = toUnifiedSubscription({ create_time: '2024-01-10T00:00:00Z' });
        expect(result.payment.startDate.timestampUNIX > 0, 'Should have start date from create_time').toBeTruthy();
      },
    },

    {
      name: 'start-date-defaults-to-epoch-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.startDate.timestampUNIX, 'Missing start_time → epoch').toBe(0);
      },
    },

    // ─── Payment metadata ───

    {
      name: 'payment-provider-always-paypal',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.provider, 'Provider should always be paypal').toBe('paypal');
      },
    },

    {
      name: 'payment-resource-id-from-subscription-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({ id: 'I-ABC123' });
        expect(result.payment.resourceId, 'resourceId should be subscription ID').toBe('I-ABC123');
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
      name: 'payment-order-id-from-custom-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({ custom_id: 'uid:user-abc,orderId:1234-5678' });
        expect(result.payment.orderId, 'orderId should come from custom_id').toBe('1234-5678');
      },
    },

    {
      name: 'payment-order-id-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.orderId, 'Missing custom_id → null orderId').toBe(null);
      },
    },

    {
      name: 'payment-event-metadata-passed-through',
      async run({ expect }) {
        const result = toUnifiedSubscription({}, { eventName: 'BILLING.SUBSCRIPTION.ACTIVATED', eventId: 'WH-123' });
        expect(result.payment.updatedBy.event.name, 'Event name passed through').toBe('BILLING.SUBSCRIPTION.ACTIVATED');
        expect(result.payment.updatedBy.event.id, 'Event ID passed through').toBe('WH-123');
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

    // ─── Price resolution ───

    {
      name: 'price-resolves-from-config',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            product_id: 'PROD-plus',
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.price, 'Price should match config for plus/monthly').toBe(9.99);
      },
    },

    {
      name: 'price-resolves-annually',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: {
            product_id: 'PROD-pro',
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'YEAR', interval_count: 1 } },
            ],
          },
        });
        expect(result.payment.price, 'Price should match config for pro/annually').toBe(299.99);
      },
    },

    {
      name: 'price-zero-when-product-unknown',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          _plan: { product_id: 'PROD-nonexistent' },
        });
        expect(result.payment.price, 'Unknown product → price 0').toBe(0);
      },
    },

    // ─── Custom ID parsing ───

    {
      name: 'custom-id-parses-uid-and-order-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          custom_id: 'uid:user-123,orderId:ord-456',
        });
        expect(result.payment.orderId, 'orderId from custom_id').toBe('ord-456');
      },
    },

    {
      name: 'custom-id-handles-colons-in-values',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          custom_id: 'uid:user:with:colons,orderId:ord-789',
        });
        expect(result.payment.orderId, 'orderId parsed correctly').toBe('ord-789');
      },
    },

    {
      name: 'custom-id-handles-empty-string',
      async run({ expect }) {
        const result = toUnifiedSubscription({ custom_id: '' });
        expect(result.payment.orderId, 'Empty custom_id → null').toBe(null);
      },
    },

    // ─── Full unified shape ───

    {
      name: 'full-active-subscription-shape',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          id: 'I-FULL-TEST',
          status: 'ACTIVE',
          custom_id: 'uid:user-full,orderId:ord-full',
          start_time: '2024-01-01T00:00:00Z',
          billing_info: { next_billing_time: '2024-02-01T00:00:00Z' },
          _plan: {
            product_id: 'PROD-pro',
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        }, { eventName: 'BILLING.SUBSCRIPTION.ACTIVATED', eventId: 'WH-FULL' });

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
        expect(result.payment.provider, 'Provider should be paypal').toBe('paypal');
        expect(result.payment.resourceId, 'Resource ID should match').toBe('I-FULL-TEST');
        expect(result.payment.frequency, 'Frequency should be monthly').toBe('monthly');
        expect(result.payment.orderId, 'Order ID should match').toBe('ord-full');
        expect(result.payment.updatedBy.event.name, 'Event name should match').toBe('BILLING.SUBSCRIPTION.ACTIVATED');
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
        expect(result.payment.provider, 'Empty → still paypal').toBe('paypal');
        expect(result.payment.orderId, 'Empty → null orderId').toBe(null);
        expect(result.payment.resourceId, 'Empty → null resourceId').toBe(null);
        expect(result.payment.frequency, 'Empty → null frequency').toBe(null);
      },
    },

    // ─── Combination / edge-case scenarios ───

    {
      name: 'combo-active-with-trial',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          id: 'I-TRIAL-ACTIVE',
          status: 'ACTIVE',
          start_time: '2024-01-01T00:00:00Z',
          _plan: {
            product_id: 'PROD-plus',
            billing_cycles: [
              {
                tenure_type: 'TRIAL',
                frequency: { interval_unit: 'DAY', interval_count: 1 },
                total_cycles: 14,
              },
              {
                tenure_type: 'REGULAR',
                frequency: { interval_unit: 'MONTH', interval_count: 1 },
              },
            ],
          },
        });

        expect(result.status, 'Active with trial → active').toBe('active');
        expect(result.trial.claimed, 'Trial should be claimed').toBe(true);
        expect(result.product.id, 'Should resolve product').toBe('plus');
        expect(result.payment.frequency, 'Regular cycle → monthly').toBe('monthly');
      },
    },

    {
      name: 'combo-suspended-subscription',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          id: 'I-SUSPENDED',
          status: 'SUSPENDED',
          custom_id: 'uid:user-sus,orderId:ord-sus',
          _plan: {
            product_id: 'PROD-pro',
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'YEAR', interval_count: 1 } },
            ],
          },
        });

        expect(result.status, 'SUSPENDED → suspended').toBe('suspended');
        expect(result.product.id, 'Should resolve product').toBe('pro');
        expect(result.payment.frequency, 'Year → annually').toBe('annually');
        expect(result.cancellation.pending, 'Not cancelled, just suspended').toBe(false);
      },
    },

    {
      name: 'combo-cancelled-with-update-time',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          id: 'I-CANCEL',
          status: 'CANCELLED',
          status_update_time: '2024-06-15T18:30:00Z',
          custom_id: 'uid:user-cancel,orderId:ord-cancel',
          _plan: {
            product_id: 'PROD-plus',
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        });

        expect(result.status, 'CANCELLED → cancelled').toBe('cancelled');
        expect(result.cancellation.pending, 'Already cancelled → not pending').toBe(false);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
        expect(result.payment.orderId, 'Order ID preserved').toBe('ord-cancel');
      },
    },

    {
      name: 'combo-cancelled-during-a-trial-keeps-no-access',
      async run({ expect }) {
        // Cancelling a trial ends access NOW (Ian's ruling, 2026-08-15 — #267).
        // A trial can still carry a `last_payment`: a plan with a setup fee
        // charges one on day zero. Pricing the "remaining period" off that
        // payment handed a cancelled trialer a full paid month for free.
        const threeDaysAgo = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString();

        const result = toUnifiedSubscription({
          id: 'I-TRIAL-CANCEL',
          status: 'CANCELLED',
          status_update_time: new Date().toISOString(),
          start_time: threeDaysAgo,
          billing_info: { last_payment: { amount: { currency_code: 'USD', value: '1.0' }, time: threeDaysAgo } },
          _plan: {
            product_id: 'PROD-plus',
            billing_cycles: [
              { tenure_type: 'TRIAL', frequency: { interval_unit: 'DAY', interval_count: 1 }, total_cycles: 14 },
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        });

        expect(result.trial.claimed, 'the subscription is three days into a fourteen-day trial').toBe(true);
        expect(result.status, 'a cancelled trial is cancelled NOW, setup fee or not').toBe('cancelled');
        expect(result.cancellation.pending, 'there is no paid period to serve out').toBe(false);
        expect(result.expires.timestampUNIX <= Math.floor(Date.now() / 1000), 'and no future expiry is handed out').toBeTruthy();
      },
    },

    {
      name: 'combo-cancelled-after-the-trial-converted-serves-out-the-period',
      async run({ expect }) {
        // The other half: once the trial has converted, the customer HAS paid
        // for the period they are in, and cancelling still runs to its end.
        const sixtyDaysAgo = new Date(Date.now() - (60 * 24 * 60 * 60 * 1000)).toISOString();
        const fiveDaysAgo = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString();

        const result = toUnifiedSubscription({
          id: 'I-CONVERTED-CANCEL',
          status: 'CANCELLED',
          status_update_time: new Date().toISOString(),
          start_time: sixtyDaysAgo,
          billing_info: { last_payment: { amount: { currency_code: 'USD', value: '9.99' }, time: fiveDaysAgo } },
          _plan: {
            product_id: 'PROD-plus',
            billing_cycles: [
              { tenure_type: 'TRIAL', frequency: { interval_unit: 'DAY', interval_count: 1 }, total_cycles: 14 },
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        });

        expect(result.status, 'a paid period still runs to its end').toBe('active');
        expect(result.cancellation.pending, 'so the cancellation is pending, not done').toBe(true);
        expect(result.expires.timestampUNIX > Math.floor(Date.now() / 1000), 'with the period end as the expiry').toBeTruthy();
      },
    },

    {
      name: 'combo-expired-subscription',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          id: 'I-EXPIRED',
          status: 'EXPIRED',
          _plan: {
            product_id: 'PROD-pro',
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        });

        expect(result.status, 'EXPIRED → cancelled').toBe('cancelled');
        expect(result.product.id, 'Should still resolve product').toBe('pro');
      },
    },

    // ─── Unified shape matches Stripe output ───

    {
      name: 'shape-matches-stripe-output-keys',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          id: 'I-SHAPE',
          status: 'ACTIVE',
          custom_id: 'uid:u1,orderId:o1',
          start_time: '2024-01-01T00:00:00Z',
          billing_info: { next_billing_time: '2024-02-01T00:00:00Z' },
          _plan: {
            product_id: 'PROD-plus',
            billing_cycles: [
              { tenure_type: 'REGULAR', frequency: { interval_unit: 'MONTH', interval_count: 1 } },
            ],
          },
        });

        // Top-level keys
        const topKeys = Object.keys(result).sort();
        expect(topKeys, 'Should have same top-level keys as Stripe unified').toEqual(['cancellation', 'expires', 'payment', 'product', 'status', 'trial']);

        // Product shape
        expect(result.product.id, 'product.id exists').toBeTruthy();
        expect(result.product.name, 'product.name exists').toBeTruthy();

        // Expires shape
        expect(result.expires.timestamp, 'expires.timestamp is string').toBeTypeOf('string');
        expect(result.expires.timestampUNIX, 'expires.timestampUNIX is number').toBeTypeOf('number');

        // Trial shape
        expect(result.trial.claimed, 'trial.claimed is boolean').toBeTypeOf('boolean');
        expect(result.trial.expires, 'trial.expires exists').toBeTruthy();

        // Cancellation shape
        expect(result.cancellation.pending, 'cancellation.pending is boolean').toBeTypeOf('boolean');
        expect(result.cancellation.date, 'cancellation.date exists').toBeTruthy();

        // Payment shape
        expect(result.payment.provider, 'payment.provider').toBe('paypal');
        expect('orderId' in result.payment, 'payment.orderId exists').toBeTruthy();
        expect('resourceId' in result.payment, 'payment.resourceId exists').toBeTruthy();
        expect('frequency' in result.payment, 'payment.frequency exists').toBeTruthy();
        expect('price' in result.payment, 'payment.price exists').toBeTruthy();
        expect(result.payment.startDate, 'payment.startDate exists').toBeTruthy();
        expect(result.payment.updatedBy, 'payment.updatedBy exists').toBeTruthy();
        expect(result.payment.updatedBy.event, 'payment.updatedBy.event exists').toBeTruthy();
        expect(result.payment.updatedBy.date, 'payment.updatedBy.date exists').toBeTruthy();
      },
    },

    // ─── Real PayPal sandbox fixtures ───

    {
      name: 'fixture-active-produces-valid-shape',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);

        expect(result.status, 'ACTIVE fixture → active').toBe('active');
        expect(result.payment.provider, 'Provider is paypal').toBe('paypal');
        expect(result.payment.resourceId, 'Resource ID from fixture').toBe('I-MTPRX0B9LV4R');
        expect(result.payment.orderId, 'orderId from custom_id').toBe('ord-sub-123');
        expect(result.expires.timestamp, 'expires.timestamp is string').toBeTypeOf('string');
        expect(result.expires.timestampUNIX, 'expires.timestampUNIX is number').toBeTypeOf('number');
        expect(result.trial.claimed, 'No trial in fixture').toBe(false);
        expect(result.cancellation.pending, 'Not cancelled').toBe(false);
      },
    },

    {
      name: 'fixture-cancelled-produces-valid-shape',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_CANCELLED);

        expect(result.status, 'CANCELLED fixture → cancelled').toBe('cancelled');
        expect(result.payment.resourceId, 'Resource ID from fixture').toBe('I-MTPRX0B9LV4R');
        expect(result.payment.orderId, 'orderId from custom_id').toBe('ord-sub-123');
        expect(result.cancellation.pending, 'Already cancelled').toBe(false);
      },
    },

    {
      name: 'fixture-suspended-produces-valid-shape',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_SUSPENDED);

        expect(result.status, 'SUSPENDED fixture → suspended').toBe('suspended');
        expect(result.payment.resourceId, 'Resource ID from fixture').toBe('I-MTPRX0B9LV4R');
        expect(result.cancellation.pending, 'Not cancelled, just suspended').toBe(false);
      },
    },

    {
      name: 'fixture-all-produce-valid-unified-keys',
      async run({ expect }) {
        const fixtures = [FIXTURE_ACTIVE, FIXTURE_CANCELLED, FIXTURE_SUSPENDED];
        const expectedKeys = ['cancellation', 'expires', 'payment', 'product', 'status', 'trial'];

        for (let i = 0; i < fixtures.length; i++) {
          const result = toUnifiedSubscription(fixtures[i]);
          const keys = Object.keys(result).sort();
          expect(keys, `Fixture ${i} should have correct top-level keys`).toEqual(expectedKeys);
          expect(result.payment.updatedBy.date.timestamp, `Fixture ${i}: updatedBy.date.timestamp is string`).toBeTypeOf('string');
          expect(result.payment.updatedBy.date.timestampUNIX, `Fixture ${i}: updatedBy.date.timestampUNIX is number`).toBeTypeOf('number');
        }
      },
    },
  ],
});
