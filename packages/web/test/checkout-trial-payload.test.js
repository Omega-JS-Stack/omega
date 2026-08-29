/**
 * What the intent route is ASKED for versus what the checkout page SHOWED
 * (Ian 2026-08-27, [#637](https://github.com/Omega-JS-Stack/omega/issues/637)).
 *
 * A trial-eligibility check has three answers, not two. When it times out or
 * fails, the DISPLAY stays conservative — no trial quoted, the full amount due
 * today, because rule 3 never shows a price the server has not confirmed — but
 * the payload still asks for the trial. The intent route re-checks eligibility
 * against the buyer's own order history and silently downgrades anyone who does
 * not qualify, so asking costs a non-qualifying buyer nothing, while NOT asking
 * costs a qualifying one their offer over a slow network.
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL api module and the REAL
 * state it reads through esbuild — the convention checkout-discount.test.js
 * sets — with the client stubbed. The assertion is the payload the intent route
 * would have received.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-trial-payload-'));
const BUNDLE = path.join(BUNDLE_DIR, 'api.cjs');

let building = null;

// One entry exporting both seams, so the REAL api module and the REAL state it
// reads stay the same instance.
function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: [
        `export { createPaymentIntent } from './api.js';`,
        `export { state, TRIAL_ELIGIBILITY_UNKNOWN } from './state.js';`,
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
      },
    }],
  });

  return building;
}

// A plan that sells a 14-day trial, and one that sells none.
const TRIAL_PRODUCT = { id: 'premium', name: 'Premium', type: 'subscription', prices: { annually: 100 }, trial: { days: 14 } };
const NO_TRIAL_PRODUCT = { id: 'basic', name: 'Basic', type: 'subscription', prices: { annually: 50 } };

/** Send one intent with the page's trial state set as named; hand back the payload. */
async function intentFor({ trialEligibility, trialEligible, product = TRIAL_PRODUCT }) {
  await bundleOnce();

  const requests = [];

  globalThis.window = { location: { search: '' } };
  globalThis.document = { cookie: '' };
  globalThis.__omegaClient = {
    isDevelopment: () => false,
    getApiUrl: () => 'https://api.test',
    storage: () => ({ get: (key, fallback) => fallback, set: () => {} }),
    request: async (url, options) => {
      requests.push({ url, options });
      return { url: 'https://provider.test/checkout/abc' };
    },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);

  bundle.state.product = product;
  bundle.state.frequency = 'annually';
  bundle.state.trialEligibility = trialEligibility === 'unknown' ? bundle.TRIAL_ELIGIBILITY_UNKNOWN : trialEligibility;
  bundle.state.trialEligible = trialEligible;

  await bundle.createPaymentIntent({ state: bundle.state, provider: 'stripe', formData: {} });

  return requests.at(-1).options.body;
}

test('#637: an UNKNOWN answer still asks the route for the trial the page did not quote', async () => {
  const payload = await intentFor({ trialEligibility: 'unknown', trialEligible: false });

  assert.strictEqual(payload.trial, true, 'the buyer keeps the offer the server can still grant them');
});

test('#637: an unknown answer on a product that sells no trial asks for nothing', async () => {
  const payload = await intentFor({ trialEligibility: 'unknown', trialEligible: false, product: NO_TRIAL_PRODUCT });

  assert.strictEqual(payload.trial, false, 'there is no trial to ask for');
});

test('#637: a confirmed NO is sent as a no', async () => {
  const payload = await intentFor({ trialEligibility: false, trialEligible: false });

  assert.strictEqual(payload.trial, false, 'the server already said this buyer has had their trial');
});

test('#637: a confirmed YES is sent as a yes, exactly as the page quoted it', async () => {
  const payload = await intentFor({ trialEligibility: true, trialEligible: true });

  assert.strictEqual(payload.trial, true);
});
