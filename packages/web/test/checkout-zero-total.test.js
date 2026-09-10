/**
 * /payment/checkout — a code that covers the WHOLE total takes the PayPal and
 * crypto buttons away ([#786](https://github.com/Omega-JS-Stack/omega/issues/786)).
 *
 * PayPal and Coinbase are the two providers whose amount THIS framework
 * computes and sends, and neither API accepts a zero one — so the backend now
 * refuses that checkout before it reaches them (`chargeableAmount()` in the
 * backend's libraries/payment/discount-codes.js). A button that could only ever
 * end in that refusal is not offered: the same reasoning #642 hid the crypto
 * button on a subscription with. Card checkout is untouched — Stripe and
 * Chargebee take a real coupon and decide for themselves.
 *
 * The buttons come back the moment the code does: the page rebuilds its whole
 * bindings object on every discount change, so this is one flag inside
 * `buildBindingsState()` and no new state.
 *
 * Also pinned: the terms note. "not available with PayPal" stopped being true
 * with [#759](https://github.com/Omega-JS-Stack/omega/issues/759) — a PayPal
 * subscription takes the code as a discounted first period — so the sentence
 * now says only what is still true of every code.
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL discount module and the
 * REAL state module it mutates through esbuild — the convention
 * checkout-discount.test.js and checkout-crypto.test.js set. The buttons
 * themselves are `@show` bindings on those flags, which the last case reads out
 * of the shipped layout.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules');
const CHECKOUT_LAYOUT = path.join(__dirname, '..', 'themes', 'base', '_layouts', 'frontend', 'pages', 'payment', 'checkout.html');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-zero-total-'));
const BUNDLE = path.join(BUNDLE_DIR, 'checkout.cjs');

// A brand with every method switched on, so a missing button is always the
// discount's doing and never a configuration hole
const ALL_PROVIDERS = {
  stripe: { publishableKey: 'pk_test_123' },
  paypal: { clientId: 'paypal-client-id' },
  coinbase: { enabled: true },
};

// The two products the shipped $10 code can swallow whole
const CHEAP_ONE_TIME = { id: 'pocket-guide', name: 'Pocket Guide', type: 'one-time', prices: { once: 9.99 } };
const CHEAP_PLAN = { id: 'pocket-plan', name: 'Pocket Plan', type: 'subscription', prices: { monthly: 10 } };

// The same plan sold with a free trial: nothing is charged today whatever code
// rides along, which is the case the zero-total rule must NOT claim
const TRIAL_PLAN = { ...CHEAP_PLAN, trial: { days: 7 } };

// The server's answers: the flat code that covers these prices, and a percent
// code that leaves something to charge
const FULL_PRICE_CODE = { valid: true, code: 'WELCOME10OFF', amount: 10, duration: 'once' };
const PARTIAL_CODE = { valid: true, code: 'SAVE10', percent: 10, duration: 'once' };

let building = null;

// One entry exporting both seams, so the REAL discount module and the REAL
// state module it mutates stay the same instance
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

/**
 * A loaded checkout page for one product: apply codes against a stubbed server
 * answer and read the bindings the buttons would have been drawn from.
 *
 * @param {object} product - the catalog product on the page
 * @param {object} [options] - `providers` (the brand's `payment.providers`) and
 *   `trialEligible`, the server's answer the DISPLAY reads (#637)
 */
async function openCheckout(product, { providers = ALL_PROVIDERS, trialEligible = false } = {}) {
  await bundleOnce();

  let answer = { valid: false };

  globalThis.window = { location: { search: '' } };
  globalThis.__omegaClient = {
    isDevelopment: () => false,
    getApiUrl: () => 'https://api.test',
    auth: () => ({ getUser: () => null }),
  };
  globalThis.__wonderfulFetch = async (url, options = {}) => {
    return options.response === 'json' ? answer : { ok: true, status: 200, headers: {}, json: async () => answer };
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);

  bundle.state.product = product;
  bundle.state.frequency = product.type === 'subscription' ? 'monthly' : 'once';
  bundle.state.providers = providers;
  bundle.state.trialEligible = trialEligible;

  return {
    bindings: () => bundle.buildBindingsState(),
    async apply(code, serverAnswer) {
      answer = serverAnswer;
      await bundle.applyDiscountCode(code, () => {});

      return bundle.buildBindingsState();
    },
  };
}

test('#786: a code that covers the whole one-time price takes PayPal and crypto away', async () => {
  const page = await openCheckout(CHEAP_ONE_TIME);

  const before = page.bindings();
  assert.strictEqual(before.checkout.paymentMethods.paypal, true, 'both are offered at list price');
  assert.strictEqual(before.checkout.paymentMethods.crypto, true, 'including crypto on a one-time buy');

  const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

  assert.strictEqual(bound.order.total, '$0.00', '$10 off $9.99 leaves nothing to charge');
  assert.strictEqual(bound.checkout.paymentMethods.paypal, false, 'PayPal cannot take a $0.00 order');
  assert.strictEqual(bound.checkout.paymentMethods.crypto, false, 'nor Coinbase Commerce a $0.00 charge');
  assert.strictEqual(bound.checkout.paymentMethods.card, true, 'card checkout is untouched — Stripe takes a real coupon');
  assert.strictEqual(bound.checkout.discount.hasDiscount, true, 'and the receipt still shows the code that did it');
});

test('#786: removing the code brings both buttons straight back', async () => {
  const page = await openCheckout(CHEAP_ONE_TIME);

  await page.apply('welcome10off', FULL_PRICE_CODE);

  // The page rebuilds its bindings on every discount change, so a rejected code
  // (which clears the applied one) is the same lane a cleared field takes
  const bound = await page.apply('nope', { valid: false });

  assert.strictEqual(bound.checkout.discount.hasDiscount, false, 'the code is gone');
  assert.strictEqual(bound.order.total, '$9.99', 'so the full price is due again');
  assert.strictEqual(bound.checkout.paymentMethods.paypal, true, 'PayPal is back');
  assert.strictEqual(bound.checkout.paymentMethods.crypto, true, 'and so is crypto');
});

test('#786: a code that only discounts leaves every button alone', async () => {
  const page = await openCheckout(CHEAP_ONE_TIME);

  const bound = await page.apply('save10', PARTIAL_CODE);

  assert.strictEqual(bound.order.total, '$8.99', 'there is still something to charge');
  assert.strictEqual(bound.checkout.paymentMethods.paypal, true, 'so PayPal stays');
  assert.strictEqual(bound.checkout.paymentMethods.crypto, true, 'and crypto with it');
});

test('#786: a fully discounted plan hides PayPal too', async () => {
  // A subscription's zero total is the setup-fee half of the same bug (#759):
  // the discounted first period rides the create call as a $0.00 setup fee.
  const page = await openCheckout(CHEAP_PLAN);

  const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

  assert.strictEqual(bound.order.total, '$0.00', '$10 off a $10.00 month');
  assert.strictEqual(bound.checkout.paymentMethods.paypal, false, 'PayPal has no first period to charge');
  assert.strictEqual(bound.checkout.paymentMethods.card, true, 'the card button still sells it');
});

test('#786: a free trial charges $0.00 today and keeps its buttons', async () => {
  // A trial charges nothing today through PayPal's OWN plan cycle, not through
  // an amount we send (#761) — so the trial's $0.00 total must never be read as
  // a fully discounted checkout. The eligibility is the SERVER's answer, and
  // the page only quotes a trial once it has one (#637), so it is set here.
  const page = await openCheckout(TRIAL_PLAN, { trialEligible: true });

  const bound = page.bindings();

  assert.strictEqual(bound.order.trial.show, true, 'the page really is quoting the trial');
  assert.strictEqual(bound.order.total, '$0.00', 'and nothing at all is due today');
  assert.strictEqual(bound.checkout.paymentMethods.paypal, true, 'PayPal takes a trial subscription — the plan cycle charges the $0.00, not us');
});

test('#786: a full-covering code on a TRIAL checkout still keeps both buttons', async () => {
  // The two ends have to agree: the backend skips the zero-charge guard
  // outright while a trial is being taken (`takingTrial` in
  // intent/providers/paypal.js), because the code comes off the first PAID
  // period, not today. A page that hid the button here would refuse a checkout
  // the backend would have accepted.
  const page = await openCheckout(TRIAL_PLAN, { trialEligible: true });

  const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

  assert.strictEqual(bound.checkout.discount.hasDiscount, true, 'the code really is applied');
  assert.strictEqual(bound.order.total, '$0.00', 'and today is still free, as it was without it');
  assert.strictEqual(bound.checkout.paymentMethods.paypal, true, 'so PayPal stays — the backend accepts this exact checkout');
  assert.strictEqual(bound.checkout.discount.error, false, 'and nothing is refused on the discount line');
});

test('#759: the discount note no longer claims PayPal cannot take a code', async () => {
  const page = await openCheckout(CHEAP_PLAN);

  const bound = await page.apply('save10', PARTIAL_CODE);

  assert.match(bound.order.termsText, /Discount code applies to first payment only\./, 'the half that is still true is still said');
  assert.doesNotMatch(bound.order.termsText, /PayPal/, 'a PayPal subscription takes the code as a discounted first period (#759)');
});

test('#786: a PayPal-only brand says why the grid emptied, and takes it back', async () => {
  // The page's only "no payment methods" sentence is an init-time read of the
  // provider CONFIG, so a brand selling through PayPal and crypto alone showed
  // an empty button grid and nothing else. The message goes where the remedy
  // is — the discount field's own error line, beside the code that has to come
  // back off.
  const page = await openCheckout(CHEAP_ONE_TIME, { providers: { paypal: { clientId: 'paypal-client-id' }, coinbase: { enabled: true } } });

  const bound = await page.apply('welcome10off', FULL_PRICE_CODE);
  const methods = bound.checkout.paymentMethods;

  assert.ok(!Object.values(methods).some(Boolean), `every method is gone: ${JSON.stringify(methods)}`);
  assert.strictEqual(bound.checkout.discount.error, true, 'so the page says so');
  assert.strictEqual(bound.checkout.discount.success, false, 'and never as a success the buyer cannot act on');
  assert.match(bound.checkout.discount.errorMessage, /WELCOME10OFF/, 'the message names the code that did it');
  assert.match(bound.checkout.discount.errorMessage, /Remove the code/, 'and tells the buyer how to get the buttons back');
  assert.strictEqual(bound.checkout.error.show, false, 'the page-level error stays down — it would hide the discount field with the rest of the checkout');

  const cleared = await page.apply('nope', { valid: false });

  assert.strictEqual(cleared.checkout.paymentMethods.paypal, true, 'removing the code brings the button back');
  assert.strictEqual(cleared.checkout.discount.errorMessage, 'Invalid discount code', 'and the blocked message is gone with it');
});

test('#786: a card brand with a full code keeps a way to pay, and no refusal', async () => {
  // The message is for an EMPTY grid only: a brand with a card provider still
  // sells this checkout, and Stripe decides what a $0.00 total means there.
  const page = await openCheckout(CHEAP_ONE_TIME);

  const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

  assert.strictEqual(bound.checkout.paymentMethods.card, true, 'card checkout is still offered');
  assert.strictEqual(bound.checkout.discount.error, false, 'so nothing is refused');
  assert.strictEqual(bound.checkout.discount.success, true, 'and the applied code still reads as applied');
});

test('#786: the buttons this flag governs are the ones the layout binds to it', async () => {
  // The flags above are only real because the shipped buttons are `@show`
  // bindings on exactly these paths — the seam between this state and the DOM.
  const layout = fs.readFileSync(CHECKOUT_LAYOUT, 'utf8');

  for (const method of ['paypal', 'crypto']) {
    assert.ok(
      layout.includes(`data-omega-bind="@show checkout.paymentMethods.${method}"`),
      `the ${method} button shows only while checkout.paymentMethods.${method} is true`,
    );
  }
});
