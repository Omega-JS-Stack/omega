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
const assert = require('node:assert');
const { test } = require('node:test');

const { bootCheckout } = require('./lib/checkout-boot.js');
const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');

test('#637: prices, plans and pay buttons paint before eligibility answers', async () => {
  const { updates, answerEligibility } = await bootCheckout();

  assert.strictEqual(updates.length, 1, 'exactly one paint lands while the server is still thinking');

  const [paint] = updates;
  assert.ok(paint.checkout, 'and it is the build-config half');
  assert.strictEqual(paint.checkout.product.name, 'Premium', 'the product is named, not "Loading..."');
  assert.strictEqual(paint.checkout.pricing.monthlyPrice, '$10.00', 'the plan tiles carry real prices');
  assert.strictEqual(paint.checkout.pricing.annualMonthlyRate, '$8.33');
  assert.strictEqual(paint.checkout.frequencies.annually, true, 'the frequency radios know what this product sells');
  assert.strictEqual(paint.checkout.paymentMethods.card, true, 'and the pay buttons know which providers are configured');

  await answerEligibility(false);
});

test('#637: the money line and the trial spot are NOT in that first paint', async () => {
  const { updates, answerEligibility } = await bootCheckout();

  const [paint] = updates;
  assert.strictEqual(paint.order, undefined, 'the half the server decides has not been published');
  assert.strictEqual(paint.checkout.trial, undefined, 'so no trial answer rides the build-config paint');
  assert.strictEqual(paint.checkout.pricing.total, undefined, 'and neither does a total that eligibility would change');

  await answerEligibility(false);
});

test('#637: a frequency change before the answer redraws the prices, never the money line', async () => {
  // The flip this pins: `updateUI()` publishes every root, so a shopper who
  // switched to monthly while eligibility was still in flight got "$10.00 due
  // today" written into the total — and then "$0.00" plus a trial note when the
  // answer landed. A user action before the answer redraws the build-config
  // half alone.
  const { updates, emit, answerEligibility, settle } = await bootCheckout();

  await emit('change', { name: 'frequency', value: 'monthly' });
  await settle();

  assert.ok(updates.length >= 2, 'the frequency change redrew the page');
  assert.ok(
    updates.every((update) => update.order === undefined),
    'no paint published the order root while the server had not answered',
  );
  assert.strictEqual(
    updates.at(-1).checkout.pricing.frequencyPaymentText,
    '$10.00 monthly',
    'and the prices did follow the new cadence',
  );

  await answerEligibility(true);

  const orderPaints = updates.filter((update) => update.order);
  assert.strictEqual(orderPaints.length, 1, 'the money line is still written exactly once, after the answer');
  assert.strictEqual(orderPaints[0].order.total, '$0.00', 'and it is the trial price, never a value it flipped from');
});

test('#637: the trial answer resolves the money line ONCE, with no flip before it', async () => {
  const { updates, answerEligibility } = await bootCheckout();

  await answerEligibility(true);

  const orderPaints = updates.filter((update) => update.order);
  assert.strictEqual(orderPaints.length, 1, 'the trial spot and the money line are written exactly once');
  assert.strictEqual(orderPaints[0].order.trial.show, true, 'the eligible visitor gets the trial note');
  assert.strictEqual(orderPaints[0].order.total, '$0.00', 'and nothing is due today');
});

test('#637: a server that never answers is UNKNOWN, not "not eligible"', async () => {
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
  assert.strictEqual(orderPaints.length, 1, 'the deadline resolved the money line, once');
  assert.strictEqual(orderPaints[0].order.trial.show, false, 'and quotes no trial the server never confirmed');
  assert.strictEqual(orderPaints[0].order.total, '$100.00', 'the full amount is due today');
  assert.deepStrictEqual([...form.resolved].sort(), ['eligibility', 'recaptcha'], 'the pay buttons are armed, not dead');

  await answerEligibility(true);

  assert.strictEqual(
    updates.filter((update) => update.order).length,
    1,
    'and a late answer never repaints the money line the visitor already read',
  );
});

test('#637: the pay buttons stay gated until eligibility and reCAPTCHA are both in', async () => {
  const { form, answerEligibility } = await bootCheckout();

  assert.deepStrictEqual([...form.gates].sort(), ['eligibility', 'recaptcha'], 'both answers gate the form');
  assert.deepStrictEqual(form.resolved, ['recaptcha'], 'reCAPTCHA settles on its own clock — this brand configures none');
  assert.strictEqual(form.ready, true, 'ready() was asked for during setup; the gates are what hold it');

  await answerEligibility(false);

  assert.deepStrictEqual([...form.resolved].sort(), ['eligibility', 'recaptcha'], 'the trial answer releases the last gate');
});

test('#637: the warmup ping goes out as a wakeup, before auth settles', async () => {
  const { requests, answerEligibility } = await bootCheckout();

  const wakeup = requests.find((request) => request.options.wakeup);
  assert.ok(wakeup, 'the page warms the backend through the shared client helper');
  assert.strictEqual(wakeup.url, WAKEUP_ROUTE, 'aimed at the one route every wakeup names');

  await answerEligibility(false);
});

test('#666: a subscription that sells no trial asks nothing and prices itself at once', async () => {
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

  assert.ok(
    !requests.some((request) => request.url.includes('trial-eligibility')),
    'no eligibility question goes out for a plan that sells no trial',
  );

  const orderPaints = updates.filter((update) => update.order);
  assert.strictEqual(orderPaints.length, 1, 'the money line is written once, on the same clock as the rest of the page');
  assert.strictEqual(orderPaints[0].order.total, '$100.00', 'and it quotes the full amount due today');
  assert.strictEqual(orderPaints[0].order.trial.show, false, 'with no trial note');
  assert.deepStrictEqual([...form.resolved].sort(), ['eligibility', 'recaptcha'], 'the pay buttons arm with no wait');
});
