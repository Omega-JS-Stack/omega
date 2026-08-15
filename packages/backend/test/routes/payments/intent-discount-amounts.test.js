/**
 * Test: the test intent processor applies a validated discount to the amounts
 *
 * The route validates the code and records it, and the Stripe processor hands it
 * to Stripe as a coupon — Stripe then does the math on its own checkout page. The
 * test processor has no such page, so a discounted checkout moved no number a
 * human could see: the confirmation URL still quoted the full price
 * ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
 *
 * Each case calls the handler DIRECTLY through the shared route harness: the
 * starting state (a basic user who has never bought anything) is a SHAPE, and one
 * uid per case keeps the checkout guard from rejecting the next one. Everything
 * downstream — the processor, the auto-fired webhook, the webhook route, the
 * on-write trigger — is the real pipeline.
 *
 * Product-agnostic: resolves the first paid product from config.payment.products.
 *
 * Run: npx omega test framework:routes/payments/intent-discount-amounts
 */
const { buildUser, callHandler } = require('./_route-harness.js');
const discountCodes = require('../../../src/manager/libraries/payment/discount-codes.js');
const analytics = require('../../../src/manager/events/firestore/payments-webhooks/analytics.js');

const handler = require('../../../src/manager/routes/payments/intent/post.js');

// What each code is worth, pinned against the discount-codes SSOT below so a
// repriced code fails here instead of silently changing what the test asserts.
// Stripe coupons come in two shapes and the seeded set now carries both: a
// percent_off code and an amount_off one
// ([#239](https://github.com/Omega-JS-Stack/omega/issues/239)).
const PERCENT_CODE = 'WELCOME15';
const ONE_TIME_CODE = 'FLASH20';
const AMOUNT_CODE = 'WELCOME10OFF';
const AMOUNT_OFF = 10;

/**
 * A fresh basic user, one uid per case — the checkout guard rejects a caller who
 * already holds a paid subscription, and every case here buys one
 */
async function seedBasicUser(firestore, Manager, suffix) {
  const uid = `_test-intent-discount-${suffix}`;
  const doc = {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: {},
    subscription: { product: { id: 'basic', name: 'Basic' }, status: 'active' },
  };

  await firestore.set(`users/${uid}`, doc, { merge: true });

  return { uid, user: buildUser(Manager, doc) };
}

/**
 * What schemas/payments/intent/post.js resolves a bare checkout request to — the
 * handler receives settings already defaulted
 */
function checkoutSettings(overrides) {
  return {
    processor: 'test',
    frequency: null,
    trial: false,
    verification: {},
    attribution: {},
    discount: null,
    supplemental: {},
    simulate: null,
    ...overrides,
  };
}

function amountFromUrl(url) {
  return new URL(url).searchParams.get('amount');
}

/**
 * The webhook doc the test processor's auto-fired event lands in
 */
async function waitForWebhook(waitFor, firestore, eventId) {
  return waitFor(async () => {
    const doc = await firestore.get(`payments-webhooks/${eventId}`);
    return doc || null;
  }, 30000, 500);
}

function eventIdFor(sessionId) {
  return sessionId.replace('_test-cs-', '_test-evt-');
}

module.exports = {
  description: 'Test intent processor: discounts move the first-charge amounts',
  type: 'group',
  timeout: 90000,

  tests: [
    {
      name: 'setup',
      async run({ assert, config, state, skip }) {
        const paidProduct = (config.payment?.products || []).find((p) => p.id !== 'basic' && p.type === 'subscription' && p.prices);

        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        state.product = paidProduct;
        state.frequency = Object.keys(paidProduct.prices)[0];
        state.price = paidProduct.prices[state.frequency];
        state.oneTimeProduct = (config.payment?.products || []).find((p) => p.type === 'one-time' && p.prices?.once);

        // A flat-dollar code only MOVES a number on a charge bigger than it is —
        // on anything smaller it floors at $0, which is also what a trial quotes.
        // Bill the amount cases against a frequency that can show the difference.
        state.amountFrequency = Object.keys(paidProduct.prices).find((f) => paidProduct.prices[f] > AMOUNT_OFF) || null;
        state.amountPrice = state.amountFrequency ? paidProduct.prices[state.amountFrequency] : null;

        // The codes this suite spends, straight from the SSOT
        assert.equal(discountCodes.DISCOUNT_CODES[PERCENT_CODE].percent, 15, `${PERCENT_CODE} should be 15% off`);
        assert.equal(discountCodes.DISCOUNT_CODES[ONE_TIME_CODE].percent, 20, `${ONE_TIME_CODE} should be 20% off`);
        assert.equal(discountCodes.DISCOUNT_CODES[AMOUNT_CODE].amount, AMOUNT_OFF, `${AMOUNT_CODE} should be $${AMOUNT_OFF} off`);
        assert.equal(discountCodes.DISCOUNT_CODES[AMOUNT_CODE].percent, undefined, `${AMOUNT_CODE} should be amount-based, not percent-based`);
      },
    },

    {
      name: 'a-percent-discount-lands-in-the-confirmation-url',
      async run({ assert, firestore, Manager, state }) {
        const { user } = await seedBasicUser(firestore, Manager, 'percent-url');
        const expected = parseFloat((state.price * 0.85).toFixed(2));

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.frequency, discount: PERCENT_CODE }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(amountFromUrl(sent.body.url), String(expected), `The confirmation URL should quote the discounted first charge ($${expected}), not the full $${state.price}`);
      },
    },

    {
      name: 'the-route-discounts-the-url-for-every-processor',
      async run({ assert, state }) {
        // WHERE this happens is the whole point. A real processor applies its
        // coupon on its own hosted page and never revisits this URL, so doing the
        // math processor-side left a discounted Stripe checkout landing on the
        // confirmation page quoting the LIST price — and the client's tracking
        // modules read that param straight into GA4/pixel revenue. Calling the
        // route's own builder with processor=stripe is what proves the discount
        // is the ROUTE's promise and not the test processor's.
        const args = {
          product: state.product,
          productId: state.product.id,
          productType: 'subscription',
          frequency: state.frequency,
          processor: 'stripe',
          trial: false,
          orderId: '0000-0000-0000',
        };
        const discount = discountCodes.validate(PERCENT_CODE);
        const expected = parseFloat((state.price * 0.85).toFixed(2));

        assert.equal(typeof handler.buildConfirmationUrl, 'function', 'The route should expose its URL builder for testing');

        const discounted = handler.buildConfirmationUrl('https://example.com', { ...args, discount });
        assert.equal(amountFromUrl(discounted), String(expected), `A Stripe checkout should quote the discounted first charge ($${expected}) too`);

        const undiscounted = handler.buildConfirmationUrl('https://example.com', { ...args, discount: null });
        assert.equal(amountFromUrl(undiscounted), String(state.price), 'An undiscounted checkout should be left at the list price');

        if (state.product.trial?.days) {
          const trialing = handler.buildConfirmationUrl('https://example.com', { ...args, trial: true, discount });
          assert.equal(amountFromUrl(trialing), '0', 'A trial charges nothing today, coupon or not');
        }
      },
    },

    {
      name: 'a-percent-discount-lands-on-the-webhook-subscription',
      async run({ assert, firestore, Manager, state, waitFor }) {
        const { user } = await seedBasicUser(firestore, Manager, 'percent-payload');

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.frequency, discount: PERCENT_CODE }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);

        // Stripe attaches the coupon it applied to the subscription — the synthetic
        // payload carries the same thing, so a reader of the webhook can see WHICH
        // code moved the money
        const webhookDoc = await waitForWebhook(waitFor, firestore, eventIdFor(sent.body.id));
        const coupon = webhookDoc.raw?.data?.object?.discount?.coupon;

        assert.ok(coupon, `The fired subscription should carry the discount, got ${JSON.stringify(webhookDoc.raw?.data?.object?.discount)}`);
        assert.equal(coupon.percent_off, 15, 'The coupon should be 15% off');
        assert.equal(coupon.duration, 'once', 'The coupon should apply to the first charge only');
        assert.equal(coupon.name, PERCENT_CODE, 'The coupon should name the code that was redeemed');
      },
    },

    {
      name: 'a-declined-first-invoice-bills-the-discounted-amount',
      async run({ assert, firestore, Manager, state, waitFor }) {
        // The subscription event carries the coupon; the INVOICE is where Stripe
        // reports the money — and the declined checkout is the one path that fires
        // one, so it is where the discounted first charge is provable end to end
        const { user } = await seedBasicUser(firestore, Manager, 'percent-invoice');
        const expectedCents = Math.round(parseFloat((state.price * 0.85).toFixed(2)) * 100);

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.frequency, discount: PERCENT_CODE, simulate: 'decline' }),
        });

        assert.equal(sent.code, 200, `A declined checkout still starts, got ${sent.code}: ${JSON.stringify(sent.body)}`);

        const invoiceDoc = await waitForWebhook(waitFor, firestore, `${eventIdFor(sent.body.id)}-invoice`);

        assert.equal(invoiceDoc.raw?.data?.object?.amount_due, expectedCents, `The failed first invoice should bill the discounted ${expectedCents} cents, not the full ${Math.round(state.price * 100)}`);
      },
    },

    {
      name: 'a-one-time-purchase-is-discounted-in-the-url-and-the-session',
      async run({ assert, firestore, Manager, state, waitFor, skip }) {
        if (!state.oneTimeProduct) {
          skip('No one-time product configured in this brand');
        }

        const { user } = await seedBasicUser(firestore, Manager, 'one-time');
        const price = state.oneTimeProduct.prices.once;
        const expected = parseFloat((price * 0.8).toFixed(2));

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.oneTimeProduct.id, discount: ONE_TIME_CODE }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(amountFromUrl(sent.body.url), String(expected), `The confirmation URL should quote $${expected}, not the full $${price}`);

        const webhookDoc = await waitForWebhook(waitFor, firestore, eventIdFor(sent.body.id));
        const session = webhookDoc.raw?.data?.object;

        assert.equal(session?.amount_total, Math.round(expected * 100), `The session should charge ${Math.round(expected * 100)} cents`);
        assert.equal(session?.total_details?.amount_discount, Math.round((price - expected) * 100), 'The session should report what the coupon took off');
      },
    },

    {
      name: 'no-discount-leaves-the-amounts-alone',
      async run({ assert, firestore, Manager, state, waitFor }) {
        const { user } = await seedBasicUser(firestore, Manager, 'none');

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.frequency }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(amountFromUrl(sent.body.url), String(state.price), 'An undiscounted checkout should still quote the full price');

        const webhookDoc = await waitForWebhook(waitFor, firestore, eventIdFor(sent.body.id));

        assert.equal(webhookDoc.raw?.data?.object?.discount, undefined, 'An undiscounted subscription should carry no coupon');
      },
    },

    {
      name: 'a-trial-with-a-discount-still-charges-nothing-now',
      async run({ assert, firestore, Manager, state, skip }) {
        if (!state.product.trial?.days) {
          skip('The paid product configures no trial');
        }

        const { user } = await seedBasicUser(firestore, Manager, 'trial');

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.frequency, trial: true, discount: PERCENT_CODE }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(amountFromUrl(sent.body.url), '0', 'A trial charges nothing today — a coupon takes its cut off nothing');
      },
    },

    {
      name: 'an-amount-discount-lands-in-the-confirmation-url',
      async run({ assert, firestore, Manager, state, skip }) {
        if (!state.amountFrequency) {
          skip(`No configured price is bigger than the $${AMOUNT_OFF} code`);
        }

        const { user } = await seedBasicUser(firestore, Manager, 'amount-url');
        const expected = parseFloat((state.amountPrice - AMOUNT_OFF).toFixed(2));

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.amountFrequency, discount: AMOUNT_CODE }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(amountFromUrl(sent.body.url), String(expected), `The confirmation URL should quote the discounted first charge ($${expected}), not the full $${state.amountPrice}`);
      },
    },

    {
      name: 'an-amount-discount-lands-on-the-webhook-subscription-in-cents',
      async run({ assert, firestore, Manager, state, waitFor, skip }) {
        if (!state.amountFrequency) {
          skip(`No configured price is bigger than the $${AMOUNT_OFF} code`);
        }

        const { user } = await seedBasicUser(firestore, Manager, 'amount-payload');

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.amountFrequency, discount: AMOUNT_CODE }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);

        // Stripe's `amount_off` is CENTS while ours is dollars — the synthetic
        // payload has to convert, or a reader of the webhook sees a $10 coupon
        // as 10 cents
        const webhookDoc = await waitForWebhook(waitFor, firestore, eventIdFor(sent.body.id));
        const coupon = webhookDoc.raw?.data?.object?.discount?.coupon;

        assert.ok(coupon, `The fired subscription should carry the discount, got ${JSON.stringify(webhookDoc.raw?.data?.object?.discount)}`);
        assert.equal(coupon.amount_off, AMOUNT_OFF * 100, `The coupon should be ${AMOUNT_OFF * 100} cents off`);
        assert.equal(coupon.percent_off, null, 'An amount-based coupon carries no percent');
        assert.equal(coupon.duration, 'once', 'The coupon should apply to the first charge only');
        assert.equal(coupon.name, AMOUNT_CODE, 'The coupon should name the code that was redeemed');
      },
    },

    {
      name: 'a-trial-with-an-amount-discount-still-charges-nothing-now',
      async run({ assert, firestore, Manager, state, skip }) {
        if (!state.product.trial?.days) {
          skip('The paid product configures no trial');
        }

        const { user } = await seedBasicUser(firestore, Manager, 'amount-trial');

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          settings: checkoutSettings({ productId: state.product.id, frequency: state.amountFrequency || state.frequency, trial: true, discount: AMOUNT_CODE }),
        });

        assert.equal(sent.code, 200, `Checkout should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(amountFromUrl(sent.body.url), '0', 'A trial charges nothing today — a flat-dollar coupon comes off nothing');
      },
    },

    {
      name: 'analytics-reports-the-amount-discount-and-a-full-price-renewal',
      async run({ assert, state, skip }) {
        if (!state.amountFrequency) {
          skip(`No configured price is bigger than the $${AMOUNT_OFF} code`);
        }

        // Revenue is reported off the same first-charge math the URL quotes. The
        // gate in front of it read `discount.percent > 0`, so an amount-based
        // code would have tracked the LIST price as revenue while the customer
        // paid less.
        const unified = {
          product: { id: state.product.id, name: state.product.name },
          status: 'active',
          trial: { claimed: false },
          payment: { frequency: state.amountFrequency, price: state.amountPrice, resourceId: 'sub_test_analytics_amount' },
        };
        const order = { discount: discountCodes.validate(AMOUNT_CODE) };
        const expected = parseFloat((state.amountPrice - AMOUNT_OFF).toFixed(2));

        const resolved = analytics.resolvePaymentEvent('subscription', 'new-subscription', 'customer.subscription.created', unified, order);
        assert.equal(resolved.value, expected, `Tracked revenue should be the discounted $${expected}, not the list $${state.amountPrice}`);

        // A renewal is deliberately full price — a 'once' coupon is spent
        const renewal = analytics.resolvePaymentEvent('subscription', null, 'invoice.payment_succeeded', unified, order);
        assert.equal(renewal.value, state.amountPrice, 'Renewals still track the full price');
      },
    },

    {
      name: 'analytics-reports-the-discounted-amount-as-revenue',
      async run({ assert, state }) {
        // The same first-charge math the URL quotes is what analytics reports as
        // revenue, and both now come from applyToAmount(). The existing analytics
        // suite only covers full-price events, so the discounted branch is pinned
        // here — a divergence between the two would mean the confirmation page and
        // the server-side purchase event disagree about what the customer paid.
        const unified = {
          product: { id: state.product.id, name: state.product.name },
          status: 'active',
          trial: { claimed: false },
          payment: { frequency: state.frequency, price: state.price, resourceId: 'sub_test_analytics_discount' },
        };
        const order = { discount: discountCodes.validate(PERCENT_CODE) };
        const expected = parseFloat((state.price * 0.85).toFixed(2));

        const resolved = analytics.resolvePaymentEvent('subscription', 'new-subscription', 'customer.subscription.created', unified, order);

        assert.equal(resolved.reason, 'first-purchase', 'A discounted first checkout is still a first purchase');
        assert.equal(resolved.value, expected, `Tracked revenue should be the discounted $${expected}, not the list $${state.price}`);

        // A renewal is deliberately full price — a 'once' coupon is spent
        const renewal = analytics.resolvePaymentEvent('subscription', null, 'invoice.payment_succeeded', unified, order);
        assert.equal(renewal.value, state.price, 'Renewals still track the full price');
      },
    },

    {
      name: 'validate-returns-the-amount-a-flat-dollar-code-is-worth',
      async run({ assert }) {
        // Everything downstream reads a validate() RESULT, never the raw table —
        // a validated amount code that reported no amount would have quietly
        // charged full price everywhere.
        const result = discountCodes.validate(AMOUNT_CODE.toLowerCase());

        assert.equal(result.valid, true, 'The seeded amount code should validate');
        assert.equal(result.code, AMOUNT_CODE, 'It should normalize to the uppercase code');
        assert.equal(result.amount, AMOUNT_OFF, `It should report $${AMOUNT_OFF} off`);
        assert.equal(result.duration, 'once', 'It should apply to the first charge only');
        assert.equal(result.percent, undefined, 'It should carry no percent');

        // A percent code is unchanged — it reports a percent and no amount
        const percent = discountCodes.validate(PERCENT_CODE);
        assert.equal(percent.percent, 15, 'The percent code still reports its percent');
        assert.equal(percent.amount, undefined, 'The percent code carries no amount');
      },
    },

    {
      name: 'an-amount-discount-comes-off-the-first-charge',
      async run({ assert }) {
        // Stripe coupons come in both shapes (percent_off, amount_off), so the math
        // the test processor runs handles both — pinned here on the pure function
        // across the edges the seeded codes do not reach.
        assert.equal(discountCodes.applyToAmount(99.99, { valid: true, code: 'X', amount: 15, duration: 'once' }), 84.99, '$15 off $99.99 should be $84.99');
        assert.equal(discountCodes.applyToAmount(99.99, { valid: true, code: 'X', percent: 15, duration: 'once' }), 84.99, '15% off $99.99 should be $84.99');
        assert.equal(discountCodes.applyToAmount(9.99, { valid: true, code: 'X', amount: 50, duration: 'once' }), 0, 'A discount bigger than the charge should floor at $0, never go negative');
        assert.equal(discountCodes.applyToAmount(9.99, null), 9.99, 'No discount should leave the charge alone');
        assert.equal(discountCodes.applyToAmount(0, { valid: true, code: 'X', percent: 15 }), 0, 'A $0 charge stays $0');
      },
    },
  ],
};
