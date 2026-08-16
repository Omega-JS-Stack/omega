/**
 * The checkout discount code, client end (`core/js/pages/payment/checkout/
 * modules/discount.js` + `modules/api.js`) — a code the server accepts must
 * land as an APPLIED discount, not as "Invalid discount code".
 *
 * The bug this pins: wonderful-fetch defaults `response` to `'raw'`, so a call
 * made without `response: 'json'` hands back the untouched Response and every
 * body property (`.valid`, `.percent`) reads `undefined` — so every code, valid
 * or not, fell into the invalid branch while the server logged `valid=true`.
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL files through esbuild —
 * the convention auth-policy.test.js and checkout-decline.test.js set — with
 * the client and wonderful-fetch stubbed. The fetch stub MODELS wonderful-fetch
 * rather than short-circuiting it: it returns a Response-shaped object unless
 * the caller asked for `response: 'json'`, which is what makes the parsing bug
 * reproducible here at all. The assertion is the discount UI state the bindings
 * would have rendered.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-discount-'));
const BUNDLE = path.join(BUNDLE_DIR, 'discount.cjs');

let building = null;

// One entry exporting both seams, so the REAL discount module and the REAL
// state module it mutates stay the same instance (a separate bundle each would
// hand the test a second, unrelated `state`).
function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: [
        `export { applyDiscountCode } from './discount.js';`,
        `export { state, buildBindingsState } from './state.js';`,
      ].join('\n'),
      resolveDir: MODULES_DIR,
      loader: 'js',
    },
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^wonderful-fetch$/ }, () => {
          return { path: 'fetch', namespace: 'wonderful-fetch-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'wonderful-fetch-stub' }, () => {
          return { contents: 'export default (...args) => globalThis.__wonderfulFetch(...args);' };
        });
      },
    }],
  });

  return building;
}

// The plan the summary prices against: $100 a year, the state's default cycle.
const PRODUCT = { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 100 } };

// The same plan sold with a free trial, for the cases where the trial is what
// changes the sentence the receipt writes.
const TRIAL_PRODUCT = { ...PRODUCT, trial: { days: 14 } };

/**
 * Apply one code against a stubbed server answer; hand back the discount UI
 * state, the mutated state, the request the module actually made, and the
 * bindings the receipt would have rendered from it.
 *
 * @param {string} code - what the shopper typed
 * @param {object} answer - the server's validate() body
 * @param {object} [product] - the product on the page (defaults to PRODUCT)
 * @param {object} [options] - `trialEligible`, the flag the trial routes read
 */
async function applyCode(code, answer, product = PRODUCT, { trialEligible = false } = {}) {
  await bundleOnce();

  const calls = [];

  globalThis.window = { location: { search: '' } };
  globalThis.__omegaClient = {
    getApiUrl: () => 'https://api.test',
    auth: () => ({ getUser: () => null }),
  };
  globalThis.__wonderfulFetch = async (url, options = {}) => {
    calls.push({ url, options });

    // wonderful-fetch's own contract: `response` defaults to 'raw', and a raw
    // answer is the Response object — the body is only reachable via .json().
    if (options.response === 'json') {
      return answer;
    }

    return { ok: true, status: 200, headers: {}, json: async () => answer };
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);

  bundle.state.product = product;
  bundle.state.trialEligible = trialEligible;

  const renders = [];
  await bundle.applyDiscountCode(code, () => renders.push(bundle.state.discountUI));

  return {
    ui: bundle.state.discountUI,
    state: bundle.state,
    calls,
    renders,
    bindings: bundle.buildBindingsState().checkout,
  };
}

test('discount: a code the server accepts is applied, not rejected', async () => {
  const { ui, state } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20 });

  assert.strictEqual(ui.success, true, 'a server answer of valid=true must reach the success state');
  assert.strictEqual(ui.error, false, 'and must never render the invalid message');
  assert.strictEqual(ui.message, 'Discount applied: 20% off', 'the percent comes off the parsed body');
  assert.strictEqual(state.discountCode, 'SAVE20', 'the applied code is what the intent call sends');
  assert.strictEqual(state.discountPercent, 20, 'and the percent is what the receipt rows price against');
});

test('discount: the validate call asks wonderful-fetch to parse the body', async () => {
  const { calls } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20 });

  assert.strictEqual(calls.length, 1, 'one validation request per apply');
  assert.strictEqual(calls[0].url, 'https://api.test/omega/payments/discount', 'the discount route');
  assert.deepStrictEqual(calls[0].options.query, { code: 'SAVE20' }, 'the code is normalized before it is sent');
  assert.strictEqual(
    calls[0].options.response,
    'json',
    'without this wonderful-fetch returns the raw Response and .valid is undefined forever',
  );
});

test('discount: a percent code prices the receipt against the percent', async () => {
  // The shape that always worked, pinned beside the amount shape below: the
  // two must stay computed the same way.
  const { bindings } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20, duration: 'once' });

  assert.strictEqual(bindings.discount.hasDiscount, true, 'the receipt shows a discount row');
  assert.strictEqual(bindings.discount.label, '20%', 'labelled by the percent it takes off');
  assert.strictEqual(bindings.discount.amount, '20.00', '20% of $100');
  assert.strictEqual(bindings.pricing.total, '$80.00', 'and the total is what the card will be charged');
});

test('discount: an amount code is money off, not an undefined percent', async () => {
  // The backend also issues FLAT codes — `{ amount: 10, duration: 'once' }`,
  // no `percent` key at all (the seeded WELCOME10OFF). The client read
  // `result.percent`, so the message said "undefined% off" and the summary
  // reported no discount at all — while the backend went on to charge one.
  const { ui, state, bindings } = await applyCode('welcome10off', { valid: true, code: 'WELCOME10OFF', amount: 10, duration: 'once' });

  assert.strictEqual(ui.success, true, 'a valid flat code is applied');
  assert.strictEqual(ui.message, 'Discount applied: $10.00 off', 'and says what it takes off, in the page\'s money format');
  assert.strictEqual(state.discountAmount, 10, 'the amount is what the receipt prices against');
  assert.strictEqual(state.discountPercent, 0, 'there is no percent in this shape');

  assert.strictEqual(bindings.discount.hasDiscount, true, 'the receipt shows the discount the backend WILL charge');
  assert.strictEqual(bindings.discount.amount, '10.00', '$10 off the first charge');
  assert.strictEqual(bindings.discount.label, 'WELCOME10OFF', 'labelled by the code — "$10.00" beside "-$10.00" says it twice');
  assert.strictEqual(bindings.pricing.total, '$90.00', '$100 less $10 due today');
  assert.match(bindings.pricing.termsText, /first payment only/, 'and the first-payment-only note still rides along');

  assert.ok(!JSON.stringify(bindings).includes('undefined'), 'no binding renders the word undefined');
});

test('discount: a once code discounts today and leaves the renewal at list price (#254)', async () => {
  // The receipt used to reduce the recurring row too, so a $100 plan with a
  // 15% code advertised a $85 renewal the backend charges $100 for. The
  // server's own `duration` is what decides it now, in BOTH code shapes.
  const percent = await applyCode('welcome15', { valid: true, code: 'WELCOME15', percent: 15, duration: 'once' });

  assert.strictEqual(percent.state.discountDuration, 'once', 'the server\'s duration reaches the state');
  assert.strictEqual(percent.bindings.pricing.total, '$85.00', 'the discount comes off today');
  assert.strictEqual(percent.bindings.pricing.recurringAmount, '$100.00', 'the renewal is the price we will actually charge');
  assert.match(percent.bindings.pricing.termsText, /renew on .* for \$100\.00/, 'and the terms line quotes the same renewal');

  const amount = await applyCode('welcome10off', { valid: true, code: 'WELCOME10OFF', amount: 10, duration: 'once' });

  assert.strictEqual(amount.bindings.pricing.total, '$90.00', 'the flat shape comes off today the same way');
  assert.strictEqual(amount.bindings.pricing.recurringAmount, '$100.00', 'and leaves the renewal at list price too');
});

test('discount: a trial + a once code quotes the DISCOUNTED first charge (#254)', async () => {
  // The trial terms line names the charge that lands when the trial ends, and
  // that charge IS the first invoice — the one the `once` coupon is attached to
  // (intent/processors/stripe.js sends `discounts: [{ coupon }]` alongside
  // `trial_period_days`). Quoting list price there promised a bigger first
  // charge than the card will actually see, which is the #254 mistake pointing
  // the other way.
  const { bindings } = await applyCode(
    'welcome15',
    { valid: true, code: 'WELCOME15', percent: 15, duration: 'once' },
    TRIAL_PRODUCT,
    { trialEligible: true },
  );

  assert.strictEqual(bindings.pricing.total, '$0.00', 'nothing is due today — it is a free trial');
  assert.match(bindings.pricing.termsText, /charged \$85\.00/, 'the first charge after the trial carries the discount');
  assert.match(bindings.pricing.termsText, /renews at \$100\.00/, 'and every renewal after it is list price');
});

test('discount: a trial with no code quotes list price, unchanged (#254)', async () => {
  const { bindings } = await applyCode('nope', { valid: false }, TRIAL_PRODUCT, { trialEligible: true });

  assert.strictEqual(bindings.discount.hasDiscount, false, 'no discount was applied');
  assert.match(bindings.pricing.termsText, /charged \$100\.00/, 'so the first charge is the list price');
  assert.ok(!/renews at/.test(bindings.pricing.termsText), 'and there is no second price to explain');
});

test('trial: the length is the catalog\'s number, never a framework constant (#273)', async () => {
  // A trial is CATALOG data, so every sentence that names its length reads the
  // product — the message AND the renewal date the terms line computes. Pinned
  // with a 3-day plan precisely because 3 is not the constant the fallbacks
  // used to reach for.
  const short = { ...PRODUCT, trial: { days: 3 } };
  const { bindings } = await applyCode('nope', { valid: false }, short, { trialEligible: true });

  assert.strictEqual(bindings.trial.message, 'Start your 3-day free trial today!', 'the message states the real length');

  const renewal = new Date();
  renewal.setDate(renewal.getDate() + 3);
  const formatted = renewal.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  assert.ok(bindings.pricing.termsText.includes(formatted), 'and the first charge lands 3 days out, not 7');
});

test('discount: a code the server rejects still lands the error message', async () => {
  const { ui, state, bindings } = await applyCode('nope', { valid: false });

  assert.strictEqual(ui.error, true, 'an invalid code is still an error');
  assert.strictEqual(ui.success, false, 'and never a success');
  assert.strictEqual(ui.message, 'Invalid discount code', 'with the message the bindings show');
  assert.strictEqual(state.discountCode, null, 'nothing is carried into the intent call');
  assert.strictEqual(state.discountPercent, 0, 'and the receipt keeps full price');
  assert.strictEqual(state.discountAmount, 0, 'in either shape');
  assert.strictEqual(bindings.discount.hasDiscount, false, 'so the receipt shows no discount row');
  assert.strictEqual(bindings.pricing.total, '$100.00', 'and charges full price');
});

test('discount: an empty code asks for one instead of calling the server', async () => {
  const { ui, calls } = await applyCode('   ', { valid: true, code: 'X', percent: 5 });

  assert.strictEqual(calls.length, 0, 'an empty field is answered locally');
  assert.strictEqual(ui.error, true, 'and reads as an error');
  assert.strictEqual(ui.message, 'Please enter a discount code', 'with the prompt, not the rejection');
});
