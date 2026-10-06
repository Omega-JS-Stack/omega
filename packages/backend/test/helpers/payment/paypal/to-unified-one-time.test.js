/**
 * Test: PayPal toUnifiedOneTime()
 * Unit tests for the PayPal library's raw resource → unified one-time payment transformation
 *
 * Tests the pure function directly — no emulator, no Firestore, no HTTP
 * Mirrors stripe/to-unified-one-time.js for consistent coverage
 */
const PayPal = require('../../../../dist/omega/libraries/payment/providers/paypal.js');

// Real PayPal sandbox fixtures
const FIXTURE_ORDER_APPROVED = require('../../../fixtures/paypal/order-approved.json');
const FIXTURE_ORDER_COMPLETED = require('../../../fixtures/paypal/order-completed.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

// Mock config matching the @omega.js/backend template (new flat price structure)
const MOCK_CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription', limits: { requests: 100 } },
      {
        id: 'credits-100', name: '100 Credits', type: 'one-time',
        prices: { once: 9.99 },
        paypal: { productId: 'PROD-credits-100' },
      },
      {
        id: 'credits-500', name: '500 Credits', type: 'one-time',
        prices: { once: 39.99 },
        paypal: { productId: 'PROD-credits-500' },
      },
    ],
  },
};

function toUnifiedOneTime(rawResource, options) {
  return PayPal.toUnifiedOneTime(rawResource, { config: MOCK_CONFIG, ...options });
}

module.exports = defineCases({
  description: 'PayPal toUnifiedOneTime() transformation',
  type: 'group',

  tests: [
    // ─── Status mapping ───

    {
      name: 'status-completed',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'COMPLETED' });
        expect(result.status, 'PayPal COMPLETED → unified completed').toBe('completed');
      },
    },

    {
      name: 'status-created-lowercased',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'CREATED' });
        expect(result.status, 'PayPal CREATED → lowercase created').toBe('created');
      },
    },

    {
      name: 'status-approved-lowercased',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'APPROVED' });
        expect(result.status, 'PayPal APPROVED → lowercase approved').toBe('approved');
      },
    },

    {
      name: 'status-voided-lowercased',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'VOIDED' });
        expect(result.status, 'PayPal VOIDED → lowercase voided').toBe('voided');
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
      name: 'product-resolves-from-custom-id-product-id',
      async run({ expect }) {
        const result = toUnifiedOneTime({ custom_id: 'uid:user1,orderId:ord1,productId:credits-100' });
        expect(result.product.id, 'Should resolve from custom_id productId').toBe('credits-100');
        expect(result.product.name, 'Should have correct name').toBe('100 Credits');
      },
    },

    {
      name: 'product-resolves-second-product',
      async run({ expect }) {
        const result = toUnifiedOneTime({ custom_id: 'uid:user1,productId:credits-500' });
        expect(result.product.id, 'Should resolve credits-500').toBe('credits-500');
        expect(result.product.name, 'Should have correct name').toBe('500 Credits');
      },
    },

    {
      name: 'product-resolves-from-purchase-units-structured',
      async run({ expect }) {
        const result = toUnifiedOneTime({
          purchase_units: [{ custom_id: 'uid:user1,orderId:ord1,productId:credits-100' }],
        });
        expect(result.product.id, 'Should resolve from purchase_units structured custom_id').toBe('credits-100');
        expect(result.product.name, 'Should have correct name').toBe('100 Credits');
      },
    },

    {
      name: 'product-purchase-units-takes-priority-over-top-level',
      async run({ expect }) {
        const result = toUnifiedOneTime({
          custom_id: 'productId:credits-500',
          purchase_units: [{ custom_id: 'uid:user1,productId:credits-100' }],
        });
        expect(result.product.id, 'purchase_units custom_id takes priority over top-level').toBe('credits-100');
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
        const result = toUnifiedOneTime({ custom_id: 'productId:nonexistent-product' });
        expect(result.product.id, 'Unknown product → uses ID as-is').toBe('nonexistent-product');
        expect(result.product.name, 'Unknown product → ID as name').toBe('nonexistent-product');
      },
    },

    {
      name: 'product-without-config',
      async run({ expect }) {
        const result = PayPal.toUnifiedOneTime({ custom_id: 'productId:credits-100' }, {});
        expect(result.product.id, 'Without config → uses productId').toBe('credits-100');
        expect(result.product.name, 'Without config → Unknown name').toBe('Unknown');
      },
    },

    // ─── Payment metadata ───

    {
      name: 'payment-provider-always-paypal',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.provider, 'Provider should always be paypal').toBe('paypal');
      },
    },

    {
      name: 'payment-resource-id-from-resource-id',
      async run({ expect }) {
        const result = toUnifiedOneTime({ id: 'PAYID-ABC123' });
        expect(result.payment.resourceId, 'resourceId should be PayPal resource ID').toBe('PAYID-ABC123');
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
      name: 'payment-order-id-from-custom-id',
      async run({ expect }) {
        const result = toUnifiedOneTime({ custom_id: 'uid:user1,orderId:1234-5678-9012' });
        expect(result.payment.orderId, 'orderId should come from custom_id').toBe('1234-5678-9012');
      },
    },

    {
      name: 'payment-order-id-null-when-missing',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.orderId, 'Missing custom_id → null orderId').toBe(null);
      },
    },

    {
      name: 'payment-price-resolves-from-config',
      async run({ expect }) {
        const result = toUnifiedOneTime({ custom_id: 'productId:credits-100' });
        expect(result.payment.price, 'Should resolve price from config').toBe(9.99);
      },
    },

    {
      name: 'payment-price-zero-on-unknown-product',
      async run({ expect }) {
        const result = toUnifiedOneTime({ custom_id: 'productId:nonexistent' });
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
        const result = toUnifiedOneTime({}, { eventName: 'CHECKOUT.ORDER.APPROVED', eventId: 'WH-123' });
        expect(result.payment.updatedBy.event.name, 'Event name passed through').toBe('CHECKOUT.ORDER.APPROVED');
        expect(result.payment.updatedBy.event.id, 'Event ID passed through').toBe('WH-123');
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
      name: 'full-completed-shape',
      async run({ expect }) {
        const result = toUnifiedOneTime({
          id: 'PAYID-FULL',
          status: 'COMPLETED',
          custom_id: 'uid:user1,orderId:1234-5678-9012,productId:credits-100',
        }, { eventName: 'CHECKOUT.ORDER.APPROVED', eventId: 'WH-FULL' });

        expect(result.product, 'Should have product').toBeTruthy();
        expect(result.status, 'Should have status').toBeTruthy();
        expect(result.payment, 'Should have payment').toBeTruthy();

        expect(result.product.id, 'Product should be credits-100').toBe('credits-100');
        expect(result.status, 'Status should be completed').toBe('completed');
        expect(result.payment.provider, 'Provider should be paypal').toBe('paypal');
        expect(result.payment.resourceId, 'Resource ID should match').toBe('PAYID-FULL');
        expect(result.payment.orderId, 'orderId should match').toBe('1234-5678-9012');
        expect(result.payment.price, 'Price should be resolved').toBe(9.99);
        expect(result.payment.updatedBy.event.name, 'Event name should match').toBe('CHECKOUT.ORDER.APPROVED');
      },
    },

    {
      name: 'empty-input-gets-safe-defaults',
      async run({ expect }) {
        const result = toUnifiedOneTime({});

        expect(result.product.id, 'Empty → unknown product').toBe('unknown');
        expect(result.status, 'Empty → unknown status').toBe('unknown');
        expect(result.payment.provider, 'Empty → still paypal').toBe('paypal');
        expect(result.payment.orderId, 'Empty → null orderId').toBe(null);
        expect(result.payment.resourceId, 'Empty → null resourceId').toBe(null);
        expect(result.payment.price, 'Empty → price 0').toBe(0);
      },
    },

    {
      name: 'no-expires-or-trial-on-one-time',
      async run({ expect }) {
        const result = toUnifiedOneTime({ id: 'PAYID-SHAPE' });
        // One-time payments do not have subscription-specific fields
        expect(result.expires, 'No expires on one-time').toBe(undefined);
        expect(result.trial, 'No trial on one-time').toBe(undefined);
        expect(result.cancellation, 'No cancellation on one-time').toBe(undefined);
      },
    },

    // ─── Custom ID parsing edge cases ───

    {
      name: 'custom-id-with-colon-in-values',
      async run({ expect }) {
        const result = toUnifiedOneTime({
          custom_id: 'uid:firebase:auth:user123,orderId:ord-c,productId:credits-100',
        });
        expect(result.payment.orderId, 'orderId parsed correctly').toBe('ord-c');
        expect(result.product.id, 'productId parsed correctly').toBe('credits-100');
      },
    },

    {
      name: 'custom-id-product-id-only',
      async run({ expect }) {
        const result = toUnifiedOneTime({
          custom_id: 'productId:credits-500',
        });
        expect(result.product.id, 'Should parse productId without uid/orderId').toBe('credits-500');
        expect(result.payment.orderId, 'No orderId → null').toBe(null);
      },
    },

    {
      name: 'custom-id-empty-string',
      async run({ expect }) {
        const result = toUnifiedOneTime({ custom_id: '' });
        expect(result.product.id, 'Empty custom_id → unknown product').toBe('unknown');
        expect(result.payment.orderId, 'Empty custom_id → null orderId').toBe(null);
      },
    },

    // ─── updatedBy.date shape ───

    {
      name: 'updated-by-date-has-both-formats',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.updatedBy.date, 'Should have updatedBy.date').toBeTruthy();
        expect(result.payment.updatedBy.date.timestamp, 'timestamp should be string').toBeTypeOf('string');
        expect(result.payment.updatedBy.date.timestampUNIX, 'timestampUNIX should be number').toBeTypeOf('number');
      },
    },

    // ─── Real PayPal sandbox fixtures ───

    {
      name: 'fixture-order-completed-produces-valid-shape',
      async run({ expect }) {
        const result = toUnifiedOneTime(FIXTURE_ORDER_COMPLETED);

        expect(result.status, 'COMPLETED fixture → completed').toBe('completed');
        expect(result.payment.provider, 'Provider is paypal').toBe('paypal');
        expect(result.payment.resourceId, 'Resource ID from fixture').toBe('5UX02069M9686893E');
        expect(result.payment.orderId, 'orderId from purchase_units custom_id').toBe('ord-test-456');
        expect(result.product.id, 'Product resolved from purchase_units custom_id').toBe('credits-100');
        expect(result.product.name, 'Product name from config').toBe('100 Credits');
        expect(result.payment.price, 'Price from config').toBe(9.99);
      },
    },

    {
      name: 'fixture-order-approved-produces-valid-shape',
      async run({ expect }) {
        const result = toUnifiedOneTime(FIXTURE_ORDER_APPROVED);

        expect(result.status, 'APPROVED fixture → approved').toBe('approved');
        expect(result.payment.resourceId, 'Resource ID from fixture').toBe('5UX02069M9686893E');
        expect(result.product.id, 'Product resolved from purchase_units custom_id').toBe('credits-100');
        expect(result.payment.orderId, 'orderId from purchase_units custom_id').toBe('ord-test-456');
      },
    },

    {
      name: 'fixture-all-orders-produce-valid-unified-keys',
      async run({ expect }) {
        const fixtures = [FIXTURE_ORDER_APPROVED, FIXTURE_ORDER_COMPLETED];

        for (let i = 0; i < fixtures.length; i++) {
          const result = toUnifiedOneTime(fixtures[i]);
          expect(result.product, `Fixture ${i}: should have product`).toBeTruthy();
          expect(result.status, `Fixture ${i}: should have status`).toBeTruthy();
          expect(result.payment, `Fixture ${i}: should have payment`).toBeTruthy();
          expect(result.payment.provider, `Fixture ${i}: provider is paypal`).toBe('paypal');
          expect(result.payment.updatedBy.date.timestamp, `Fixture ${i}: updatedBy.date.timestamp is string`).toBeTypeOf('string');
          expect(result.payment.updatedBy.date.timestampUNIX, `Fixture ${i}: updatedBy.date.timestampUNIX is number`).toBeTypeOf('number');
          // One-time payments should NOT have subscription fields
          expect(result.expires, `Fixture ${i}: no expires`).toBe(undefined);
          expect(result.trial, `Fixture ${i}: no trial`).toBe(undefined);
          expect(result.cancellation, `Fixture ${i}: no cancellation`).toBe(undefined);
        }
      },
    },
  ],
});
