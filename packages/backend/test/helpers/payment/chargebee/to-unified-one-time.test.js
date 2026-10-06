/**
 * Test: Chargebee toUnifiedOneTime()
 * Unit tests for the Chargebee library's invoice → unified one-time transformation
 */
const Chargebee = require('../../../../dist/omega/libraries/payment/providers/chargebee.js');

const FIXTURE_INVOICE = require('../../../fixtures/chargebee/invoice-one-time.json');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const MOCK_CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription' },
      {
        id: 'credits-100', name: '100 Credits', type: 'one-time',
        prices: { once: 9.99 },
      },
    ],
  },
};

function toUnifiedOneTime(rawResource, options) {
  return Chargebee.toUnifiedOneTime(rawResource, { config: MOCK_CONFIG, ...options });
}

module.exports = defineCases({
  description: 'Chargebee toUnifiedOneTime() transformation',
  type: 'group',

  tests: [
    {
      name: 'status-paid-to-completed',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'paid' });
        expect(result.status, 'paid → completed').toBe('completed');
      },
    },

    {
      name: 'status-not-paid-to-failed',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'not_paid' });
        expect(result.status, 'not_paid → failed').toBe('failed');
      },
    },

    {
      name: 'status-payment-due-to-failed',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'payment_due' });
        expect(result.status, 'payment_due → failed').toBe('failed');
      },
    },

    {
      name: 'status-unknown-passthrough',
      async run({ expect }) {
        const result = toUnifiedOneTime({ status: 'pending' });
        expect(result.status, 'Other statuses pass through').toBe('pending');
      },
    },

    {
      name: 'provider-always-chargebee',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.payment.provider, 'Provider should be chargebee').toBe('chargebee');
      },
    },

    {
      name: 'resource-id-from-invoice-id',
      async run({ expect }) {
        const result = toUnifiedOneTime({ id: 'inv_123' });
        expect(result.payment.resourceId, 'resourceId from invoice id').toBe('inv_123');
      },
    },

    {
      name: 'order-id-from-meta-data',
      async run({ expect }) {
        const result = toUnifiedOneTime({ meta_data: '{"orderId":"1234-5678-9012"}' });
        expect(result.payment.orderId, 'orderId from meta_data').toBe('1234-5678-9012');
      },
    },

    {
      name: 'order-id-from-cf-legacy',
      async run({ expect }) {
        const result = toUnifiedOneTime({ cf_clientorderid: 'legacy-order' });
        expect(result.payment.orderId, 'orderId from cf_clientorderid').toBe('legacy-order');
      },
    },

    {
      name: 'product-resolves-from-meta-data',
      async run({ expect }) {
        const result = toUnifiedOneTime({
          meta_data: '{"productId":"credits-100"}',
          status: 'paid',
        });
        expect(result.product.id, 'Product resolved from meta_data').toBe('credits-100');
        expect(result.product.name, 'Product name resolved').toBe('100 Credits');
      },
    },

    {
      name: 'product-unknown-when-no-meta-data',
      async run({ expect }) {
        const result = toUnifiedOneTime({});
        expect(result.product.id, 'No productId → unknown').toBe('unknown');
      },
    },

    {
      name: 'event-metadata-passed-through',
      async run({ expect }) {
        const result = toUnifiedOneTime({}, { eventName: 'invoice_generated', eventId: 'ev_inv' });
        expect(result.payment.updatedBy.event.name, 'Event name').toBe('invoice_generated');
        expect(result.payment.updatedBy.event.id, 'Event ID').toBe('ev_inv');
      },
    },

    {
      name: 'fixture-invoice-one-time',
      async run({ expect }) {
        const result = toUnifiedOneTime(FIXTURE_INVOICE);
        expect(result.status, 'Fixture paid → completed').toBe('completed');
        expect(result.payment.provider, 'Provider is chargebee').toBe('chargebee');
        expect(result.payment.resourceId, 'Resource ID matches fixture').toBe(FIXTURE_INVOICE.id);
        expect(result.payment.orderId, 'Order ID from meta_data').toBe('6789-0123-4567');
        expect(result.product.id, 'Product from meta_data productId').toBe('credits-100');
      },
    },

    {
      name: 'unified-shape-complete',
      async run({ expect }) {
        const result = toUnifiedOneTime(FIXTURE_INVOICE);
        expect(result.product, 'Should have product').toBeTruthy();
        expect(result.status, 'Should have status').toBeTruthy();
        expect(result.payment, 'Should have payment').toBeTruthy();
        expect(result.payment.updatedBy, 'Should have updatedBy').toBeTruthy();
        expect(result.payment.updatedBy.date, 'Should have updatedBy.date').toBeTruthy();
      },
    },
  ],
});
