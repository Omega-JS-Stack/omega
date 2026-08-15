/**
 * Test: POST /payments/plan — guards and the per-processor capability gate
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * Plan-switch is an OWNED route next to cancel, cross-provider and capability-gated
 * the same way uncancel is: a processor that can move a live subscription between
 * plans EXPORTS `switchPlan`, one that cannot simply lacks the export.
 *
 * The route is called directly against a real ctx (the _route-harness technique),
 * so one test can choose a processor, a product and a frequency without minting a
 * persona per permutation. The full end-to-end pipeline run lives in
 * test/events/payments/journey-payments-plan-switch.test.js.
 *
 * Run: npx omega test framework:routes/payments/plan
 */
const { buildUser, callHandler } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/plan/post.js');

const PROCESSORS = ['stripe', 'chargebee', 'paypal', 'test'];

function processorModule(name) {
  return require(`../../../src/manager/routes/payments/plan/processors/${name}.js`);
}

// Two distinct paid subscription products from the brand's own config — the
// switch has no meaning without them, so a brand that lacks a pair skips.
function paidPair(config, skip) {
  const paid = (config.payment?.products || []).filter((p) => p.id !== 'basic' && p.type === 'subscription' && p.prices);

  if (paid.length < 2) {
    skip('Fewer than two paid subscription products configured in this brand');
  }

  return { from: paid[0], to: paid[1] };
}

// A paying subscriber sitting on `product` at `frequency`.
function subscriber(Manager, { uid, product, frequency, processor, resourceId }) {
  const lastYearUNIX = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60);

  return buildUser(Manager, {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: {},
    subscription: {
      product: { id: product.id, name: product.name || product.id },
      status: 'active',
      cancellation: { pending: false },
      payment: {
        processor: processor === undefined ? 'test' : processor,
        resourceId: resourceId === undefined ? 'sub_test_plan_guard' : resourceId,
        frequency: frequency,
        startDate: { timestamp: new Date(lastYearUNIX * 1000).toISOString(), timestampUNIX: lastYearUNIX },
      },
    },
  });
}

function switchPlan(Manager, user, settings) {
  return callHandler({
    Manager,
    handler,
    functionName: 'payments-plan',
    user,
    settings: { confirmed: true, ...(settings || {}) },
  });
}

// The frequency a product is actually priced at in this brand's config.
function frequencyOf(product) {
  return Object.keys(product.prices)[0];
}

module.exports = {
  description: 'Payment plan endpoint: guards + processor capability gate',
  type: 'group',
  timeout: 15000,

  tests: [
    // ─── the wire guards ───

    {
      name: 'rejects-unauthenticated',
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/payments/plan', {
          productId: 'premium',
          frequency: 'monthly',
          confirmed: true,
        });

        assert.isError(response, 401, 'Should reject unauthenticated request');
      },
    },

    {
      name: 'rejects-missing-confirmed',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/plan', {
          productId: 'premium',
          frequency: 'monthly',
        });

        assert.isError(response, 400, 'Should reject a request that never confirmed');
      },
    },

    {
      name: 'rejects-missing-product-id',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/plan', {
          confirmed: true,
        });

        assert.isError(response, 400, 'Should reject a switch with no target product');
      },
    },

    // ─── the subscription-state guards ───

    {
      name: 'rejects-unconfirmed',
      auth: 'none',
      async run({ assert, Manager, config, skip }) {
        const { from, to } = paidPair(config, skip);
        const user = subscriber(Manager, { uid: '_test-plan-unconfirmed', product: from, frequency: frequencyOf(from) });

        const sent = await switchPlan(Manager, user, { confirmed: false, productId: to.id, frequency: frequencyOf(to) });

        assert.equal(sent.code, 400, `An unconfirmed switch must be refused, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-basic-user',
      auth: 'none',
      async run({ assert, Manager, config, skip }) {
        const { to } = paidPair(config, skip);
        const user = subscriber(Manager, { uid: '_test-plan-basic', product: { id: 'basic', name: 'Basic' }, frequency: null });

        const sent = await switchPlan(Manager, user, { productId: to.id, frequency: frequencyOf(to) });

        assert.equal(sent.code, 400, `A free user has no subscription to move, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-a-product-the-brand-does-not-sell',
      auth: 'none',
      async run({ assert, Manager, config, skip }) {
        const { from } = paidPair(config, skip);
        const user = subscriber(Manager, { uid: '_test-plan-unknown-product', product: from, frequency: frequencyOf(from) });

        const sent = await switchPlan(Manager, user, { productId: '_not-a-configured-product', frequency: 'monthly' });

        assert.equal(sent.code, 400, `An unconfigured product must be refused, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-the-plan-the-user-is-already-on',
      auth: 'none',
      async run({ assert, Manager, config, skip }) {
        const { from } = paidPair(config, skip);
        const frequency = frequencyOf(from);
        const user = subscriber(Manager, { uid: '_test-plan-same', product: from, frequency });

        const sent = await switchPlan(Manager, user, { productId: from.id, frequency });

        assert.equal(sent.code, 400, `Switching to the current plan is a no-op, got ${sent.code}`);
        assert.match(`${sent.body}`, /already on/i, `Expected the same-plan message, got: ${sent.body}`);
      },
    },

    {
      name: 'lets-a-frequency-change-on-the-same-product-through',
      auth: 'none',
      async run({ assert, Manager, config, skip }) {
        // Monthly → annually on ONE product is a real switch: the same-plan guard
        // keys on product AND frequency, never on product alone. The processor is
        // deliberately unknown, so the route stops at the NEXT gate — reaching it
        // is the proof, and nothing is dispatched.
        const { from } = paidPair(config, skip);
        const frequencies = Object.keys(from.prices);

        if (frequencies.length < 2) {
          skip(`Product ${from.id} is priced at a single frequency`);
        }

        const user = subscriber(Manager, { uid: '_test-plan-frequency', product: from, frequency: frequencies[0], processor: 'unknown-processor' });

        const sent = await switchPlan(Manager, user, { productId: from.id, frequency: frequencies[1] });

        assert.equal(sent.code, 400, `Expected the unknown-processor gate, got ${sent.code}`);
        assert.ok(!/already on/i.test(`${sent.body}`), `A frequency change must clear the same-plan guard, got: ${sent.body}`);
      },
    },

    {
      name: 'rejects-missing-payment-details',
      auth: 'none',
      async run({ assert, Manager, config, skip }) {
        const { from, to } = paidPair(config, skip);
        const user = subscriber(Manager, { uid: '_test-plan-no-processor', product: from, frequency: frequencyOf(from), processor: null, resourceId: null });

        const sent = await switchPlan(Manager, user, { productId: to.id, frequency: frequencyOf(to) });

        assert.equal(sent.code, 400, `Without a processor there is nothing to call, got ${sent.code}`);
      },
    },

    {
      name: 'rejects-unknown-processor',
      auth: 'none',
      async run({ assert, Manager, config, skip }) {
        const { from, to } = paidPair(config, skip);
        const user = subscriber(Manager, { uid: '_test-plan-unknown-processor', product: from, frequency: frequencyOf(from), processor: 'unknown-processor' });

        const sent = await switchPlan(Manager, user, { productId: to.id, frequency: frequencyOf(to) });

        assert.equal(sent.code, 400, `An unknown processor must be refused, got ${sent.code}`);
      },
    },

    // ─── the capability TABLE: the export list IS the contract ───

    {
      name: 'every-processor-supports-plan-switch',
      auth: 'none',
      async run({ assert }) {
        // Unlike uncancel, every processor here can move a live subscription:
        // Stripe updates the item, Chargebee updates for items, PayPal revises.
        PROCESSORS.forEach((name) => {
          assert.equal(typeof processorModule(name).switchPlan, 'function', `${name} should export switchPlan()`);
        });
      },
    },
  ],
};
