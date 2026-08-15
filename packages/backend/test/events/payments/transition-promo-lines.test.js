/**
 * Test: the promo line + totals the order-confirmation transitions compute
 * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 *
 * `new-subscription` and `purchase-completed` pre-compute `_computed` for the order
 * email. Three shapes reach them: a percent code, a flat-amount code, and — from an
 * order written before the amount field existed — a valid discount carrying
 * NEITHER. The third must not render a promo line and must not throw: these
 * handlers are dispatched fire-and-forget, so a TypeError in here silently costs
 * the customer their confirmation email.
 *
 * The totals go through applyToAmount() for every shape, so `totalToday` is what
 * was actually charged rather than the list price.
 *
 * Run: npx omega test framework:events/payments/transition-promo-lines
 *
 * The REAL transition modules run. The one thing swapped is the email door
 * (`ctx.Manager.Email`) — sending would hit the real provider — and it is swapped
 * on a VIEW of the Manager (`Object.create`), so the runner's own Manager is never
 * mutated. Everything else (the discount validation, the arithmetic, the template
 * data) is the real path.
 */
const newSubscription = require('../../../src/manager/events/firestore/payments-webhooks/transitions/subscription/new-subscription.js');
const purchaseCompleted = require('../../../src/manager/events/firestore/payments-webhooks/transitions/one-time/purchase-completed.js');
const discountCodes = require('../../../src/manager/libraries/payment/discount-codes.js');

const PRICE = 49.99;
const UID = '_test-transition-promo';

// What an order written before the amount field existed looks like coming back
// out of Firestore: valid, named, and carrying no shape either reader can use
const LEGACY_SHAPELESS_DISCOUNT = { valid: true, code: 'LEGACYCODE', duration: 'once' };

const USER_DOC = { auth: { uid: UID, email: `${UID}@example.com` } };

/**
 * A ctx whose Manager is the real one with ONLY the email door swapped, so the
 * transition's own `sendOrderEmail()` path runs for real up to the send.
 */
function buildCtx(Manager, captured) {
  const managerView = Object.create(Manager);

  managerView.Email = () => ({
    send: async (payload) => {
      captured.sent = payload;
      return { status: 'captured' };
    },
  });

  return {
    Manager: managerView,
    log: () => {},
    error: (message) => captured.errors.push(message),
  };
}

async function runSubscription(Manager, discount, { isTrial = false } = {}) {
  const captured = { errors: [] };
  const order = {
    id: 'ORD-PROMO-SUB',
    type: 'subscription',
    discount: discount,
    unified: { product: { id: 'premium', name: 'Premium' }, payment: { price: PRICE, frequency: 'monthly' } },
  };

  await newSubscription({
    before: {},
    after: {
      product: { id: 'premium', name: 'Premium' },
      payment: { frequency: 'monthly' },
      trial: { claimed: isTrial },
    },
    order,
    uid: UID,
    userDoc: USER_DOC,
    ctx: buildCtx(Manager, captured),
  });

  return { computed: captured.sent?.data?.content?._computed, captured };
}

async function runOneTime(Manager, discount) {
  const captured = { errors: [] };
  const order = {
    id: 'ORD-PROMO-ONE',
    type: 'one-time',
    discount: discount,
    unified: { product: { id: 'credits-100', name: '100 Credits' }, payment: { price: PRICE } },
  };

  await purchaseCompleted({
    before: {},
    after: { product: { id: 'credits-100', name: '100 Credits' }, payment: { price: PRICE, resourceId: 'ch_test_promo' } },
    order,
    uid: UID,
    userDoc: USER_DOC,
    ctx: buildCtx(Manager, captured),
  });

  return { computed: captured.sent?.data?.content?._computed, captured };
}

module.exports = {
  description: 'Order-confirmation transitions: promo line + totals per discount shape',
  type: 'group',
  timeout: 15000,

  tests: [
    {
      name: 'a-percent-code-renders-a-percent-line',
      async run({ assert, Manager }) {
        const { computed } = await runSubscription(Manager, discountCodes.validate('WELCOME15'));

        assert.ok(computed, 'The transition should have composed the email');
        assert.equal(computed.promoCode, 'WELCOME15', 'The line names the code');
        assert.equal(computed.promoPercent, 15, 'A percent code quotes its percent');
        assert.equal(computed.promoSavings, '7.50', 'It saved 15% of the price');
        assert.equal(computed.totalToday, '42.49', 'The total is what was actually charged');
        assert.equal(computed.firstChargeAmount, '42.49', 'The first charge matches');
        assert.equal('promoAmount' in computed, false, 'A percent code quotes no dollar amount');
      },
    },

    {
      name: 'an-amount-code-renders-a-money-line-and-the-discounted-total',
      async run({ assert, Manager }) {
        const { computed } = await runSubscription(Manager, discountCodes.validate('WELCOME10OFF'));

        assert.equal(computed.promoCode, 'WELCOME10OFF', 'The line names the code');
        assert.equal(computed.promoAmount, '10.00', 'A flat-dollar code quotes its dollars');
        assert.equal(computed.promoSavings, '10.00', 'It saved the full $10');
        assert.equal(computed.totalToday, '39.99', 'The receipt must not quote the list price');
        assert.equal('promoPercent' in computed, false, 'An amount code quotes no percentage');
      },
    },

    {
      name: 'a-discount-with-neither-shape-renders-no-promo-line-and-does-not-throw',
      async run({ assert, Manager }) {
        // An order written before the amount field existed. The handler is
        // dispatched fire-and-forget, so a throw here costs the email silently.
        const { computed, captured } = await runSubscription(Manager, LEGACY_SHAPELESS_DISCOUNT);

        assert.ok(computed, 'The email should still be composed');
        assert.equal('promoCode' in computed, false, 'A shapeless discount renders no promo line');
        assert.equal('promoPercent' in computed, false, 'Nothing to quote as a percentage');
        assert.equal('promoAmount' in computed, false, 'Nothing to quote as an amount');
        assert.equal(computed.totalToday, '49.99', 'With no usable discount the full price stands');
        assert.deepEqual(captured.errors, [], 'The transition should log no error');
      },
    },

    {
      name: 'a-trial-still-charges-nothing-today',
      async run({ assert, Manager }) {
        const { computed } = await runSubscription(Manager, discountCodes.validate('WELCOME10OFF'), { isTrial: true });

        assert.equal(computed.totalToday, '0.00', 'A trial charges nothing today');
        assert.equal(computed.firstChargeAmount, '39.99', 'The first real charge is still the discounted one');
      },
    },

    {
      name: 'the-one-time-transition-behaves-the-same-for-every-shape',
      async run({ assert, Manager }) {
        const percent = await runOneTime(Manager, discountCodes.validate('FLASH20'));
        assert.equal(percent.computed.promoPercent, 20, 'A percent code quotes its percent');
        assert.equal(percent.computed.totalToday, '39.99', '20% off 49.99 is 39.99');

        const amount = await runOneTime(Manager, discountCodes.validate('WELCOME10OFF'));
        assert.equal(amount.computed.promoAmount, '10.00', 'A flat-dollar code quotes its dollars');
        assert.equal(amount.computed.totalToday, '39.99', '$10 off 49.99 is 39.99');

        const shapeless = await runOneTime(Manager, LEGACY_SHAPELESS_DISCOUNT);
        assert.equal('promoCode' in shapeless.computed, false, 'A shapeless discount renders no promo line');
        assert.equal(shapeless.computed.totalToday, '49.99', 'The full price stands');
        assert.deepEqual(shapeless.captured.errors, [], 'The transition should log no error');
      },
    },

    {
      name: 'no-discount-at-all-is-unchanged',
      async run({ assert, Manager }) {
        const { computed } = await runSubscription(Manager, null);

        assert.equal('promoCode' in computed, false, 'No code, no promo line');
        assert.equal(computed.totalToday, '49.99', 'The customer pays the list price');
      },
    },
  ],
};
