/**
 * Test: a crypto purchase cannot be refunded, and says so BEFORE the provider
 * ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 *
 * Coinbase Commerce has no refund API: returning crypto is a manual transfer the
 * merchant makes from the dashboard, and nothing about it is ever attached to
 * the charge. The refusal therefore has to live where the account page reads it
 * too — `libraries/payment/refund-policy.js`, the ONE predicate the refund route
 * enforces and `GET /user/orders` answers `refundable` from — or the Orders list
 * offers a Refund button that can only ever fail
 * ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
 *
 * The provider module still exists and still throws: a missing file would make
 * the route answer "Unknown provider", a different and wrong statement.
 *
 * Pure functions and a throwing stub — no emulator, no Firestore, no HTTP.
 *
 * Run: npx omega test backend:helpers/payment/coinbase/refund-unsupported
 */
const { oneTimeRefundRefusal } = require('../../../../dist/omega/libraries/payment/refund-policy.js');
const refundProvider = require('../../../../dist/omega/routes/payments/refund/providers/coinbase.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

/** A completed one-time order, the shape the webhook pipeline writes */
function order(provider, overrides) {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    id: '_test-order-refundability',
    type: 'one-time',
    owner: '_test-coinbase-buyer',
    productId: 'launch-kit',
    provider: provider,
    resourceId: '8f783fa6-eaa3-4460-af64-cac26b183ed1',
    unified: {
      product: { id: 'launch-kit', name: 'Starter Library' },
      status: 'completed',
      payment: { provider: provider, orderId: '_test-order-refundability', resourceId: '8f783fa6', price: 49.99 },
    },
    requests: { cancellation: null, refund: null },
    metadata: { created: { timestamp: new Date(nowUNIX * 1000).toISOString(), timestampUNIX: nowUNIX } },
    ...(overrides || {}),
  };
}

module.exports = defineCases({
  description: 'Coinbase Commerce refunds: the explicit unsupported path',
  type: 'group',

  tests: [
    {
      name: 'a-crypto-order-is-refused-by-the-shared-predicate',
      async run({ expect }) {
        const refusal = oneTimeRefundRefusal(order('coinbase'));

        expect(refusal, 'A crypto purchase is not refundable').toBeTruthy();
        expect(refusal.reason, 'The refusal names WHY, machine-readably').toBe('provider-cannot-refund');
        expect(refusal.message, 'And says so, naming the provider off its descriptor').toMatch(/Coinbase Commerce purchases cannot be refunded/);
      },
    },

    {
      name: 'the-account-page-therefore-offers-no-button',
      async run({ expect }) {
        // GET /user/orders answers `refundable: !oneTimeRefundRefusal(order)`,
        // so this one predicate is what keeps the button and the route agreeing
        expect(!oneTimeRefundRefusal(order('coinbase')), 'refundable === false for a crypto order').toBe(false);
      },
    },

    {
      name: 'the-refusal-comes-from-the-provider-not-the-order-state',
      async run({ expect }) {
        // The very same order on a provider that CAN refund passes every guard
        expect(oneTimeRefundRefusal(order('stripe')), 'A card purchase is still refundable').toBe(null);
        expect(oneTimeRefundRefusal(order('paypal'))).toBe(null);
        expect(oneTimeRefundRefusal(order('chargebee'))).toBe(null);
      },
    },

    {
      name: 'a-crypto-order-that-names-its-provider-only-in-unified-is-refused-too',
      async run({ expect }) {
        // The predicate reads the same fallback chain the route does
        const refusal = oneTimeRefundRefusal(order(undefined, {
          provider: null,
          unified: {
            product: { id: 'launch-kit', name: 'Starter Library' },
            status: 'completed',
            payment: { provider: 'coinbase', orderId: '_test-order-refundability', resourceId: '8f783fa6', price: 49.99 },
          },
        }));

        expect(refusal, 'The order is still a crypto order').toBeTruthy();
        expect(refusal.reason).toBe('provider-cannot-refund');
      },
    },

    {
      name: 'the-earlier-refusals-still-win',
      async run({ expect }) {
        // Order matters: an already-refunded or never-completed crypto purchase
        // must keep saying the more specific thing about itself
        expect(oneTimeRefundRefusal(order('coinbase', { type: 'subscription' })).reason).toBe('not-one-time');
        expect(oneTimeRefundRefusal(order('coinbase', {
            unified: { product: { id: 'launch-kit' }, status: 'pending', payment: { provider: 'coinbase' } },
          })).reason).toBe('not-completed');
      },
    },

    {
      name: 'the-provider-module-exists-so-the-route-never-says-unknown-provider',
      async run({ expect }) {
        expect(typeof refundProvider.processRefund, 'The subscription half is exported').toBe('function');
        expect(typeof refundProvider.processOneTimeRefund, 'And the one-time half').toBe('function');
      },
    },

    {
      name: 'and-both-halves-refuse-rather-than-report-a-refund-that-never-happened',
      async run({ expect }) {
        for (const fn of ['processRefund', 'processOneTimeRefund']) {
          let threw = false;

          try {
            await refundProvider[fn]({ resourceId: 'ch_x', uid: 'u1', order: order('coinbase'), ctx: { log() {} } });
          } catch (e) {
            threw = true;
            expect(e.message, `${fn}() says what is missing`).toMatch(/no refund API/i);
          }

          expect(threw, `${fn}() must throw`).toBeTruthy();
        }
      },
    },
  ],
});
