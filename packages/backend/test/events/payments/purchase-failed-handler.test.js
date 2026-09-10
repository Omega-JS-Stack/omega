/**
 * Test: the one-time purchase-failed handler tells the customer their payment
 * failed ([#673](https://github.com/Omega-JS-Stack/omega/issues/673)).
 *
 * The transition IS reachable, which is what decided this: a Stripe
 * `invoice.payment_failed` whose `billing_reason` is not a subscription one
 * parses as category `one-time` (routes/payments/webhook/providers/stripe.js),
 * and `detectOneTimeTransition()` maps that event to `purchase-failed`. The
 * population behind it is a MANUAL invoice that failed — nobody is standing at a
 * checkout watching it, which is the reason its subscription cousin
 * `checkout-declined` deliberately sends nothing — so the failure only reaches
 * the customer if this handler tells them.
 *
 * Called directly, and the email library is RECORDED rather than run, for the
 * same reasons its purchase-refunded twin is.
 *
 * Run: npx omega test backend:events/payments/purchase-failed-handler
 */
const handler = require('../../../dist/manager/events/firestore/payments-webhooks/transitions/one-time/purchase-failed.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const ORDER_ID = '5544-3322-1100';

function context(logs, sent) {
  return {
    before: null,
    after: { product: { id: 'credits-100', name: '100 Credits' }, status: 'failed' },
    order: { id: ORDER_ID, type: 'one-time', unified: { product: { id: 'credits-100' }, payment: { price: 9.99 } } },
    uid: '_test-purchase-failed-uid',
    userDoc: { auth: { uid: '_test-purchase-failed-uid', email: 'buyer@test.dev' } },
    ctx: {
      log: (line) => logs.push(line),
      error: (line) => logs.push(line),
      Manager: {
        config: { brand: { name: 'Test Brand' } },
        Email: () => ({ send: async (payload) => { sent.push(payload); return { status: 'sent' }; } }),
      },
    },
  };
}

module.exports = defineCases({
  description: 'One-time purchase-failed handler',
  type: 'group',

  tests: [
    {
      name: 'records-the-order-that-failed',
      async run({ assert }) {
        const logs = [];

        await handler(context(logs, []));

        const line = logs.find((entry) => entry.includes('one-time/purchase-failed'));

        assert.ok(line, `The handler should log the transition, got: ${logs.join(' | ')}`);
        assert.match(line, new RegExp(`orderId=${ORDER_ID}`), 'The line should name the order that failed');
      },
    },

    {
      name: 'sends-the-failed-payment-email-the-subscription-twin-sends',
      async run({ assert }) {
        const sent = [];

        await handler(context([], sent));

        assert.equal(sent.length, 1, `A failed purchase owes the customer exactly one email, got ${sent.length}`);

        const email = sent[0];

        assert.equal(email.template, 'order', 'It rides the one order template, like every other transition');
        assert.deepEqual(email.categories, ['order/payment-failed'], 'Filed under the same category the subscription failure is');
        assert.equal(email.data.content.event, 'payment-failed', 'The order template renders the payment-failed variant off this event');
        assert.match(email.subject, new RegExp(ORDER_ID), 'The subject should name the order that failed');
        assert.equal(email.data.content.id, ORDER_ID, 'The order rides the payload, so the mail can quote what was being bought');
      },
    },
  ],
});
