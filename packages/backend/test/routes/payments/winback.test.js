/**
 * Test: POST /payments/winback — the cancel-flow save offer's apply path
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * The offer is pitched before the cancellation questionnaire and accepting it
 * discounts the next cycle instead of ending the subscription. What that offer
 * IS belongs to the brand (`payment.winback`, resolved by @omega.js/config with a
 * 50%-off default), so this suite reads the brand's own resolution rather than
 * asserting a number.
 *
 * Two layers, the same split cancel.test.js and plan.test.js use:
 *  - the wire guards and the happy path over `http.as(...)`, which is what
 *    proves the route is registered, auth-gated and schema-validated at all;
 *  - the per-subscription guards and the processor capability gate through
 *    DIRECT handler calls (the _route-harness technique), so one test can choose
 *    a processor and a subscription shape without minting a persona each.
 *
 * The offer is claimed ONCE: the claim lives on
 * payments-orders/{orderId}.requests.winback, so the second call is refused
 * against the same document the first one wrote.
 *
 * EVERY refusal carries a branchable code on `omega-properties`
 * ([#311](https://github.com/Omega-JS-Stack/omega/issues/311)): the client
 * pitches the offer off the account alone, so any refusal it cannot name leaves
 * the customer in a dialog arming a retry that can never succeed. Each guard
 * below asserts its own code for that reason.
 *
 * Run: npx omega test framework:routes/payments/winback
 */
const { buildUser, recordingResponse } = require('./_route-harness.js');
const winback = require('../../../src/manager/libraries/payment/winback.js');

const handler = require('../../../src/manager/routes/payments/winback/post.js');

function processorModule(name) {
  return require(`../../../src/manager/routes/payments/winback/processors/${name}.js`);
}

const YEAR = 365 * 24 * 60 * 60;

/**
 * A paying subscriber the offer can be made to.
 *
 * @param {object} Manager - The @omega.js/backend Manager
 * @param {object} options - uid, product, processor, resourceId, and the state overrides
 */
function subscriber(Manager, { uid, product, processor, resourceId, orderId, pending, trial, status }) {
  const lastYearUNIX = Math.floor(Date.now() / 1000) - YEAR;
  const nextMonthUNIX = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

  return buildUser(Manager, {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: {},
    subscription: {
      product: { id: product.id, name: product.name || product.id },
      status: status === undefined ? 'active' : status,
      cancellation: { pending: pending === true },
      expires: trial
        ? { timestamp: new Date(nextMonthUNIX * 1000).toISOString(), timestampUNIX: nextMonthUNIX }
        : { timestamp: new Date(nextMonthUNIX * 1000).toISOString(), timestampUNIX: nextMonthUNIX },
      ...(trial
        ? { trial: { claimed: true, expires: { timestamp: new Date(nextMonthUNIX * 1000).toISOString(), timestampUNIX: nextMonthUNIX } } }
        : {}),
      payment: {
        processor: processor === undefined ? 'test' : processor,
        resourceId: resourceId === undefined ? 'sub_test_winback_guard' : resourceId,
        orderId: orderId === undefined ? null : orderId,
        frequency: 'monthly',
        startDate: { timestamp: new Date(lastYearUNIX * 1000).toISOString(), timestampUNIX: lastYearUNIX },
      },
    },
  });
}

/**
 * A direct call with the `omega-properties` header captured — the
 * branchable half of a 4xx rides that header, so a test asserting a CODE reads
 * it (plan.test.js's technique, for the same gate).
 *
 * @returns {Promise<{ sent: object, properties: object|null }>}
 */
async function acceptOfferReadingProperties(Manager, user, settings) {
  const res = recordingResponse();
  const headers = {};

  res.header = (key, value) => {
    headers[key] = value;
    return res;
  };
  res.get = (key) => headers[key];

  const req = { method: 'POST', headers: { 'content-type': 'application/json' }, query: {}, body: {} };
  const ctx = Manager.RouteContext({ req, res }, { functionName: 'payments-winback' });

  await handler({ ctx, Manager, user, settings: { confirmed: true, ...(settings || {}) }, libraries: Manager.libraries });

  return {
    sent: res.sent,
    properties: headers['omega-properties'] ? JSON.parse(headers['omega-properties']) : null,
  };
}

/** Run the thunk with the brand's save offer replaced, restoring it after. */
async function withOffer(Manager, winbackConfig, fn) {
  const payment = Manager.config.payment;
  const original = payment.winback;

  if (winbackConfig === null) delete payment.winback;
  else payment.winback = winbackConfig;

  try {
    return await fn();
  } finally {
    if (original === undefined) delete payment.winback;
    else payment.winback = original;
  }
}

// The paid subscription product the offer is made against.
function paidProduct(config, skip) {
  const paid = (config.payment?.products || []).find((p) => p.id !== 'basic' && p.type === 'subscription' && p.prices?.monthly);

  if (!paid) {
    skip('No paid subscription product with a monthly price configured in this brand');
  }

  return paid;
}

module.exports = {
  description: 'Payment winback endpoint: the save offer apply path',
  type: 'group',
  timeout: 30000,

  tests: [
    // ─── the wire guards ───

    {
      name: 'rejects-unauthenticated',
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/payments/winback', {
          confirmed: true,
        });

        assert.isError(response, 401, 'Should reject unauthenticated request');
      },
    },

    {
      name: 'rejects-missing-confirmed',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/winback', {});

        assert.isError(response, 400, 'Should reject a request that confirms nothing');
      },
    },

    {
      name: 'rejects-basic-user',
      async run({ http, assert }) {
        const response = await http.as('basic').post('backend-manager/payments/winback', {
          confirmed: true,
        });

        assert.isError(response, 400, 'Should reject a user with no paid subscription to keep');
      },
    },

    // ─── the offer itself ───

    {
      name: 'resolves-the-brand-offer-with-the-framework-default',
      async run({ Manager, assert }) {
        // The 50% default has ONE home (@omega.js/config). A brand that
        // configures nothing still has an offer, and it is that one.
        await withOffer(Manager, null, async () => {
          const offer = winback.resolveOffer(Manager.config);

          assert.equal(offer.enabled, true, 'the offer is on by default');
          assert.equal(offer.percent, 50, 'and it is 50% off');
          assert.equal(offer.duration, 'once', 'for one cycle');

          const discount = winback.toDiscount(offer);

          assert.equal(discount.valid, true, 'it hands downstream a validate()-shaped discount');
          assert.equal(discount.code, 'WINBACK50', 'named for what it is');
          assert.equal(discount.amount, undefined, 'a percent offer declares no amount at all');
        });
      },
    },

    {
      name: 'refuses-when-the-brand-disabled-the-offer',
      async run({ Manager, assert, config, skip }) {
        const product = paidProduct(config, skip);

        await withOffer(Manager, { enabled: false }, async () => {
          const user = subscriber(Manager, { uid: '_test-winback-disabled', product });
          const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

          assert.equal(sent.code, 400, 'Should refuse an offer the brand turned off');
          assert.equal(
            properties?.additional?.code,
            'offer-disabled',
            'the refusal carries a code the billing card can branch on',
          );
        });
      },
    },

    {
      name: 'refuses-an-unconfirmed-request',
      async run({ Manager, assert, config, skip }) {
        const product = paidProduct(config, skip);
        const user = subscriber(Manager, { uid: '_test-winback-unconfirmed', product });
        const { sent, properties } = await acceptOfferReadingProperties(Manager, user, { confirmed: false });

        assert.equal(sent.code, 400, 'Should refuse a request that confirms nothing');
        assert.equal(
          properties?.additional?.code,
          'confirmation-required',
          'and says which refusal it was — the ONE code a retry can actually fix',
        );
      },
    },

    // ─── the per-subscription guards ───

    {
      name: 'refuses-a-trial',
      async run({ Manager, assert, config, skip }) {
        // A trial cancel ends access immediately (#267) and nothing has been
        // paid, so there is no next cycle to discount. The billing card gates
        // the same way, off the same rule.
        const product = paidProduct(config, skip);
        const user = subscriber(Manager, { uid: '_test-winback-trial', product, trial: true });

        const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

        assert.equal(sent.code, 400, 'Should refuse a subscription still inside its free trial');
        assert.equal(
          properties?.additional?.code,
          'trial-not-eligible',
          'the refusal carries a code the billing card can branch on',
        );
      },
    },

    {
      name: 'refuses-a-scheduled-cancellation',
      async run({ Manager, assert, config, skip }) {
        const product = paidProduct(config, skip);
        const user = subscriber(Manager, { uid: '_test-winback-pending', product, pending: true });

        const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

        assert.equal(sent.code, 400, 'Should refuse when the cancellation is already scheduled');
        assert.equal(
          properties?.additional?.code,
          'cancellation-pending',
          'the refusal carries the same code the plan switch refuses that state with',
        );
      },
    },

    {
      name: 'refuses-a-suspended-subscription',
      async run({ Manager, assert, config, skip }) {
        const product = paidProduct(config, skip);
        const user = subscriber(Manager, { uid: '_test-winback-suspended', product, status: 'suspended' });

        const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

        assert.equal(sent.code, 400, 'Should refuse a subscription that is not active');
        assert.equal(
          properties?.additional?.code,
          'no-active-subscription',
          'the refusal carries a code the billing card can branch on',
        );
      },
    },

    {
      name: 'refuses-missing-payment-details',
      async run({ Manager, assert, config, skip }) {
        // An ADMIN-GRANTED or imported subscription is paid and active with no
        // processor details on it at all, and the client pitches what it can
        // read — so this refusal needs a code as much as the capability gate
        // does ([#311]): without one, accepting shows an error toast and leaves
        // the dialog armed for a retry that can never succeed. HALF the details
        // is the same dead end, so each half is proven on its own.
        const product = paidProduct(config, skip);
        const halves = [
          { what: 'processor', processor: null, resourceId: 'sub_test_winback_guard' },
          { what: 'resourceId', processor: 'test', resourceId: null },
          { what: 'both', processor: null, resourceId: null },
        ];

        for (const { what, processor, resourceId } of halves) {
          const user = subscriber(Manager, { uid: `_test-winback-no-${what}`, product, processor, resourceId });
          const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

          assert.equal(sent.code, 400, `missing ${what}: Should refuse a subscription the route cannot reach a processor with`);
          assert.equal(
            properties?.additional?.code,
            'missing-payment-details',
            `missing ${what}: the refusal carries a code the billing card can branch on`,
          );
        }
      },
    },

    {
      name: 'refuses-an-unknown-processor',
      async run({ Manager, assert, config, skip }) {
        const product = paidProduct(config, skip);
        const user = subscriber(Manager, { uid: '_test-winback-unknown', product, processor: 'not-a-processor' });

        const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

        assert.equal(sent.code, 400, 'Should refuse a processor that does not exist');
        assert.equal(
          properties?.additional?.code,
          'unknown-processor',
          'the refusal carries a code the billing card can branch on',
        );
      },
    },

    {
      name: 'refuses-when-the-claim-has-nowhere-to-be-recorded',
      async run({ Manager, assert, config, skip }) {
        // "Claimed once" is only true while there is a document to record the
        // claim on. A subscription carrying no orderId (dashboard-created,
        // imported, a metadata backfill that never landed) has none, so the
        // offer is refused BEFORE dispatch rather than becoming takeable on
        // every cancel dialog — each accept re-couponing the subscription.
        const product = paidProduct(config, skip);
        const user = subscriber(Manager, { uid: '_test-winback-no-order', product });
        const processor = processorModule('test');
        const applied = [];
        const realApplyOffer = processor.applyOffer;

        processor.applyOffer = async (options) => applied.push(options);

        try {
          const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

          assert.equal(sent.code, 400, 'Should refuse an offer whose claim cannot be recorded');
          assert.equal(
            properties?.additional?.code,
            'offer-not-claimable',
            'the refusal carries a code the billing card can branch on',
          );
          assert.equal(applied.length, 0, 'and nothing reached the processor');
        } finally {
          processor.applyOffer = realApplyOffer;
        }
      },
    },

    {
      name: 'refuses-a-second-claim-with-a-branchable-code',
      async run({ Manager, assert, config, firestore, skip }) {
        // The offer is claimed ONCE, and a past claimant who opens the cancel
        // dialog again is pitched it anyway — the client reads the account, not
        // the order doc. So the refusal carries a code the billing card can
        // branch on ([#310]): without one, accepting shows an error toast and
        // leaves the dialog armed for a retry that can never succeed.
        const product = paidProduct(config, skip);
        const orderId = '_test-winback-claimed-order';
        const user = subscriber(Manager, { uid: '_test-winback-claimed', product, orderId });
        const processor = processorModule('test');
        const applied = [];
        const realApplyOffer = processor.applyOffer;

        // The first claim, written where the route records it
        await firestore.set(`payments-orders/${orderId}`, {
          requests: {
            winback: {
              discount: winback.toDiscount(winback.resolveOffer(Manager.config)),
              date: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) },
            },
          },
        }, { merge: true });

        processor.applyOffer = async (options) => applied.push(options);

        try {
          const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

          assert.equal(sent.code, 400, 'Should refuse an offer this subscription already took');
          assert.equal(
            properties?.additional?.code,
            'offer-already-claimed',
            'the refusal carries a code the billing card can branch on',
          );
          assert.equal(applied.length, 0, 'and the processor is never asked to discount twice');
        } finally {
          processor.applyOffer = realApplyOffer;
          await firestore.delete(`payments-orders/${orderId}`);
        }
      },
    },

    // ─── the processor capability gate ───

    {
      name: 'declares-which-processors-can-apply-the-offer',
      async run({ assert }) {
        // The export IS the declaration. Stripe rides the coupon plumbing the
        // checkout already uses; the test processor mirrors it. PayPal has no
        // discount object at all, and Chargebee has coupons but no way to reach
        // a LIVE subscription with one through plumbing that exists here — both
        // say so by exporting nothing.
        assert.equal(typeof processorModule('stripe').applyOffer, 'function', 'Stripe applies the offer');
        assert.equal(typeof processorModule('test').applyOffer, 'function', 'the test processor applies the offer');
        assert.equal(typeof processorModule('paypal').applyOffer, 'undefined', 'PayPal declares it cannot');
        assert.equal(typeof processorModule('chargebee').applyOffer, 'undefined', 'Chargebee declares it cannot');
      },
    },

    {
      name: 'refuses-a-processor-that-cannot-discount-with-a-branchable-code',
      async run({ Manager, assert, config, skip }) {
        const product = paidProduct(config, skip);

        for (const processor of ['paypal', 'chargebee']) {
          const user = subscriber(Manager, { uid: `_test-winback-${processor}`, product, processor, resourceId: `sub_${processor}_winback` });
          const { sent, properties } = await acceptOfferReadingProperties(Manager, user);

          assert.equal(sent.code, 400, `${processor}: Should refuse before dispatch`);
          assert.equal(
            properties?.additional?.code,
            'not-supported-by-processor',
            `${processor}: the refusal carries the code the billing card branches on`,
          );
        }
      },
    },

    // ─── the happy path, over the wire ───

    {
      name: 'applies-the-offer-and-claims-it-once',
      async run({ http, assert, config, accounts, firestore, waitFor, skip }) {
        const uid = accounts['route-winback-success'].uid;
        const product = paidProduct(config, skip);

        // Step 1: a real paid subscription on the test processor
        const intentResponse = await http.as('route-winback-success').post('backend-manager/payments/intent', {
          processor: 'test',
          productId: product.id,
          frequency: 'monthly',
        });

        assert.isSuccess(intentResponse, 'Intent should succeed');

        // Step 2: the auto-webhook activates it
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.payment?.processor === 'test'
            && userDoc?.subscription?.payment?.resourceId
            && userDoc?.subscription?.status === 'active';
        }, 15000, 500);

        // Step 3: the customer starts cancelling and takes the offer instead
        const response = await http.as('route-winback-success').post('backend-manager/payments/winback', {
          confirmed: true,
        });

        assert.isSuccess(response, 'Should apply the save offer');
        assert.equal(response.data.success, true, 'Should return success: true');
        assert.equal(response.data.discount.valid, true, 'Should answer with the discount it applied');

        // Step 4: the subscription is UNCHANGED — the cancel never happened and
        // a coupon does not move the plan, the cadence or the renewal
        const userDoc = await firestore.get(`users/${uid}`);
        assert.equal(userDoc.subscription.status, 'active', 'The subscription is still active');
        assert.equal(userDoc.subscription.cancellation?.pending, false, 'and nothing is scheduled to cancel');

        // Step 5: the claim is on the order doc — the offer's whole memory
        const orderId = userDoc.subscription.payment.orderId;
        const orderDoc = await firestore.get(`payments-orders/${orderId}`);

        assert.equal(orderDoc.requests.winback.discount.code, response.data.discount.code, 'The claim records the discount applied');
        assert.ok(orderDoc.requests.winback.date.timestampUNIX > 0, 'and when it was claimed');

        // Step 6: it is claimed ONCE — an offer takeable on every cancel dialog
        // is a permanent discount nobody agreed to
        const second = await http.as('route-winback-success').post('backend-manager/payments/winback', {
          confirmed: true,
        });

        assert.isError(second, 400, 'Should refuse a second claim on the same subscription');
      },
    },
  ],
};
