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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');

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
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
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
    auth: { user: new User() },
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
    bindings: bundle.buildBindingsState(),
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'checkout-discount',
  tests: [
    {
      name: 'discount: a code the server accepts is applied, not rejected',
      run: async (ctx) => {
        const { ui, state } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20 });

        ctx.expect(ui.success, 'a server answer of valid=true must reach the success state').toBe(true);
        ctx.expect(ui.error, 'and must never render the invalid message').toBe(false);
        ctx.expect(ui.message, 'the percent comes off the parsed body').toBe('Discount applied: 20% off');
        ctx.expect(state.discountCode, 'the applied code is what the intent call sends').toBe('SAVE20');
        ctx.expect(state.discountPercent, 'and the percent is what the receipt rows price against').toBe(20);
      },
    },

    {
      name: 'discount: the validate call asks wonderful-fetch to parse the body',
      run: async (ctx) => {
        const { calls } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20 });

        ctx.expect(calls.length, 'one validation request per apply').toBe(1);
        ctx.expect(calls[0].url, 'the discount route').toBe('https://api.test/omega/payments/discount');
        ctx.expect(calls[0].options.query, 'the code is normalized before it is sent').toEqual({ code: 'SAVE20' });
        ctx.expect(calls[0].options.response, 'without this wonderful-fetch returns the raw Response and .valid is undefined forever').toBe('json');
      },
    },

    {
      name: 'discount: a percent code prices the receipt against the percent',
      run: async (ctx) => {
        // The shape that always worked, pinned beside the amount shape below: the
        // two must stay computed the same way.
        const { bindings } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20, duration: 'once' });

        ctx.expect(bindings.checkout.discount.hasDiscount, 'the receipt shows a discount row').toBe(true);
        ctx.expect(bindings.checkout.discount.label, 'labelled by the percent it takes off').toBe('20%');
        ctx.expect(bindings.checkout.discount.amount, '20% of $100').toBe('20.00');
        ctx.expect(bindings.order.total, 'and the total is what the card will be charged').toBe('$80.00');
      },
    },

    {
      name: 'discount: an amount code is money off, not an undefined percent',
      run: async (ctx) => {
        // The backend also issues FLAT codes — `{ amount: 10, duration: 'once' }`,
        // no `percent` key at all (the seeded WELCOME10OFF). The client read
        // `result.percent`, so the message said "undefined% off" and the summary
        // reported no discount at all — while the backend went on to charge one.
        const { ui, state, bindings } = await applyCode('welcome10off', { valid: true, code: 'WELCOME10OFF', amount: 10, duration: 'once' });

        ctx.expect(ui.success, 'a valid flat code is applied').toBe(true);
        ctx.expect(ui.message, 'and says what it takes off, in the page\'s money format').toBe('Discount applied: $10.00 off');
        ctx.expect(state.discountAmount, 'the amount is what the receipt prices against').toBe(10);
        ctx.expect(state.discountPercent, 'there is no percent in this shape').toBe(0);

        ctx.expect(bindings.checkout.discount.hasDiscount, 'the receipt shows the discount the backend WILL charge').toBe(true);
        ctx.expect(bindings.checkout.discount.amount, '$10 off the first charge').toBe('10.00');
        ctx.expect(bindings.checkout.discount.label, 'labelled by the code — "$10.00" beside "-$10.00" says it twice').toBe('WELCOME10OFF');
        ctx.expect(bindings.order.total, '$100 less $10 due today').toBe('$90.00');
        ctx.expect(bindings.order.termsText, 'and the first-payment-only note still rides along').toMatch(/first payment only/);

        ctx.expect(!JSON.stringify(bindings).includes('undefined'), 'no binding renders the word undefined').toBeTruthy();
      },
    },

    {
      name: 'discount: a once code discounts today and leaves the renewal at list price (#254)',
      run: async (ctx) => {
        // The receipt used to reduce the recurring row too, so a $100 plan with a
        // 15% code advertised a $85 renewal the backend charges $100 for. The
        // server's own `duration` is what decides it now, in BOTH code shapes.
        const percent = await applyCode('welcome15', { valid: true, code: 'WELCOME15', percent: 15, duration: 'once' });

        ctx.expect(percent.state.discountDuration, 'the server\'s duration reaches the state').toBe('once');
        ctx.expect(percent.bindings.order.total, 'the discount comes off today').toBe('$85.00');
        ctx.expect(percent.bindings.order.termsText, 'the terms line quotes the list-price renewal we will actually charge').toMatch(/renew on .* for \$100\.00/);

        const amount = await applyCode('welcome10off', { valid: true, code: 'WELCOME10OFF', amount: 10, duration: 'once' });

        ctx.expect(amount.bindings.order.total, 'the flat shape comes off today the same way').toBe('$90.00');
        ctx.expect(amount.bindings.order.termsText, 'and its terms line leaves the renewal at list price too').toMatch(/renew on .* for \$100\.00/);
      },
    },

    {
      name: 'discount: a trial + a once code quotes the DISCOUNTED first charge (#254)',
      run: async (ctx) => {
        // The trial terms line names the charge that lands when the trial ends, and
        // that charge IS the first invoice — the one the `once` coupon is attached to
        // (intent/providers/stripe.js sends `discounts: [{ coupon }]` alongside
        // `trial_period_days`). Quoting list price there promised a bigger first
        // charge than the card will actually see, which is the #254 mistake pointing
        // the other way.
        const { bindings } = await applyCode(
          'welcome15',
          { valid: true, code: 'WELCOME15', percent: 15, duration: 'once' },
          TRIAL_PRODUCT,
          { trialEligible: true },
        );

        ctx.expect(bindings.order.total, 'nothing is due today — it is a free trial').toBe('$0.00');
        ctx.expect(bindings.order.termsText, 'the first charge after the trial carries the discount').toMatch(/charged \$85\.00/);
        ctx.expect(bindings.order.termsText, 'and every renewal after it is list price').toMatch(/renews at \$100\.00/);
      },
    },

    {
      name: 'discount: a trial with no code quotes list price, unchanged (#254)',
      run: async (ctx) => {
        const { bindings } = await applyCode('nope', { valid: false }, TRIAL_PRODUCT, { trialEligible: true });

        ctx.expect(bindings.checkout.discount.hasDiscount, 'no discount was applied').toBe(false);
        ctx.expect(bindings.order.termsText, 'so the first charge is the list price').toMatch(/charged \$100\.00/);
        ctx.expect(!/renews at/.test(bindings.order.termsText), 'and there is no second price to explain').toBeTruthy();
      },
    },

    {
      name: 'trial: the length is the catalog\'s number, never a framework constant (#273)',
      run: async (ctx) => {
        // A trial is CATALOG data, so every sentence that names its length reads the
        // product — the message AND the renewal date the terms line computes. Pinned
        // with a 3-day plan precisely because 3 is not the constant the fallbacks
        // used to reach for.
        const short = { ...PRODUCT, trial: { days: 3 } };
        const { bindings } = await applyCode('nope', { valid: false }, short, { trialEligible: true });

        ctx.expect(bindings.order.trial.message, 'the message states the real length').toBe('Start your 3-day free trial today!');

        const renewal = new Date();
        renewal.setDate(renewal.getDate() + 3);
        const formatted = renewal.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        ctx.expect(bindings.order.termsText.includes(formatted), 'and the first charge lands 3 days out, not 7').toBeTruthy();
      },
    },

    {
      name: 'discount: a code the server rejects still lands the error message',
      run: async (ctx) => {
        const { ui, state, bindings } = await applyCode('nope', { valid: false });

        ctx.expect(ui.error, 'an invalid code is still an error').toBe(true);
        ctx.expect(ui.success, 'and never a success').toBe(false);
        ctx.expect(ui.message, 'with the message the bindings show').toBe('Invalid discount code');
        ctx.expect(state.discountCode, 'nothing is carried into the intent call').toBe(null);
        ctx.expect(state.discountPercent, 'and the receipt keeps full price').toBe(0);
        ctx.expect(state.discountAmount, 'in either shape').toBe(0);
        ctx.expect(bindings.checkout.discount.hasDiscount, 'so the receipt shows no discount row').toBe(false);
        ctx.expect(bindings.order.total, 'and charges full price').toBe('$100.00');
      },
    },

    {
      name: 'discount: an empty code asks for one instead of calling the server',
      run: async (ctx) => {
        const { ui, calls } = await applyCode('   ', { valid: true, code: 'X', percent: 5 });

        ctx.expect(calls.length, 'an empty field is answered locally').toBe(0);
        ctx.expect(ui.error, 'and reads as an error').toBe(true);
        ctx.expect(ui.message, 'with the prompt, not the rejection').toBe('Please enter a discount code');
      },
    },
  ],
});
