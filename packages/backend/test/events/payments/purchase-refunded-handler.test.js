/**
 * Test: the one-time purchase-refunded handler's record of the refund
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * No email template exists for a refunded one-time purchase, so the handler's log
 * line IS the operator's record of it. It used to name the order and nothing else:
 * on-write.js resolved the provider's refund details for the subscription
 * transition only, so how much came back was nowhere on the one-time path.
 *
 * The handler is called directly — the dispatch that calls it is fire-and-forget
 * and skipped in testing mode, so the emulator journey cannot see this line.
 *
 * Run: npx omega test backend:events/payments/purchase-refunded-handler
 */
const handler = require('../../../src/manager/events/firestore/payments-webhooks/transitions/one-time/purchase-refunded.js');

const ORDER_ID = '9090-8080-7070';

function context(logs) {
  return {
    before: null,
    after: { product: { id: 'credits-100', name: '100 Credits' }, status: 'refunded' },
    order: { id: ORDER_ID, type: 'one-time' },
    uid: '_test-purchase-refunded-uid',
    userDoc: {},
    ctx: { log: (line) => logs.push(line) },
    refundDetails: { amount: '9.99', currency: 'USD', reason: 'requested_by_customer' },
  };
}

module.exports = {
  description: 'One-time purchase-refunded handler',
  type: 'group',

  tests: [
    {
      name: 'records-the-amount-that-came-back',
      async run({ assert }) {
        const logs = [];

        await handler(context(logs));

        assert.equal(logs.length, 1, 'The handler should log exactly once');
        assert.match(logs[0], new RegExp(`orderId=${ORDER_ID}`), 'The line should name the order refunded');
        assert.match(logs[0], /amount=9\.99 USD/, 'The line should say how much came back');
        assert.match(logs[0], /reason=requested_by_customer/, 'The line should carry the provider reason');
        assert.match(logs[0], /product=credits-100/, 'The line should name what was refunded');
      },
    },

    {
      name: 'stays-readable-without-refund-details',
      async run({ assert }) {
        // A provider library with no getRefundDetails() leaves them null — the
        // record must still say which order was refunded
        const logs = [];
        const ctx = context(logs);
        ctx.refundDetails = null;

        await handler(ctx);

        assert.match(logs[0], new RegExp(`orderId=${ORDER_ID}`), 'The line should still name the order');
        assert.match(logs[0], /amount=unknown USD/, 'An unresolved amount should read as unknown, never as undefined');
      },
    },
  ],
};
