/**
 * Test: Stripe getRefundDetails()
 * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
 *
 * The refund's amount, currency and reason used to be read out of the webhook
 * envelope — whatever the caller posted — and written onto the order record and
 * into the customer's refund email. They come off Stripe's own record of the
 * charge now: the one-time refund path already fetched it, and the subscription
 * path (whose fetched resource is the SUBSCRIPTION the refunded charge belongs
 * to) reads it back by the charge id the payload names. The id is an identifier,
 * the same trust level as the resourceId every lookup starts from; the numbers
 * are Stripe's.
 *
 * The SDK is the one thing stubbed here: retrieving a charge needs a live Stripe
 * account. Everything under test runs for real.
 *
 * Run: npx omega test backend:helpers/payment/stripe/refund-details
 */
const Stripe = require('../../../../dist/manager/libraries/payment/providers/stripe.js');
const defineCases = require('../../../../dist/vendor/devkit/test/define-cases.js');

const CHARGE_ID = 'ch_test_refund_details';
const SUBSCRIPTION_ID = 'sub_test_refund_details';

/** Run fn with the library's SDK replaced by a stand-in, restored afterwards */
async function withStripeSdk(sdk, fn) {
  const realInit = Stripe.init;

  Stripe.init = () => sdk;

  try {
    return await fn();
  } finally {
    Stripe.init = realInit;
  }
}

/** A stand-in SDK that records every charge retrieve and answers with `charge` */
function sdkReturning(charge, calls) {
  return {
    charges: {
      retrieve: async (id) => {
        calls.push(id);
        return charge;
      },
    },
  };
}

/** A Stripe charge refunded for `amountCents` */
function charge(amountCents, reason) {
  return {
    id: CHARGE_ID,
    object: 'charge',
    amount_refunded: amountCents,
    currency: 'usd',
    refunds: { data: [{ id: 're_test', amount: amountCents, currency: 'usd', reason: reason }] },
  };
}

/** The envelope a charge.refunded event arrives in, claiming `amountCents` */
function envelope(amountCents, reason) {
  return { id: 'evt_test', type: 'charge.refunded', data: { object: charge(amountCents, reason) } };
}

module.exports = defineCases({
  description: 'Stripe getRefundDetails() reads the charge Stripe answered for',
  type: 'group',

  tests: [
    {
      name: 'reads-the-charge-already-in-hand',
      async run({ assert }) {
        // The one-time refund path resolves to the charge itself — it is already the
        // provider's answer, so there is nothing to look up a second time.
        const calls = [];

        const details = await withStripeSdk(sdkReturning(null, calls), () => {
          return Stripe.getRefundDetails(charge(999, 'requested_by_customer'), { raw: envelope(99999, 'fraudulent') });
        });

        assert.equal(details.amount, '9.99', 'The amount comes off the fetched charge');
        assert.equal(details.currency, 'USD', 'The currency comes off the fetched charge');
        assert.equal(details.reason, 'requested_by_customer', 'The reason comes off the fetched charge');
        assert.equal(calls.length, 0, 'A charge already in hand is not fetched again');
      },
    },

    {
      name: 'looks-the-charge-up-when-the-resource-is-not-one',
      async run({ assert }) {
        // The subscription refund path: the resource is the subscription, which
        // carries no refund fields at all — the envelope's charge was the only
        // thing ever read for them.
        const calls = [];
        const subscription = { id: SUBSCRIPTION_ID, object: 'subscription', status: 'active' };

        const details = await withStripeSdk(sdkReturning(charge(999, 'requested_by_customer'), calls), () => {
          return Stripe.getRefundDetails(subscription, { raw: envelope(99999, 'fraudulent') });
        });

        assert.equal(calls.length, 1, 'The charge is read back from Stripe');
        assert.equal(calls[0], CHARGE_ID, 'By the id the payload names — an identifier, nothing more');
        assert.equal(details.amount, '9.99', 'The amount is Stripe\'s, not the envelope\'s');
        assert.equal(details.reason, 'requested_by_customer', 'And so is the reason');
      },
    },

    {
      name: 'a-failed-charge-lookup-throws-rather-than-answering-with-the-payload',
      async run({ assert }) {
        // An amount that cannot be verified is not written at all ([#506]).
        const error = new Error(`No such charge: '${CHARGE_ID}'`);

        error.code = 'resource_missing';
        error.statusCode = 404;

        let threw = null;

        try {
          await withStripeSdk({ charges: { retrieve: async () => {
            throw error;
          } } }, () => {
            return Stripe.getRefundDetails({ id: SUBSCRIPTION_ID, object: 'subscription' }, { raw: envelope(99999, 'fraudulent') });
          });
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A failed lookup must throw');
        assert.equal(threw.notFound, true, 'A charge Stripe does not have is a terminal miss, classified by the same seam');
        assert.equal(threw.resourceType, 'charge', 'The failure names the lookup that missed');
      },
    },

    {
      name: 'an-unrefunded-charge-reports-no-amount',
      async run({ assert }) {
        const details = Stripe.toRefundDetails({ id: CHARGE_ID, object: 'charge', currency: 'eur' });

        assert.equal(details.amount, null, 'Nothing came back, so no amount is reported');
        assert.equal(details.currency, 'EUR', 'The charge\'s own currency still comes through');
        assert.equal(details.reason, null, 'And no reason is invented');
      },
    },
  ],
});
