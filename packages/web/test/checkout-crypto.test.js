/**
 * /payment/checkout — the crypto button shows only where crypto can be paid
 * ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 *
 * #636 deleted the button along with the config stub it read, because no
 * Coinbase provider existed behind it. The provider is real now, so the button
 * is back — under TWO conditions, not one. Its provider condition is the
 * sibling of every other method's (`payment.providers.coinbase.enabled`), and
 * its product condition is Coinbase Commerce's own shape: a hosted charge is a
 * single payment, so the backend's intent provider refuses a subscription
 * outright and a button offered there could only end in the checkout's generic
 * failure sentence.
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL state module through
 * esbuild — the convention checkout-discount.test.js and
 * checkout-one-time-summary.test.js set — with the client stubbed.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-crypto-'));
const BUNDLE = path.join(BUNDLE_DIR, 'state.cjs');

// The playground's real pair: the one-time buy crypto can pay for, and the plan
// it can never carry.
const ONE_TIME = { id: 'launch-kit', name: 'Starter Library', type: 'one-time', prices: { once: 49.99 } };
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

/** Load the real state module fresh, with the client stubbed. */
async function loadState() {
  await bundleOnce();

  globalThis.window = { location: { search: '' } };
  globalThis.__omegaClient = {
    isDevelopment: () => false,
    auth: () => ({ getUser: () => null }),
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var -> /private/var).
  delete require.cache[require.resolve(BUNDLE)];

  return require(BUNDLE);
}

/** The checkout bindings for one product against one `payment.providers` block. */
async function bindingsFor(product, providers, { frequency = 'annually' } = {}) {
  const modules = await loadState();

  modules.state.product = product;
  modules.state.frequency = product.type === 'subscription' ? frequency : 'once';
  modules.state.providers = providers;

  return modules.buildBindingsState();
}

test('#642: the crypto button shows when the coinbase provider is switched on', async () => {
  const bound = await bindingsFor(ONE_TIME, { coinbase: { enabled: true } });

  assert.strictEqual(bound.checkout.paymentMethods.crypto, true, 'an enabled provider offers the button');
});

test('#642: an unconfigured brand never sees a crypto button', async () => {
  // Three shapes of "not configured", because the config default materializes
  // the block into EVERY brand (`{ enabled: false }`): a block that exists is
  // not an ON, and only the literal `true` is.
  for (const providers of [{}, { coinbase: {} }, { coinbase: { enabled: false } }]) {
    const bound = await bindingsFor(ONE_TIME, providers);

    assert.strictEqual(
      bound.checkout.paymentMethods.crypto, false,
      `no button without an explicit enable: ${JSON.stringify(providers)}`,
    );
  }
});

test('#642: a subscription never offers crypto, however the provider is configured', async () => {
  // Coinbase Commerce has no recurring anything — the backend's intent provider
  // refuses a subscription, so the button must not be reachable there at all.
  const bound = await bindingsFor(SUBSCRIPTION, { coinbase: { enabled: true } });

  assert.strictEqual(bound.checkout.paymentMethods.crypto, false, 'a plan cannot be bought in crypto');
  assert.strictEqual(bound.checkout.product.isSubscription, true, 'and it really is the subscription branch');
});

test('#642: the crypto button starts a coinbase intent', async () => {
  const { resolveProvider } = await loadState();

  assert.strictEqual(resolveProvider('crypto'), 'coinbase', 'the method maps to the provider the backend loads');

  // The siblings are untouched by the new entry
  assert.strictEqual(resolveProvider('paypal'), 'paypal');
});

test('#642: switching the provider on adds nothing to the other methods', async () => {
  const { crypto, ...others } = (await bindingsFor(ONE_TIME, { coinbase: { enabled: true } })).checkout.paymentMethods;

  assert.strictEqual(crypto, true);
  assert.deepStrictEqual(
    others, { card: false, paypal: false, applePay: false, googlePay: false },
    'a crypto-only brand offers crypto and nothing else',
  );
});
