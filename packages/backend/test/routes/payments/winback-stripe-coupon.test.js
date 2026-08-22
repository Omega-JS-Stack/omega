/**
 * Test: what the Stripe winback provider asks Stripe to do with the save offer
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * The route suite proves the guards and the claim; this proves the one call that
 * actually discounts somebody's next invoice. Stripe is the only real provider
 * that applies the offer, and it does it by attaching a coupon to a LIVE
 * subscription — a coupon id derived from the offer, and an update whose
 * `discounts` array REPLACES whatever discounts the subscription already had.
 * Neither is visible from the route's answer, so nothing else can catch them
 * going wrong.
 *
 * The provider SDK seam is the ONE thing stubbed — attaching a coupon needs a
 * live Stripe subscription. The offer resolution, the coupon id derivation and
 * the update params are the real code paths. Same technique as
 * intent-discount-coupons.test.js.
 *
 * Run: npx omega test framework:routes/payments/winback-stripe-coupon
 */
const StripeLib = require('../../../src/manager/libraries/payment/providers/stripe.js');
const stripeWinback = require('../../../src/manager/routes/payments/winback/providers/stripe.js');
const winback = require('../../../src/manager/libraries/payment/winback.js');

const UID = '_test-winback-coupon-uid';
const RESOURCE_ID = 'sub_test_winback_coupon';

/**
 * The ctx a provider receives. `Manager` is the runner's REAL one — the coupon
 * builder reads the brand's currency off its resolved config.
 */
function buildCtx(Manager) {
  return {
    Manager,
    log: () => {},
  };
}

/** Run fn with the library's SDK replaced by a stand-in, restored afterwards */
async function withStripeSdk(sdk, fn) {
  const realInit = StripeLib.init;

  StripeLib.init = () => sdk;

  try {
    return await fn();
  } finally {
    StripeLib.init = realInit;
  }
}

/**
 * A stand-in SDK that records the coupon it was asked for and the subscription
 * update it was asked to make. The lookup misses the way the real SDK misses —
 * a `resource_missing` throw — which is what the coupon builder reads.
 */
function sdkCapturing(captured) {
  return {
    coupons: {
      retrieve: async (id) => {
        captured.retrieved = id;

        const error = new Error(`No such coupon: ${id}`);
        error.code = 'resource_missing';
        throw error;
      },
      create: async (params, options) => {
        captured.created = params;
        captured.createOptions = options;
        return params;
      },
    },
    subscriptions: {
      update: async (id, params) => {
        captured.updated = { id: id, params: params };
        return { id: id };
      },
    },
  };
}

async function applyOffer(Manager, discount) {
  const captured = {};

  await withStripeSdk(sdkCapturing(captured), () => stripeWinback.applyOffer({
    resourceId: RESOURCE_ID,
    uid: UID,
    subscription: { product: { id: 'premium' }, payment: { provider: 'stripe', resourceId: RESOURCE_ID } },
    discount: discount,
    ctx: buildCtx(Manager),
  }));

  return captured;
}

module.exports = {
  description: 'Payment winback: what Stripe is asked to do with the save offer',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'stripe-attaches-the-default-offers-coupon-to-the-live-subscription',
      auth: 'none',
      async run({ assert, Manager }) {
        // The framework default — 50% off the next cycle — is the offer a brand
        // that configures nothing makes, and its coupon id is derived from it,
        // never invented here.
        const discount = winback.toDiscount(winback.resolveOffer());
        const captured = await applyOffer(Manager, discount);

        assert.equal(captured.retrieved, 'BEM_WINBACK50_50OFF_ONCE', 'The offer resolves to the checkout plumbing\'s deterministic coupon id');
        assert.equal(captured.created.percent_off, 50, 'A percent offer builds a percent_off coupon');
        assert.equal(captured.created.duration, 'once', 'and a `once` offer discounts exactly the next cycle');

        assert.ok(captured.updated, 'It should have updated the subscription');
        assert.equal(captured.updated.id, RESOURCE_ID, 'the LIVE subscription named by the route');
        assert.deepEqual(
          captured.updated.params,
          { discounts: [{ coupon: 'BEM_WINBACK50_50OFF_ONCE' }] },
          'attaching the coupon it just resolved and NOTHING else — the plan, the cadence and the renewal date are untouched',
        );
      },
    },
  ],
};
