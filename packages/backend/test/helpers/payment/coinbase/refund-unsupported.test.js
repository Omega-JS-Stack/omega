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
const { oneTimeRefundRefusal } = require('../../../../dist/manager/libraries/payment/refund-policy.js');
const refundProvider = require('../../../../dist/manager/routes/payments/refund/providers/coinbase.js');
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
      async run({ assert }) {
        const refusal = oneTimeRefundRefusal(order('coinbase'));

        assert.ok(refusal, 'A crypto purchase is not refundable');
        assert.equal(refusal.reason, 'provider-cannot-refund', 'The refusal names WHY, machine-readably');
        assert.match(refusal.message, /crypto/i, 'And says so in words a buyer can read');
      },
    },

    {
      name: 'the-account-page-therefore-offers-no-button',
      async run({ assert }) {
        // GET /user/orders answers `refundable: !oneTimeRefundRefusal(order)`,
        // so this one predicate is what keeps the button and the route agreeing
        assert.equal(!oneTimeRefundRefusal(order('coinbase')), false, 'refundable === false for a crypto order');
      },
    },

    {
      name: 'the-refusal-comes-from-the-provider-not-the-order-state',
      async run({ assert }) {
        // The very same order on a provider that CAN refund passes every guard
        assert.equal(oneTimeRefundRefusal(order('stripe')), null, 'A card purchase is still refundable');
        assert.equal(oneTimeRefundRefusal(order('paypal')), null);
        assert.equal(oneTimeRefundRefusal(order('chargebee')), null);
      },
    },

    {
      name: 'a-crypto-order-that-names-its-provider-only-in-unified-is-refused-too',
      async run({ assert }) {
        // The predicate reads the same fallback chain the route does
        const refusal = oneTimeRefundRefusal(order(undefined, {
          provider: null,
          unified: {
            product: { id: 'launch-kit', name: 'Starter Library' },
            status: 'completed',
            payment: { provider: 'coinbase', orderId: '_test-order-refundability', resourceId: '8f783fa6', price: 49.99 },
          },
        }));

        assert.ok(refusal, 'The order is still a crypto order');
        assert.equal(refusal.reason, 'provider-cannot-refund');
      },
    },

    {
      name: 'the-earlier-refusals-still-win',
      async run({ assert }) {
        // Order matters: an already-refunded or never-completed crypto purchase
        // must keep saying the more specific thing about itself
        assert.equal(
          oneTimeRefundRefusal(order('coinbase', { type: 'subscription' })).reason, 'not-one-time',
        );
        assert.equal(
          oneTimeRefundRefusal(order('coinbase', {
            unified: { product: { id: 'launch-kit' }, status: 'pending', payment: { provider: 'coinbase' } },
          })).reason, 'not-completed',
        );
      },
    },

    {
      name: 'the-provider-module-exists-so-the-route-never-says-unknown-provider',
      async run({ assert }) {
        assert.equal(typeof refundProvider.processRefund, 'function', 'The subscription half is exported');
        assert.equal(typeof refundProvider.processOneTimeRefund, 'function', 'And the one-time half');
      },
    },

    {
      name: 'and-both-halves-refuse-rather-than-report-a-refund-that-never-happened',
      async run({ assert }) {
        for (const fn of ['processRefund', 'processOneTimeRefund']) {
          let threw = false;

          try {
            await refundProvider[fn]({ resourceId: 'ch_x', uid: 'u1', order: order('coinbase'), ctx: { log() {} } });
          } catch (e) {
            threw = true;
            assert.match(e.message, /no refund API/i, `${fn}() says what is missing`);
          }

          assert.ok(threw, `${fn}() must throw`);
        }
      },
    },
  ],
});
