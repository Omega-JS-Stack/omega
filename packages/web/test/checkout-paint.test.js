/**
 * The checkout page's paint order (`core/js/pages/payment/checkout/index.js`)
 * under the page paint contract (docs/web/page-contract.md, #637).
 *
 * The bug this pins: the page awaited auth AND `Promise.allSettled([trial
 * eligibility, reCAPTCHA])` before it painted anything, so every price, plan
 * tile and pay button sat as a skeleton until a cold backend answered — copy
 * the build config already knew.
 *
 * The harness (test/lib/checkout-boot.js) drives the REAL page with the
 * trial-eligibility request held OPEN, which is the whole point: everything
 * asserted below happens while the server has not answered.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { bootCheckout } = require('./lib/checkout-boot.js');
const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');

module.exports = defineCases({
  type: 'group',
  description: 'checkout-paint',
  tests: [
    {
      name: '#637: prices, plans and pay buttons paint before eligibility answers',
      run: async (ctx) => {
        const { updates, answerEligibility } = await bootCheckout();

        ctx.expect(updates.length, 'exactly one paint lands while the server is still thinking').toBe(1);

        const [paint] = updates;
        ctx.expect(paint.checkout, 'and it is the build-config half').toBeTruthy();
        ctx.expect(paint.checkout.product.name, 'the product is named, not "Loading..."').toBe('Premium');
        ctx.expect(paint.checkout.pricing.monthlyPrice, 'the plan tiles carry real prices').toBe('$10.00');
        ctx.expect(paint.checkout.pricing.annualMonthlyRate).toBe('$8.33');
        ctx.expect(paint.checkout.frequencies.annually, 'the frequency radios know what this product sells').toBe(true);
        ctx.expect(paint.checkout.paymentMethods.card, 'and the pay buttons know which providers are configured').toBe(true);

        await answerEligibility(false);
      },
    },

    {
      name: '#637: the money line and the trial spot are NOT in that first paint',
      run: async (ctx) => {
        const { updates, answerEligibility } = await bootCheckout();

        const [paint] = updates;
        ctx.expect(paint.order, 'the half the server decides has not been published').toBe(undefined);
        ctx.expect(paint.checkout.trial, 'so no trial answer rides the build-config paint').toBe(undefined);
        ctx.expect(paint.checkout.pricing.total, 'and neither does a total that eligibility would change').toBe(undefined);

        await answerEligibility(false);
      },
    },

    {
      name: '#637: a frequency change before the answer redraws the prices, never the money line',
      run: async (ctx) => {
        // The flip this pins: `updateUI()` publishes every root, so a shopper who
        // switched to monthly while eligibility was still in flight got "$10.00 due
        // today" written into the total — and then "$0.00" plus a trial note when the
        // answer landed. A user action before the answer redraws the build-config
        // half alone.
        const { updates, emit, answerEligibility, settle } = await bootCheckout();

        await emit('change', { name: 'frequency', value: 'monthly' });
        await settle();

        ctx.expect(updates.length >= 2, 'the frequency change redrew the page').toBeTruthy();
        ctx.expect(updates.every((update) => update.order === undefined), 'no paint published the order root while the server had not answered').toBeTruthy();
        ctx.expect(updates.at(-1).checkout.pricing.frequencyPaymentText, 'and the prices did follow the new cadence').toBe('$10.00 monthly');

        await answerEligibility(true);

        const orderPaints = updates.filter((update) => update.order);
        ctx.expect(orderPaints.length, 'the money line is still written exactly once, after the answer').toBe(1);
        ctx.expect(orderPaints[0].order.total, 'and it is the trial price, never a value it flipped from').toBe('$0.00');
      },
    },

    {
      name: '#637: the trial answer resolves the money line ONCE, with no flip before it',
      run: async (ctx) => {
        const { updates, answerEligibility } = await bootCheckout();

        await answerEligibility(true);

        const orderPaints = updates.filter((update) => update.order);
        ctx.expect(orderPaints.length, 'the trial spot and the money line are written exactly once').toBe(1);
        ctx.expect(orderPaints[0].order.trial.show, 'the eligible visitor gets the trial note').toBe(true);
        ctx.expect(orderPaints[0].order.total, 'and nothing is due today').toBe('$0.00');
      },
    },

    {
      name: '#637: a server that never answers is UNKNOWN, not "not eligible"',
      run: async (ctx) => {
        // The deadline is what answers when the backend does not (rule 4). The page
        // quotes no trial — it never shows a price the server has not confirmed — and
        // the pay buttons arm anyway rather than staying dead. What the intent route
        // is then ASKED for is the payload's own rule (checkout-trial-payload.test.js):
        // an unknown answer still asks for the trial (Ian 2026-08-27).
        const { updates, form, settle, answerEligibility } = await bootCheckout();

        // The page's ELIGIBILITY_TIMEOUT_MS is 8s, deliberately real: this is the
        // wait a visitor behind a cold backend actually serves.
        await settle(8300);

        const orderPaints = updates.filter((update) => update.order);
        ctx.expect(orderPaints.length, 'the deadline resolved the money line, once').toBe(1);
        ctx.expect(orderPaints[0].order.trial.show, 'and quotes no trial the server never confirmed').toBe(false);
        ctx.expect(orderPaints[0].order.total, 'the full amount is due today').toBe('$100.00');
        ctx.expect([...form.resolved].sort(), 'the pay buttons are armed, not dead').toEqual(['eligibility', 'recaptcha']);

        await answerEligibility(true);

        ctx.expect(updates.filter((update) => update.order).length, 'and a late answer never repaints the money line the visitor already read').toBe(1);
      },
    },

    {
      name: '#637: the pay buttons stay gated until eligibility and reCAPTCHA are both in',
      run: async (ctx) => {
        const { form, answerEligibility } = await bootCheckout();

        ctx.expect([...form.gates].sort(), 'both answers gate the form').toEqual(['eligibility', 'recaptcha']);
        ctx.expect(form.resolved, 'reCAPTCHA settles on its own clock — this brand configures none').toEqual(['recaptcha']);
        ctx.expect(form.ready, 'ready() was asked for during setup; the gates are what hold it').toBe(true);

        await answerEligibility(false);

        ctx.expect([...form.resolved].sort(), 'the trial answer releases the last gate').toEqual(['eligibility', 'recaptcha']);
      },
    },

    {
      name: '#637: the warmup ping goes out as a wakeup, before auth settles',
      run: async (ctx) => {
        const { requests, answerEligibility } = await bootCheckout();

        const wakeup = requests.find((request) => request.options.wakeup);
        ctx.expect(wakeup, 'the page warms the backend through the shared client helper').toBeTruthy();
        ctx.expect(wakeup.url, 'aimed at the one route every wakeup names').toBe(WAKEUP_ROUTE);

        await answerEligibility(false);
      },
    },

    {
      name: '#666: a subscription that sells no trial asks nothing and prices itself at once',
      run: async (ctx) => {
        // The bug this pins: the eligibility route was asked for EVERY subscription,
        // and the answer thrown away whenever `trial.days` was missing or 0 — one
        // authed round trip, plus the skeleton wait behind it, for a question the
        // page had already decided. A trial-less plan is a one-time buy's twin here:
        // there is no trial to be eligible for, so `noTrialToAsk()` answers it.
        const { updates, requests, form, settle } = await bootCheckout({
          product: { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 100 } },
        });

        // Auth settles on its own turn, and the eligibility question waits for it —
        // so the question this test says is never asked gets every chance to be.
        await settle();

        ctx.expect(!requests.some((request) => request.url.includes('trial-eligibility')), 'no eligibility question goes out for a plan that sells no trial').toBeTruthy();

        const orderPaints = updates.filter((update) => update.order);
        ctx.expect(orderPaints.length, 'the money line is written once, on the same clock as the rest of the page').toBe(1);
        ctx.expect(orderPaints[0].order.total, 'and it quotes the full amount due today').toBe('$100.00');
        ctx.expect(orderPaints[0].order.trial.show, 'with no trial note').toBe(false);
        ctx.expect([...form.resolved].sort(), 'the pay buttons arm with no wait').toEqual(['eligibility', 'recaptcha']);
      },
    },
  ],
});
