/**
 * Test: Stripe toUnifiedOneTime()
 * Unit tests for the Stripe library's raw resource → unified one-time payment transformation
 *
 * Tests the pure function directly — no emulator, no Firestore, no HTTP
 */
const Stripe = require('../../../../dist/omega/libraries/payment/providers/stripe.js');

// Real Stripe CLI fixtures (generated via `stripe trigger`)
const FIXTURE_SESSION = require('../../../fixtures/stripe/checkout-session-completed.json');
const FIXTURE_INVOICE_FAILED = require('../../../fixtures/stripe/invoice-payment-failed.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

// Mock config matching the @omega.js/backend template (new flat price structure)
const MOCK_CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { requests: 100 } },
      {
        id: 'credits-100', name: '100 Credits', type: 'one-time',
        prices: { once: 9.99 },
        stripe: { productId: 'prod_credits_100' },
      },
      {
        id: 'credits-500', name: '500 Credits', type: 'one-time',
        prices: { once: 39.99 },
        stripe: { productId: 'prod_credits_500' },
      },
    ],
  },
};

function toUnifiedOneTime(rawResource, options) {
  return Stripe.toUnifiedOneTime(rawResource, { config: MOCK_CONFIG, ...options });
}

module.exports = defineCases({
  description: 'Stripe toUnifiedOneTime() transformation',
  type: 'group',

  tests: [
    // ─── Status passthrough ───

    {
      name: 'status-complete',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'complete' });
        expect(result.status, 'Stripe complete → unified completed').toBe('completed');
      },
    },

    {
      name: 'status-open',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'open' });
        expect(result.status, 'Status passes through as-is').toBe('open');
      },
    },

    {
      name: 'status-unknown-when-missing',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.status, 'Missing status → unknown').toBe('unknown');
      },
    },

    // ─── Product resolution ───

    {
      name: 'product-resolves-from-metadata-product-id',
      async run({ expect }) {
        const result = toUnifiedOneTime({ metadata: { productId: 'credits-100' } });
        expect(result.product.id, 'Should resolve from metadata.productId').toBe('credits-100');
        expect(result.product.name, 'Should have correct name').toBe('100 Credits');
      },
    },

    {
      name: 'product-resolves-second-product',
      async run({ expect }) {
        const result = toUnifiedOneTime({ metadata: { productId: 'credits-500' } });
        expect(result.product.id, 'Should resolve credits-500').toBe('credits-500');
        expect(result.product.name, 'Should have correct name').toBe('500 Credits');
      },
    },

    {
      name: 'product-falls-back-to-unknown-on-missing-metadata',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.product.id, 'No metadata → unknown').toBe('unknown');
        expect(result.product.name, 'No metadata → Unknown name').toBe('Unknown');
      },
    },

    {
      name: 'product-falls-back-to-product-id-on-unknown-product',
      async run({ expect }) {
        const result = toUnifiedOneTime({ metadata: { productId: 'nonexistent-product' } });
        expect(result.product.id, 'Unknown product → uses ID as-is').toBe('nonexistent-product');
      },
    },

    {
      name: 'product-without-config',
      async run({ expect }) {
        const result = Stripe.toUnifiedOneTime({ metadata: { productId: 'credits-100' } }, {});
        expect(result.product.id, 'Without config → uses metadata ID').toBe('credits-100');
        // resolveProductOneTime returns { name: 'Unknown' } when config has no products array
        expect(result.product.name, 'Without config → Unknown name').toBe('Unknown');
      },
    },

    // ─── Payment metadata ───

    {
      name: 'payment-provider-always-stripe',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.provider, 'Provider should always be stripe').toBe('stripe');
      },
    },

    {
      name: 'payment-resource-id-from-session-id',
      async run({ expect }) {
        const result = toUnifiedOneTime({ id: 'cs_test_abc123' });
        expect(result.payment.resourceId, 'resourceId should be session/invoice ID').toBe('cs_test_abc123');
      },
    },

    {
      name: 'payment-resource-id-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.resourceId, 'Missing ID → null resourceId').toBe(null);
      },
    },

    {
      name: 'payment-order-id-from-metadata',
      async run({ expect }) {
        const result = toUnifiedOneTime({ metadata: { orderId: '1234-5678-9012' } });
        expect(result.payment.orderId, 'orderId should come from metadata').toBe('1234-5678-9012');
      },
    },

    {
      name: 'payment-order-id-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.orderId, 'Missing metadata → null orderId').toBe(null);
      },
    },

    {
      name: 'payment-price-resolves-from-config',
      async run({ expect }) {
        const result = toUnifiedOneTime({ metadata: { productId: 'credits-100' } });
        expect(result.payment.price, 'Should resolve price from config').toBe(9.99);
      },
    },

    {
      name: 'payment-price-zero-on-unknown-product',
      async run({ expect }) {
        const result = toUnifiedOneTime({ metadata: { productId: 'nonexistent' } });
        expect(result.payment.price, 'Unknown product → price 0').toBe(0);
      },
    },

    {
      name: 'payment-price-zero-when-no-metadata',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.price, 'No metadata → price 0').toBe(0);
      },
    },

    {
      name: 'payment-event-metadata-passed-through',
      async run({ expect }) {
        const result = toUnifiedOneTime({}, { eventName: 'checkout.session.completed', eventId: 'evt_123' });
        expect(result.payment.updatedBy.event.name, 'Event name passed through').toBe('checkout.session.completed');
        expect(result.payment.updatedBy.event.id, 'Event ID passed through').toBe('evt_123');
      },
    },

    {
      name: 'payment-event-metadata-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.updatedBy.event.name, 'Missing event name → null').toBe(null);
        expect(result.payment.updatedBy.event.id, 'Missing event ID → null').toBe(null);
      },
    },

    // ─── Full unified shape ───

    {
      name: 'full-session-shape',
      async run({ expect }) {
        const result = toUnifiedOneTime({
          id: 'cs_test_full',
          status: 'complete',
          metadata: { orderId: '1234-5678-9012', productId: 'credits-100' },
        }, { eventName: 'checkout.session.completed', eventId: 'evt_full' });

        expect(result.product, 'Should have product').toBeTruthy();
        expect(result.status, 'Should have status').toBeTruthy();
        expect(result.payment, 'Should have payment').toBeTruthy();

        expect(result.product.id, 'Product should be credits-100').toBe('credits-100');
        expect(result.status, 'Status should be completed').toBe('completed');
        expect(result.payment.provider, 'Provider should be stripe').toBe('stripe');
        expect(result.payment.resourceId, 'Resource ID should match').toBe('cs_test_full');
        expect(result.payment.orderId, 'orderId should match').toBe('1234-5678-9012');
        expect(result.payment.price, 'Price should be resolved').toBe(9.99);
        expect(result.payment.updatedBy.event.name, 'Event name should match').toBe('checkout.session.completed');
      },
    },

    {
      name: 'empty-input-gets-safe-defaults',
      async run({ expect }) {
        const result = toUnifiedOneTime({});

        expect(result.product.id, 'Empty → unknown product').toBe('unknown');
        expect(result.status, 'Empty → unknown status').toBe('unknown');
        expect(result.payment.provider, 'Empty → still stripe').toBe('stripe');
        expect(result.payment.orderId, 'Empty → null orderId').toBe(null);
        expect(result.payment.resourceId, 'Empty → null resourceId').toBe(null);
        expect(result.payment.price, 'Empty → price 0').toBe(0);
      },
    },

    {
      name: 'no-expires-or-trial-on-one-time',
      async run({ expect }) {
        const result = toUnifiedOneTime({ id: 'cs_test_shape' });
        // One-time payments do not have subscription-specific fields
        expect(result.expires, 'No expires on one-time').toBe(undefined);
        expect(result.trial, 'No trial on one-time').toBe(undefined);
        expect(result.cancellation, 'No cancellation on one-time').toBe(undefined);
      },
    },

    // ─── Real Stripe fixtures ───

    {
      name: 'fixture-session-completed-shape',
      async run({ expect }) {
        const result = toUnifiedOneTime(FIXTURE_SESSION);

        expect(result.product, 'Should have product').toBeTruthy();
        expect(result.status, 'Real session fixture → completed').toBe('completed');
        expect(result.payment.provider, 'Provider is stripe').toBe('stripe');
        expect(result.payment.resourceId, 'resourceId matches fixture ID').toBe(FIXTURE_SESSION.id);
      },
    },

    {
      name: 'fixture-session-completed-no-subscription-fields',
      async run({ expect }) {
        const result = toUnifiedOneTime(FIXTURE_SESSION);
        expect(result.expires, 'Session fixture has no expires').toBe(undefined);
        expect(result.trial, 'Session fixture has no trial').toBe(undefined);
        expect(result.cancellation, 'Session fixture has no cancellation').toBe(undefined);
      },
    },

    {
      name: 'fixture-invoice-failed-shape',
      async run({ expect }) {
        const result = toUnifiedOneTime(FIXTURE_INVOICE_FAILED);

        expect(result.product, 'Should have product').toBeTruthy();
        expect(result.status, 'Failed invoice fixture → open').toBe('open');
        expect(result.payment.provider, 'Provider is stripe').toBe('stripe');
        expect(result.payment.resourceId, 'resourceId matches fixture ID').toBe(FIXTURE_INVOICE_FAILED.id);
      },
    },

    {
      name: 'fixture-all-have-unified-shape',
      async run({ expect }) {
        const fixtures = [FIXTURE_SESSION, FIXTURE_INVOICE_FAILED];
        const names = ['session-completed', 'invoice-failed'];

        for (let i = 0; i < fixtures.length; i++) {
          const result = toUnifiedOneTime(fixtures[i]);
          const label = names[i];

          expect(result.product, `${label}: should have product`).toBeTruthy();
          expect(result.product.id, `${label}: should have product.id`).toBeTruthy();
          expect(result.product.name, `${label}: should have product.name`).toBeTruthy();
          expect(result.status, `${label}: status should be string`).toBeTypeOf('string');
          expect(result.payment, `${label}: should have payment`).toBeTruthy();
          expect(result.payment.provider, `${label}: provider should be stripe`).toBe('stripe');
          expect(result.payment.updatedBy, `${label}: should have updatedBy`).toBeTruthy();
          expect(result.payment.updatedBy.date, `${label}: should have updatedBy.date`).toBeTruthy();
        }
      },
    },
  ],
});
