/**
 * Test: Chargebee toUnifiedSubscription()
 * Unit tests for the Chargebee library's raw subscription → unified subscription transformation
 *
 * Tests the pure function directly — no emulator, no Firestore, no HTTP
 */
const Chargebee = require('../../../../dist/omega/libraries/payment/providers/chargebee.js');

// Chargebee fixtures
const FIXTURE_ACTIVE = require('../../../fixtures/chargebee/subscription-active.json');
const FIXTURE_CANCELLED = require('../../../fixtures/chargebee/subscription-cancelled.json');
const FIXTURE_TRIAL = require('../../../fixtures/chargebee/subscription-in-trial.json');
const FIXTURE_NON_RENEWING = require('../../../fixtures/chargebee/subscription-non-renewing.json');
const FIXTURE_PAUSED = require('../../../fixtures/chargebee/subscription-paused.json');
const FIXTURE_LEGACY = require('../../../fixtures/chargebee/subscription-legacy-plan.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

// Mock config matching the @omega.js/backend template
const MOCK_CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { requests: 100 } },
      {
        id: 'pro', name: 'Pro', type: 'subscription',
        prices: { monthly: 4.99, annually: 49.99 },
        chargebee: {
          itemId: 'somiibo-pro',
          legacyPlanIds: ['somiibo-premium-monthly-1', 'somiibo-premium-annually-1'],
        },
      },
      {
        id: 'plus', name: 'Plus', type: 'subscription',
        prices: { monthly: 2.99, annually: 29.99 },
        chargebee: {
          itemId: 'somiibo-plus',
          legacyPlanIds: [],
        },
      },
    ],
  },
};

function toUnifiedSubscription(rawSubscription, options) {
  return Chargebee.toUnifiedSubscription(rawSubscription, { config: MOCK_CONFIG, ...options });
}

module.exports = defineCases({
  description: 'Chargebee toUnifiedSubscription() transformation',
  type: 'group',

  tests: [
    // ─── Status mapping ───

    {
      name: 'status-active',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'active' });
        expect(result.status, 'Chargebee active → unified active').toBe('active');
      },
    },

    {
      name: 'status-in-trial',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'in_trial', trial_start: 1000, trial_end: 2000 });
        expect(result.status, 'Chargebee in_trial → unified active').toBe('active');
      },
    },

    {
      name: 'status-non-renewing',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'non_renewing' });
        expect(result.status, 'Chargebee non_renewing → unified active').toBe('active');
      },
    },

    {
      name: 'status-future',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'future' });
        expect(result.status, 'Chargebee future → unified active').toBe('active');
      },
    },

    {
      name: 'status-paused',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'paused' });
        expect(result.status, 'Chargebee paused → unified suspended').toBe('suspended');
      },
    },

    {
      name: 'status-cancelled',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'cancelled' });
        expect(result.status, 'Chargebee cancelled → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-transferred',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'transferred' });
        expect(result.status, 'Chargebee transferred → unified cancelled').toBe('cancelled');
      },
    },

    {
      name: 'status-unknown-defaults-to-cancelled',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'some_future_status' });
        expect(result.status, 'Unknown status → cancelled').toBe('cancelled');
      },
    },

    // ─── Product resolution (Items model) ───

    {
      name: 'product-resolves-from-item-price-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'somiibo-pro-monthly' }],
        });
        expect(result.product.id, 'Should resolve to pro').toBe('pro');
        expect(result.product.name, 'Should have correct name').toBe('Pro');
      },
    },

    {
      name: 'product-resolves-plus-from-item-price-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'somiibo-plus-annually' }],
        });
        expect(result.product.id, 'Should resolve to plus').toBe('plus');
        expect(result.product.name, 'Should have correct name').toBe('Plus');
      },
    },

    // ─── Product resolution (Legacy Plans model) ───

    {
      name: 'product-resolves-from-legacy-plan-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          plan_id: 'somiibo-premium-monthly-1',
        });
        expect(result.product.id, 'Legacy plan → pro').toBe('pro');
        expect(result.product.name, 'Legacy plan → Pro name').toBe('Pro');
      },
    },

    {
      name: 'product-resolves-from-legacy-annual-plan-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          plan_id: 'somiibo-premium-annually-1',
        });
        expect(result.product.id, 'Legacy annual plan → pro').toBe('pro');
      },
    },

    {
      name: 'product-falls-back-to-basic-on-unknown',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'unknown-product-monthly' }],
        });
        expect(result.product.id, 'Unknown item → basic').toBe('basic');
      },
    },

    {
      name: 'product-falls-back-to-basic-on-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.product.id, 'No plan → basic').toBe('basic');
      },
    },

    {
      name: 'product-falls-back-to-basic-without-config',
      async run({ expect }) {
        const result = Chargebee.toUnifiedSubscription(
          { subscription_items: [{ item_price_id: 'somiibo-pro-monthly' }] },
          {},
        );
        expect(result.product.id, 'No config → basic').toBe('basic');
      },
    },

    // ─── Frequency resolution ───

    {
      name: 'frequency-monthly-from-item-price-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'somiibo-pro-monthly' }],
        });
        expect(result.payment.frequency, 'item_price_id suffix monthly → monthly').toBe('monthly');
      },
    },

    {
      name: 'frequency-annually-from-item-price-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'somiibo-pro-annually' }],
        });
        expect(result.payment.frequency, 'item_price_id suffix annually → annually').toBe('annually');
      },
    },

    {
      name: 'frequency-weekly-from-item-price-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'somiibo-pro-weekly' }],
        });
        expect(result.payment.frequency, 'item_price_id suffix weekly → weekly').toBe('weekly');
      },
    },

    {
      name: 'frequency-daily-from-item-price-id',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'somiibo-pro-daily' }],
        });
        expect(result.payment.frequency, 'item_price_id suffix daily → daily').toBe('daily');
      },
    },

    {
      name: 'frequency-from-legacy-billing-period-unit',
      async run({ expect }) {
        const result = toUnifiedSubscription({ billing_period_unit: 'month' });
        expect(result.payment.frequency, 'Legacy month → monthly').toBe('monthly');
      },
    },

    {
      name: 'frequency-year-from-legacy',
      async run({ expect }) {
        const result = toUnifiedSubscription({ billing_period_unit: 'year' });
        expect(result.payment.frequency, 'Legacy year → annually').toBe('annually');
      },
    },

    {
      name: 'frequency-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.frequency, 'Missing → null').toBe(null);
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

    // ─── Cancellation resolution ───

    {
      name: 'cancellation-pending-when-non-renewing',
      async run({ expect }) {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30;
        const result = toUnifiedSubscription({
          status: 'non_renewing',
          current_term_end: futureTimestamp,
        });
        expect(result.cancellation.pending, 'non_renewing → pending').toBe(true);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'cancellation-completed-when-cancelled',
      async run({ expect }) {
        const pastTimestamp = Math.floor(Date.now() / 1000) - 86400;
        const result = toUnifiedSubscription({
          status: 'cancelled',
          cancelled_at: pastTimestamp,
        });
        expect(result.cancellation.pending, 'cancelled → not pending').toBe(false);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'cancellation-none',
      async run({ expect }) {
        const result = toUnifiedSubscription({ status: 'active' });
        expect(result.cancellation.pending, 'No cancellation → not pending').toBe(false);
      },
    },

    // ─── Expiration and start date ───

    {
      name: 'expires-from-current-term-end',
      async run({ expect }) {
        const futureTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30;
        const result = toUnifiedSubscription({ current_term_end: futureTimestamp });
        expect(result.expires.timestampUNIX > 0, 'Should have expiration').toBeTruthy();
      },
    },

    {
      name: 'expires-defaults-to-epoch-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.expires.timestampUNIX, 'Missing current_term_end → epoch').toBe(0);
      },
    },

    {
      name: 'start-date-from-started-at',
      async run({ expect }) {
        const startTimestamp = Math.floor(Date.now() / 1000) - 86400 * 30;
        const result = toUnifiedSubscription({ started_at: startTimestamp });
        expect(result.payment.startDate.timestampUNIX > 0, 'Should have start date').toBeTruthy();
      },
    },

    {
      name: 'start-date-fallback-to-created-at',
      async run({ expect }) {
        const createTimestamp = Math.floor(Date.now() / 1000) - 86400 * 60;
        const result = toUnifiedSubscription({ created_at: createTimestamp });
        expect(result.payment.startDate.timestampUNIX > 0, 'Should use created_at as fallback').toBeTruthy();
      },
    },

    {
      name: 'start-date-defaults-to-epoch-when-missing',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.startDate.timestampUNIX, 'Missing start dates → epoch').toBe(0);
      },
    },

    // ─── Payment metadata ───

    {
      name: 'payment-provider-always-chargebee',
      async run({ expect }) {
        const result = toUnifiedSubscription({});
        expect(result.payment.provider, 'Provider should always be chargebee').toBe('chargebee');
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
      name: 'payment-order-id-from-meta-data',
      async run({ expect }) {
        const result = toUnifiedSubscription({ meta_data: '{"orderId":"1234-5678-9012"}' });
        expect(result.payment.orderId, 'orderId should come from meta_data').toBe('1234-5678-9012');
      },
    },

    {
      name: 'payment-order-id-from-cf-clientorderid-legacy',
      async run({ expect }) {
        const result = toUnifiedSubscription({ cf_clientorderid: '1678790168794-0784' });
        expect(result.payment.orderId, 'orderId should come from cf_clientorderid').toBe('1678790168794-0784');
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
        const result = toUnifiedSubscription({}, { eventName: 'subscription_created', eventId: 'ev_123' });
        expect(result.payment.updatedBy.event.name, 'Event name passed through').toBe('subscription_created');
        expect(result.payment.updatedBy.event.id, 'Event ID passed through').toBe('ev_123');
      },
    },

    // ─── UID extraction ───

    {
      name: 'uid-from-meta-data',
      async run({ expect }) {
        const resource = { meta_data: '{"uid":"test-user-123","orderId":"1234-5678-9012"}' };
        expect(Chargebee.getUid(resource), 'UID from meta_data').toBe('test-user-123');
      },
    },

    {
      name: 'uid-from-cf-uid-legacy',
      async run({ expect }) {
        const resource = { cf_uid: 'legacy-user-456' };
        expect(Chargebee.getUid(resource), 'UID from cf_uid').toBe('legacy-user-456');
      },
    },

    {
      name: 'uid-null-when-missing',
      async run({ expect }) {
        expect(Chargebee.getUid({}), 'No metadata → null').toBe(null);
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
          subscription_items: [{ item_price_id: 'somiibo-pro-monthly' }],
          current_term_end: now + 86400 * 30,
          started_at: now - 86400 * 60,
          meta_data: '{"uid":"full-test-uid","orderId":"9999-8888-7777"}',
        }, { eventName: 'subscription_changed', eventId: 'ev_full' });

        expect(result.product, 'Should have product').toBeTruthy();
        expect(result.status, 'Should have status').toBeTruthy();
        expect(result.expires, 'Should have expires').toBeTruthy();
        expect(result.trial, 'Should have trial').toBeTruthy();
        expect(result.cancellation, 'Should have cancellation').toBeTruthy();
        expect(result.payment, 'Should have payment').toBeTruthy();

        expect(result.product.id, 'Product should be pro').toBe('pro');
        expect(result.status, 'Status should be active').toBe('active');
        expect(result.trial.claimed, 'Trial should not be claimed').toBe(false);
        expect(result.cancellation.pending, 'Should not be pending cancellation').toBe(false);
        expect(result.payment.provider, 'Provider should be chargebee').toBe('chargebee');
        expect(result.payment.resourceId, 'Resource ID should match').toBe('sub_full_test');
        expect(result.payment.frequency, 'Frequency should be monthly').toBe('monthly');
        expect(result.payment.orderId, 'Order ID from meta_data').toBe('9999-8888-7777');
        expect(result.payment.updatedBy.event.name, 'Event name should match').toBe('subscription_changed');
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
        expect(result.payment.provider, 'Empty → still chargebee').toBe('chargebee');
        expect(result.payment.orderId, 'Empty → null orderId').toBe(null);
        expect(result.payment.resourceId, 'Empty → null resourceId').toBe(null);
        expect(result.payment.frequency, 'Empty → null frequency').toBe(null);
      },
    },

    // ─── Real fixtures ───

    {
      name: 'fixture-active-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);
        expect(result.status, 'Active fixture → active').toBe('active');
        expect(result.payment.provider, 'Provider is chargebee').toBe('chargebee');
        expect(result.payment.resourceId, 'resourceId matches fixture').toBe(FIXTURE_ACTIVE.id);
      },
    },

    {
      name: 'fixture-active-product-resolves',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);
        expect(result.product.id, 'somiibo-pro-monthly → pro').toBe('pro');
        expect(result.payment.frequency, 'Active fixture → monthly').toBe('monthly');
      },
    },

    {
      name: 'fixture-active-metadata',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_ACTIVE);
        expect(result.payment.orderId, 'Order ID from meta_data').toBe('1234-5678-9012');
      },
    },

    {
      name: 'fixture-cancelled-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_CANCELLED);
        expect(result.status, 'Cancelled fixture → cancelled').toBe('cancelled');
        expect(result.cancellation.pending, 'Not pending — already cancelled').toBe(false);
        expect(result.cancellation.date.timestampUNIX > 0, 'Should have cancellation date').toBeTruthy();
      },
    },

    {
      name: 'fixture-trial-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_TRIAL);
        expect(result.status, 'Trial fixture → active').toBe('active');
        expect(result.trial.claimed, 'Trial → claimed').toBe(true);
        expect(result.trial.expires.timestampUNIX > 0, 'Trial expiration should be set').toBeTruthy();
      },
    },

    {
      name: 'fixture-non-renewing-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_NON_RENEWING);
        expect(result.status, 'Non-renewing fixture → active').toBe('active');
        expect(result.cancellation.pending, 'Non-renewing → pending cancellation').toBe(true);
      },
    },

    {
      name: 'fixture-paused-status',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_PAUSED);
        expect(result.status, 'Paused fixture → suspended').toBe('suspended');
      },
    },

    {
      name: 'fixture-legacy-plan-resolves',
      async run({ expect }) {
        const result = toUnifiedSubscription(FIXTURE_LEGACY);
        expect(result.product.id, 'Legacy plan → pro via legacyPlanIds').toBe('pro');
        expect(result.payment.frequency, 'Legacy billing_period_unit month → monthly').toBe('monthly');
        expect(result.payment.orderId, 'Legacy cf_clientorderid → orderId').toBe('1678790168794-0784');
        expect(result.status, 'Legacy active → active').toBe('active');
      },
    },

    {
      name: 'fixture-all-have-unified-shape',
      async run({ expect }) {
        const fixtures = [FIXTURE_ACTIVE, FIXTURE_CANCELLED, FIXTURE_TRIAL, FIXTURE_NON_RENEWING, FIXTURE_PAUSED, FIXTURE_LEGACY];
        const names = ['active', 'cancelled', 'trial', 'non-renewing', 'paused', 'legacy'];

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
          expect(result.payment.provider, `${label}: provider should be chargebee`).toBe('chargebee');
          expect(result.payment.updatedBy, `${label}: should have updatedBy`).toBeTruthy();
          expect(result.payment.updatedBy.date, `${label}: should have updatedBy.date`).toBeTruthy();
        }
      },
    },

    // ─── Combination / edge-case scenarios ───

    {
      name: 'combo-trial-with-non-renewing',
      async run({ expect }) {
        const now = Math.floor(Date.now() / 1000);
        const result = toUnifiedSubscription({
          id: 'sub_trial_cancel',
          status: 'non_renewing',
          trial_start: now - 86400 * 3,
          trial_end: now + 86400 * 11,
          current_term_end: now + 86400 * 11,
          started_at: now - 86400 * 3,
          subscription_items: [{ item_price_id: 'somiibo-pro-monthly' }],
        });

        expect(result.status, 'Non-renewing + trial → still active').toBe('active');
        expect(result.trial.claimed, 'Trial should be claimed').toBe(true);
        expect(result.cancellation.pending, 'Cancel should be pending').toBe(true);
      },
    },

    {
      name: 'combo-meta-data-overrides-cf-fields',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          meta_data: '{"uid":"new-uid","orderId":"new-order"}',
          cf_clientorderid: 'old-order',
          cf_uid: 'old-uid',
        });

        expect(result.payment.orderId, 'meta_data orderId takes priority').toBe('new-order');
        expect(Chargebee.getUid({
          meta_data: '{"uid":"new-uid"}',
          cf_uid: 'old-uid',
        }), 'meta_data uid takes priority').toBe('new-uid');
      },
    },

    {
      name: 'combo-items-model-overrides-legacy-plan',
      async run({ expect }) {
        const result = toUnifiedSubscription({
          subscription_items: [{ item_price_id: 'somiibo-plus-monthly' }],
          plan_id: 'somiibo-premium-monthly-1',
          billing_period_unit: 'year',
        });

        expect(result.product.id, 'Items model product takes priority over legacy').toBe('plus');
        expect(result.payment.frequency, 'Items model frequency takes priority over legacy billing_period_unit').toBe('monthly');
      },
    },
  ],
});
