/**
 * /payment/checkout — a one-time product's summary line prices what is
 * actually being bought ([#558](https://github.com/Omega-JS-Stack/omega/issues/558)).
 *
 * The bug this pins: `buildBindingsState()` built `frequencyPaymentText` from
 * `product.prices[state.frequency]` — and `frequency` is the URL default
 * (`annually`) for every product, cadence or not. A one-time product has no
 * `annually` key, so the line under the product name read "$0.00 annually"
 * while SUBTOTAL and TOTAL DUE TODAY (which go through calculatePrices(), the
 * one place that knows the `once` key) correctly read $49.99. The buyer saw a
 * contradictory summary right before paying.
 *
 * The sibling of #282 on the confirmation side: `once` is not a cadence, so
 * nothing may say a cadence word about it.
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL state module through
 * esbuild — the convention checkout-discount.test.js sets — with the client
 * stubbed.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const { bootCheckout } = require('./lib/checkout-boot.js');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-one-time-'));
const BUNDLE = path.join(BUNDLE_DIR, 'state.cjs');

const CADENCE_WORDS = /daily|weekly|monthly|annually|annual/i;

// The playground's real one-time product: OMEGA Playground's Starter Library,
// the $49.99 buy the live drive found this on.
const ONE_TIME = { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: { once: 49.99 } };

// The plan beside it, so the fix cannot quiet the cadence line for everyone.
const SUBSCRIPTION = { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 100 } };

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [path.join(MODULES_DIR, 'state.js')],
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
      },
    }],
  });

  return building;
}

/** The checkout bindings for one product, as the page would build them. */
async function bindingsFor(product, { frequency = 'annually' } = {}) {
  await bundleOnce();

  globalThis.window = { location: { search: '' } };
  globalThis.__omegaClient = {
    isDevelopment: () => false,
    auth: () => ({ getUser: () => null }),
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const modules = require(BUNDLE);

  modules.state.product = product;
  modules.state.frequency = frequency;

  return modules.buildBindingsState();
}

test('#558: a one-time product\'s summary line reads the one-time price', async () => {
  const bound = await bindingsFor(ONE_TIME);

  assert.strictEqual(bound.checkout.product.isSubscription, false, 'a one-time buy is not a subscription');
  assert.strictEqual(
    bound.checkout.pricing.frequencyPaymentText,
    '$49.99 one-time',
    'the line under the product name prices the thing being bought',
  );
  assert.strictEqual(bound.checkout.pricing.subtotal, '$49.99', 'and agrees with the SUBTOTAL row');
  assert.strictEqual(bound.order.total, '$49.99', 'and with TOTAL DUE TODAY');
});

test('#558: nothing a one-time summary renders says a cadence word or $0.00', async () => {
  // The live symptom was one line, but the whole pricing block is what the
  // summary renders — no value in it may claim a recurring charge that does
  // not exist, or a zero the card will not be charged. Both halves of it: the
  // build-config prices and the money line eligibility settles (#637).
  const bound = await bindingsFor(ONE_TIME);

  for (const [key, value] of Object.entries({ ...bound.checkout.pricing, ...bound.order })) {
    if (typeof value !== 'string' || value === '') {
      continue;
    }

    assert.doesNotMatch(value, CADENCE_WORDS, `${key} claims no billing cycle: ${value}`);
    assert.ok(!value.includes('$0.00'), `${key} quotes no zero amount: ${value}`);
  }

  assert.strictEqual(bound.order.showTerms, false, 'and no subscription terms sentence rides along');
});

test('#558: a subscription keeps its cadence line exactly as it was', async () => {
  const annual = await bindingsFor(SUBSCRIPTION, { frequency: 'annually' });
  assert.strictEqual(annual.checkout.pricing.frequencyPaymentText, '$100.00 annually', 'the annual cycle still names itself');

  const monthly = await bindingsFor(SUBSCRIPTION, { frequency: 'monthly' });
  assert.strictEqual(monthly.checkout.pricing.frequencyPaymentText, '$10.00 monthly', 'and so does the monthly one');
  assert.strictEqual(monthly.checkout.product.isSubscription, true, 'the cadence tiles still render for a plan');
});

test('#637: a one-time buy never waits on trial eligibility — its money line paints at once', async () => {
  // A one-time product has no trial to be eligible for, so asking the server
  // buys nothing and costs the buyer a shimmering total and a "Checking your
  // plan" placeholder for as long as a cold backend takes to answer.
  const { updates, requests, form } = await bootCheckout({
    search: '?product=launch-kit',
    product: ONE_TIME,
  });

  assert.ok(
    !requests.some((request) => request.url.includes('trial-eligibility')),
    'the page never asks a question a one-time buy cannot have an answer to',
  );

  const orderPaint = updates.find((update) => update.order);
  assert.ok(orderPaint, 'the order root is published in the first frame, not after a wait');
  assert.strictEqual(orderPaint.order.total, '$49.99', 'the total is the one-time price');
  assert.strictEqual(orderPaint.order.showTerms, false, 'and no subscription terms ride along');
  assert.strictEqual(orderPaint.order.trial.show, false, 'nor a trial note');

  assert.deepStrictEqual(
    [...form.resolved].sort(),
    ['eligibility', 'recaptcha'],
    'both gates are already settled, so the pay buttons are armed',
  );
});
