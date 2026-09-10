/**
 * Test: provider fetchResource() failure classification
 *
 * Every provider library used to swallow a failed lookup and hand back the payload
 * the WEBHOOK carried, flagged stale — so the object whoever posted the event
 * supplied drove real subscription state ([#506](https://github.com/Omega-JS-Stack/omega/issues/506)).
 * No library falls back any more: a lookup that fails throws, and the throw carries
 * the one thing the pipeline branches on — whether the provider said the resource
 * DOES NOT EXIST (refuse and acknowledge) or simply could not be reached (defer for
 * retry).
 *
 * Each provider's real fetchResource() runs here. The transport is the only thing
 * stubbed (an HTTP client, an SDK) — reading a resource back needs live credentials;
 * everything inward, including the classification, runs for real.
 *
 * Run: npx omega test backend:helpers/payment/fetch-failure
 */
const assert = require('node:assert');
const Stripe = require('../../../dist/manager/libraries/payment/providers/stripe.js');
const PayPal = require('../../../dist/manager/libraries/payment/providers/paypal.js');
const Chargebee = require('../../../dist/manager/libraries/payment/providers/chargebee.js');
const Coinbase = require('../../../dist/manager/libraries/payment/providers/coinbase.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const RESOURCE_ID = '_test-res-lookup';

/** Run fn with a library's transport replaced by a stand-in, restored afterwards */
async function withTransport(library, key, stub, fn) {
  const real = library[key];

  library[key] = stub;

  try {
    return await fn();
  } finally {
    library[key] = real;
  }
}

/** The error a call is expected to throw, or a failure saying it did not throw */
async function throwsFrom(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }

  assert.fail('A failed lookup must throw — there is nothing to fall back to');
}

module.exports = defineCases({
  description: 'Provider fetchResource() failure classification',
  type: 'group',

  tests: [
    {
      name: 'chargebee-classifies-a-404-as-not-found',
      async run() {
        // The shape libraries/payment/providers/chargebee.js throws for a 404
        const notThere = new Error('Chargebee API 404: Sorry, we couldn\'t find that resource');
        notThere.statusCode = 404;

        const error = await throwsFrom(() => withTransport(Chargebee, 'request', async () => {
          throw notThere;
        }, () => Chargebee.fetchResource('subscription', RESOURCE_ID, {})));

        assert.equal(error.notFound, true, 'Chargebee answering 404 means the resource is gone');
        assert.equal(error.provider, 'chargebee', 'the failure names the provider that was asked');
        assert.equal(error.resourceId, RESOURCE_ID, 'and the resource it was asked about');
        assert.match(error.message, /chargebee does not have subscription/, 'the message says the provider does not have it');
      },
    },

    {
      name: 'chargebee-classifies-an-unreachable-api-as-transient',
      async run() {
        const error = await throwsFrom(() => withTransport(Chargebee, 'request', async () => {
          throw new Error('fetch failed');
        }, () => Chargebee.fetchResource('subscription', RESOURCE_ID, {})));

        assert.equal(error.notFound, false, 'an unreachable API is not a provider saying the resource is gone');
        assert.match(error.message, /could not be reached/, 'the message says the lookup never got an answer');
      },
    },

    {
      name: 'coinbase-classifies-a-404-as-not-found',
      async run() {
        // Coinbase Commerce carries the status on the error the way Chargebee
        // does, so the ONE classifier answers for it with no new rule
        // ([#642](https://github.com/Omega-JS-Stack/omega/issues/642))
        const notThere = new Error('Coinbase Commerce API 404: Not found');
        notThere.statusCode = 404;

        const error = await throwsFrom(() => withTransport(Coinbase, 'request', async () => {
          throw notThere;
        }, () => Coinbase.fetchResource('charge', RESOURCE_ID, {})));

        assert.equal(error.notFound, true, 'Coinbase answering 404 means the charge is gone');
        assert.equal(error.provider, 'coinbase', 'the failure names the provider that was asked');
        assert.equal(error.resourceId, RESOURCE_ID, 'and the resource it was asked about');
        assert.match(error.message, /coinbase does not have charge/, 'the message says the provider does not have it');
      },
    },

    {
      name: 'coinbase-classifies-an-unreachable-api-as-transient',
      async run() {
        const error = await throwsFrom(() => withTransport(Coinbase, 'request', async () => {
          throw new Error('fetch failed');
        }, () => Coinbase.fetchResource('charge', RESOURCE_ID, {})));

        assert.equal(error.notFound, false, 'an unreachable API is not a provider saying the charge is gone');
        assert.match(error.message, /could not be reached/, 'the message says the lookup never got an answer');
      },
    },

    {
      name: 'paypal-classifies-a-404-as-not-found',
      async run() {
        // PayPal carries the status in the message only — the shape its client throws
        const error = await throwsFrom(() => withTransport(PayPal, 'request', async () => {
          throw new Error('PayPal API 404: The specified resource does not exist.');
        }, () => PayPal.fetchResource('subscription', RESOURCE_ID, {})));

        assert.equal(error.notFound, true, 'PayPal answering 404 means the resource is gone');
        assert.equal(error.provider, 'paypal', 'the failure names the provider that was asked');
      },
    },

    {
      name: 'paypal-says-an-uncaptured-order-never-moved-the-funds',
      async run() {
        // An order fetch IS the capture, so the caller has to be told the money
        // did not move — the payload it used to fall back to described a captured
        // order that never was
        const error = await throwsFrom(() => withTransport(PayPal, 'request', async () => {
          throw new Error('PayPal API 503: Service unavailable');
        }, () => PayPal.fetchResource('order', RESOURCE_ID, {})));

        assert.equal(error.notFound, false, 'a 503 is transient');
        assert.match(error.message, /NOT captured/, 'the consequence of the failed capture rides on the failure');
      },
    },

    {
      name: 'stripe-classifies-a-missing-resource-as-not-found',
      async run() {
        const missing = new Error(`No such subscription: '${RESOURCE_ID}'`);
        missing.code = 'resource_missing';
        missing.statusCode = 404;

        const sdk = {
          subscriptions: {
            retrieve: async () => {
              throw missing;
            },
          },
        };

        const error = await throwsFrom(() => withTransport(Stripe, 'init', () => sdk,
          () => Stripe.fetchResource('subscription', RESOURCE_ID, {})));

        assert.equal(error.notFound, true, 'Stripe resource_missing means the resource is gone');
        assert.equal(error.cause, missing, 'the provider\'s own error rides along for the logs');
      },
    },

    {
      name: 'stripe-classifies-an-outage-as-transient',
      async run() {
        const sdk = {
          subscriptions: {
            retrieve: async () => {
              throw new Error('An error occurred with our connection to Stripe.');
            },
          },
        };

        const error = await throwsFrom(() => withTransport(Stripe, 'init', () => sdk,
          () => Stripe.fetchResource('subscription', RESOURCE_ID, {})));

        assert.equal(error.notFound, false, 'an outage is not a provider saying the resource is gone');
      },
    },

    {
      name: 'a-refund-miss-names-the-call-that-missed',
      async run() {
        // The failure names its own call site: a refund lookup thrown from
        // getRefundDetails() used to read `fetchResource(refund/…)`, pointing
        // whoever reads the log at a function that never ran.
        const error = await throwsFrom(() => withTransport(PayPal, 'request', async () => {
          throw new Error('PayPal API 404: The specified resource does not exist.');
        }, () => PayPal.getRefundDetails({ id: 'SALE-1' }, { refundId: RESOURCE_ID, eventType: 'PAYMENT.SALE.REFUNDED' })));

        assert.match(error.message, /getRefundDetails\(refund\//, 'the refund lookup names getRefundDetails, not fetchResource');
        assert.equal(error.notFound, true, 'and still classifies — a 404 refund is gone');
      },
    },

    {
      name: 'an-unknown-resource-type-is-never-read-as-not-found',
      async run() {
        // A resource type the library does not know is a fault on THIS side. It must
        // not masquerade as the provider affirmatively answering "no such resource",
        // which would acknowledge the event and drop it forever.
        const error = await throwsFrom(() => Chargebee.fetchResource('unknown-type', RESOURCE_ID, {}));

        assert.equal(error.notFound, false, 'nothing was asked, so nothing was answered');
        assert.match(error.message, /Unknown resource type/, 'the original error still surfaces');
      },
    },
  ],
});
