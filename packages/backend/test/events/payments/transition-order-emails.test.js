/**
 * Test: every payments transition that owes the customer an email actually sends
 * one, and it names what they bought
 * ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)).
 *
 * Until the mailer grew its testing-mode capture there was no way to assert this
 * offline: the webhook pipeline gates its whole handler dispatch on
 * `ctx.isTesting()` (`shouldRunHandlers` in on-write.js — a coarse gate that also
 * covers payment analytics and the marketing sync, so it is NOT the email seam and
 * stays), and the webhook suites could only count the `handler skipped (testing
 * mode)` log line. The product name a receipt exists to state
 * ([#668](https://github.com/Omega-JS-Stack/omega/issues/668)) was proved by
 * nothing.
 *
 * So the transition is driven the way the framework already drives one in a test:
 * the handler module is called DIRECTLY, exactly as
 * `purchase-failed-handler.test.js` and `transition-promo-lines.test.js` do. What
 * changes here is that the email door is NOT swapped — the REAL `Manager.Email()`
 * runs, through the real brand, the real template data and the real MJML render,
 * and the capture is what the assertions read.
 *
 * Plain-node (no emulator, no network): an order email addresses a user DOCUMENT,
 * so the send resolves no uid against Firestore and touches nothing but the store.
 *
 * Run: npx omega test framework:events/payments/transition-order-emails
 */
const assert = require('node:assert');
const newSubscription = require('../../../dist/manager/events/firestore/payments-webhooks/transitions/subscription/new-subscription.js');
const purchaseCompleted = require('../../../dist/manager/events/firestore/payments-webhooks/transitions/one-time/purchase-completed.js');
const checkoutDeclined = require('../../../dist/manager/events/firestore/payments-webhooks/transitions/subscription/checkout-declined.js');
const capture = require('../../../dist/test/utils/email-capture.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-transition-order-emails';
const USER_DOC = {
  auth: { uid: UID, email: `${UID}@test.dev` },
  personal: { name: { first: 'Ordell' } },
};

/**
 * The handlers dispatch their send fire-and-forget (on-write.js never awaits one),
 * so a test waits for the record the same way the pipeline's own caller would see
 * it land — by looking.
 *
 * @param {object} Manager - The booted Manager whose project owns the store
 * @param {number} count - How many records to wait for
 * @returns {Promise<object[]>} The records, once there are `count` of them
 */
async function waitForCaptured(Manager, count) {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const records = capture.readCaptured(Manager);

    if (records.length >= count) {
      return records;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for ${count} captured email(s); got ${capture.readCaptured(Manager).length}`);
}

module.exports = defineCases({
  description: 'Payment transitions send the order email their customer is owed (#774)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-new-subscription-emails-the-receipt-that-names-the-plan',

      async run({ Manager, ctx }) {
        capture.clearCaptured(Manager);

        const after = {
          product: { id: 'premium', name: 'Premium' },
          payment: { price: 4.99, frequency: 'monthly', provider: 'test' },
          status: 'active',
        };

        await newSubscription({
          before: { product: { id: 'basic', name: 'Basic' }, status: 'active' },
          after,
          order: {
            id: '_test-order-subscription',
            type: 'subscription',
            unified: after,
            discount: null,
          },
          uid: UID,
          userDoc: USER_DOC,
          ctx,
        });

        const [record] = await waitForCaptured(Manager, 1);
        const brandName = Manager.config.brand.name;

        assert.deepEqual(record.to, [USER_DOC.auth.email], 'the receipt goes to the subscriber');
        assert.equal(record.template, 'order', 'on the order template');
        assert.match(record.subject, /Premium order #_test-order-subscription/, `the subject names the plan and the order, got: ${record.subject}`);

        // The one thing a receipt exists to state (#668), and the line that tells a
        // subscription apart from a one-time buy.
        assert.match(record.summary, new RegExp(`${brandName} Premium`), `the summary names the product, got: ${record.summary}`);
        assert.match(record.summary, /Billed monthly/, `and how it bills, got: ${record.summary}`);
        assert.match(record.summary, /Total paid today \$4\.99/, `and what was charged, got: ${record.summary}`);

        capture.clearCaptured(Manager);
      },
    },

    {
      name: 'a-one-time-purchase-emails-the-receipt-that-names-the-product',

      async run({ Manager, ctx }) {
        capture.clearCaptured(Manager);

        const after = {
          product: { id: 'credits-100', name: '100 Credits' },
          payment: { price: 9.99, provider: 'test', resourceId: '_test-charge' },
          status: 'completed',
        };

        await purchaseCompleted({
          before: null,
          after,
          order: {
            id: '_test-order-one-time',
            type: 'one-time',
            unified: after,
            discount: null,
          },
          uid: UID,
          userDoc: USER_DOC,
          ctx,
        });

        const [record] = await waitForCaptured(Manager, 1);
        const brandName = Manager.config.brand.name;

        assert.deepEqual(record.to, [USER_DOC.auth.email], 'the receipt goes to the buyer');
        assert.equal(record.template, 'order');
        assert.match(record.subject, /100 Credits order #_test-order-one-time/, `the subject names the product, got: ${record.subject}`);

        // The #668 shape: the row used to be labelled with the order id the header
        // already prints, so the product appeared nowhere in the email.
        assert.match(record.summary, new RegExp(`${brandName} 100 Credits`), `the summary names the product, got: ${record.summary}`);
        assert.match(record.summary, /One-time purchase/, `and says it is not a subscription, got: ${record.summary}`);
        assert.match(record.summary, /Total paid today \$9\.99/, `and what was charged, got: ${record.summary}`);

        capture.clearCaptured(Manager);
      },
    },

    {
      name: 'a-transition-that-owes-no-email-sends-none',

      async run({ Manager, ctx }) {
        capture.clearCaptured(Manager);

        // checkout-declined is log-only on purpose: the customer is standing at the
        // checkout watching the decline, and the dunning copy its cousin sends is
        // addressed to somebody mid-subscription ([#212]). An empty capture is the
        // only thing that can prove a deliberate silence.
        await checkoutDeclined({
          before: { product: { id: 'basic', name: 'Basic' }, status: 'active' },
          after: { product: { id: 'premium', name: 'Premium' }, status: 'suspended' },
          order: { id: '_test-order-declined', type: 'subscription' },
          uid: UID,
          userDoc: USER_DOC,
          ctx,
        });

        // A send is fire-and-forget, so absence needs a settle rather than a look:
        // long enough for the render + append the sending transitions above finish
        // inside, which waitForCaptured() measures at well under this.
        await new Promise((resolve) => setTimeout(resolve, 500));

        assert.deepEqual(capture.readCaptured(Manager), [], 'a log-only transition emails nobody');
      },
    },
  ],
});
