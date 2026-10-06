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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');
const { clientConfig } = require('@omega.js/config');

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

// The capability table exactly as the build bakes it beside the providers
const CAPABILITIES = clientConfig({ payment: {} }).payment.capabilities;

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

/**
 * A loaded checkout page for one product: apply codes against a stubbed server
 * answer and read the bindings the buttons would have been drawn from.
 *
 * @param {object} product - the catalog product on the page
 * @param {object} [options] - `providers` (the brand's `payment.providers`),
 *   `capabilities` (the baked table) and `trialEligible`, the server's answer
 *   the DISPLAY reads
 */
async function openCheckout(product, { providers = ALL_PROVIDERS, capabilities = CAPABILITIES, trialEligible = false } = {}) {
  await bundleOnce();

  let answer = { valid: false };

  globalThis.window = { location: { search: '' } };
  globalThis.__omegaClient = {
    isDevelopment: () => false,
    getApiUrl: () => 'https://api.test',
    auth: { user: new User() },
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
  bundle.state.capabilities = capabilities;
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

module.exports = defineCases({
  type: 'group',
  description: 'checkout-zero-total',
  tests: [
    {
      name: '#786: a code that covers the whole one-time price takes PayPal and crypto away',
      run: async (ctx) => {
        const page = await openCheckout(CHEAP_ONE_TIME);

        const before = page.bindings();
        ctx.expect(before.checkout.paymentMethods.paypal, 'both are offered at list price').toBe(true);
        ctx.expect(before.checkout.paymentMethods.crypto, 'including crypto on a one-time buy').toBe(true);

        const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

        ctx.expect(bound.order.total, '$10 off $9.99 leaves nothing to charge').toBe('$0.00');
        ctx.expect(bound.checkout.paymentMethods.paypal, 'PayPal cannot take a $0.00 order').toBe(false);
        ctx.expect(bound.checkout.paymentMethods.crypto, 'nor Coinbase Commerce a $0.00 charge').toBe(false);
        ctx.expect(bound.checkout.paymentMethods.card, 'card checkout is untouched — Stripe takes a real coupon').toBe(true);
        ctx.expect(bound.checkout.discount.hasDiscount, 'and the receipt still shows the code that did it').toBe(true);
      },
    },

    {
      name: '#786: removing the code brings both buttons straight back',
      run: async (ctx) => {
        const page = await openCheckout(CHEAP_ONE_TIME);

        await page.apply('welcome10off', FULL_PRICE_CODE);

        // The page rebuilds its bindings on every discount change, so a rejected code
        // (which clears the applied one) is the same lane a cleared field takes
        const bound = await page.apply('nope', { valid: false });

        ctx.expect(bound.checkout.discount.hasDiscount, 'the code is gone').toBe(false);
        ctx.expect(bound.order.total, 'so the full price is due again').toBe('$9.99');
        ctx.expect(bound.checkout.paymentMethods.paypal, 'PayPal is back').toBe(true);
        ctx.expect(bound.checkout.paymentMethods.crypto, 'and so is crypto').toBe(true);
      },
    },

    {
      name: '#786: a code that only discounts leaves every button alone',
      run: async (ctx) => {
        const page = await openCheckout(CHEAP_ONE_TIME);

        const bound = await page.apply('save10', PARTIAL_CODE);

        ctx.expect(bound.order.total, 'there is still something to charge').toBe('$8.99');
        ctx.expect(bound.checkout.paymentMethods.paypal, 'so PayPal stays').toBe(true);
        ctx.expect(bound.checkout.paymentMethods.crypto, 'and crypto with it').toBe(true);
      },
    },

    {
      name: '#786: a fully discounted plan hides PayPal too',
      run: async (ctx) => {
        // A subscription's zero total is the setup-fee half of the same bug (#759):
        // the discounted first period rides the create call as a $0.00 setup fee.
        const page = await openCheckout(CHEAP_PLAN);

        const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

        ctx.expect(bound.order.total, '$10 off a $10.00 month').toBe('$0.00');
        ctx.expect(bound.checkout.paymentMethods.paypal, 'PayPal has no first period to charge').toBe(false);
        ctx.expect(bound.checkout.paymentMethods.card, 'the card button still sells it').toBe(true);
      },
    },

    {
      name: '#786: a free trial charges $0.00 today and keeps its buttons',
      run: async (ctx) => {
        // A trial charges nothing today through PayPal's OWN plan cycle, not through
        // an amount we send (#761) — so the trial's $0.00 total must never be read as
        // a fully discounted checkout. The eligibility is the SERVER's answer, and
        // the page only quotes a trial once it has one (#637), so it is set here.
        const page = await openCheckout(TRIAL_PLAN, { trialEligible: true });

        const bound = page.bindings();

        ctx.expect(bound.order.trial.show, 'the page really is quoting the trial').toBe(true);
        ctx.expect(bound.order.total, 'and nothing at all is due today').toBe('$0.00');
        ctx.expect(bound.checkout.paymentMethods.paypal, 'PayPal takes a trial subscription — the plan cycle charges the $0.00, not us').toBe(true);
      },
    },

    {
      name: '#786: a full-covering code on a TRIAL checkout still keeps both buttons',
      run: async (ctx) => {
        // The two ends have to agree: the backend skips the zero-charge guard
        // outright while a trial is being taken (`takingTrial` in
        // intent/providers/paypal.js), because the code comes off the first PAID
        // period, not today. A page that hid the button here would refuse a checkout
        // the backend would have accepted.
        const page = await openCheckout(TRIAL_PLAN, { trialEligible: true });

        const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

        ctx.expect(bound.checkout.discount.hasDiscount, 'the code really is applied').toBe(true);
        ctx.expect(bound.order.total, 'and today is still free, as it was without it').toBe('$0.00');
        ctx.expect(bound.checkout.paymentMethods.paypal, 'so PayPal stays — the backend accepts this exact checkout').toBe(true);
        ctx.expect(bound.checkout.discount.error, 'and nothing is refused on the discount line').toBe(false);
      },
    },

    {
      name: '#759: the discount note no longer claims PayPal cannot take a code',
      run: async (ctx) => {
        const page = await openCheckout(CHEAP_PLAN);

        const bound = await page.apply('save10', PARTIAL_CODE);

        ctx.expect(bound.order.termsText, 'the half that is still true is still said').toMatch(/Discount code applies to first payment only\./);
        ctx.expect(bound.order.termsText, 'a PayPal subscription takes the code as a discounted first period (#759)').not.toMatch(/PayPal/);
      },
    },

    {
      name: '#786: a PayPal-only brand says why the grid emptied, and takes it back',
      run: async (ctx) => {
        // The page's only "no payment methods" sentence is an init-time read of the
        // provider CONFIG, so a brand selling through PayPal and crypto alone showed
        // an empty button grid and nothing else. The message goes where the remedy
        // is — the discount field's own error line, beside the code that has to come
        // back off.
        const page = await openCheckout(CHEAP_ONE_TIME, { providers: { paypal: { clientId: 'paypal-client-id' }, coinbase: { enabled: true } } });

        const bound = await page.apply('welcome10off', FULL_PRICE_CODE);
        const methods = bound.checkout.paymentMethods;

        ctx.expect(!Object.values(methods).some(Boolean), `every method is gone: ${JSON.stringify(methods)}`).toBeTruthy();
        ctx.expect(bound.checkout.discount.error, 'so the page says so').toBe(true);
        ctx.expect(bound.checkout.discount.success, 'and never as a success the buyer cannot act on').toBe(false);
        ctx.expect(bound.checkout.discount.errorMessage, 'the message names the code that did it').toMatch(/WELCOME10OFF/);
        ctx.expect(bound.checkout.discount.errorMessage, 'and tells the buyer how to get the buttons back').toMatch(/Remove the code/);
        ctx.expect(bound.checkout.error.show, 'the page-level error stays down — it would hide the discount field with the rest of the checkout').toBe(false);

        const cleared = await page.apply('nope', { valid: false });

        ctx.expect(cleared.checkout.paymentMethods.paypal, 'removing the code brings the button back').toBe(true);
        ctx.expect(cleared.checkout.discount.errorMessage, 'and the blocked message is gone with it').toBe('Invalid discount code');
      },
    },

    {
      name: '#786: a card brand with a full code keeps a way to pay, and no refusal',
      run: async (ctx) => {
        // The message is for an EMPTY grid only: a brand with a card provider still
        // sells this checkout, and Stripe decides what a $0.00 total means there.
        const page = await openCheckout(CHEAP_ONE_TIME);

        const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

        ctx.expect(bound.checkout.paymentMethods.card, 'card checkout is still offered').toBe(true);
        ctx.expect(bound.checkout.discount.error, 'so nothing is refused').toBe(false);
        ctx.expect(bound.checkout.discount.success, 'and the applied code still reads as applied').toBe(true);
      },
    },

    {
      name: '#849: the $0 hide-set is the capability table, never a provider name',
      run: async (ctx) => {
        // Flip the table and the same $0 checkout keeps both buttons: nothing in the
        // page knows PayPal or Coinbase by name, only what their rows say
        const acceptsZero = Object.fromEntries(Object.entries(CAPABILITIES).map(([id, row]) => [id, { ...row, acceptsZeroCharge: true }]));
        const page = await openCheckout(CHEAP_ONE_TIME, { capabilities: acceptsZero });

        const bound = await page.apply('welcome10off', FULL_PRICE_CODE);

        ctx.expect(bound.order.total, 'the code still covers the price').toBe('$0.00');
        ctx.expect(bound.checkout.paymentMethods.paypal, 'a row that takes $0 keeps PayPal').toBe(true);
        ctx.expect(bound.checkout.paymentMethods.crypto, 'and crypto').toBe(true);

        // And a card provider whose row refuses $0 loses the card button the same way
        const cardRefuses = { ...CAPABILITIES, stripe: { ...CAPABILITIES.stripe, acceptsZeroCharge: false } };
        const strict = await openCheckout(CHEAP_ONE_TIME, { capabilities: cardRefuses });

        ctx.expect((await strict.apply('welcome10off', FULL_PRICE_CODE)).checkout.paymentMethods.card, 'the card button follows its row').toBe(false);
      },
    },

    {
      name: '#786: the buttons this flag governs are the ones the layout binds to it',
      run: async (ctx) => {
        // The flags above are only real because the shipped buttons are `@show`
        // bindings on exactly these paths — the seam between this state and the DOM.
        const layout = fs.readFileSync(CHECKOUT_LAYOUT, 'utf8');

        for (const method of ['paypal', 'crypto']) {
          ctx.expect(layout.includes(`data-omega-bind="@show checkout.paymentMethods.${method}"`), `the ${method} button shows only while checkout.paymentMethods.${method} is true`).toBeTruthy();
        }
      },
    },
  ],
});
