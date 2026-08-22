/**
 * The dev decline simulation, checkout end (`core/js/pages/payment/checkout/
 * modules/api.js`) — the ONE intent POST reads the `_dev_decline` param the
 * palette's Checkout section applies (modules/dev-section.js) and turns it into
 * the intent route's `simulate: 'decline'`. The param is the whole state: it
 * persists across attempts until Apply & reload drops it, so nothing is
 * consumed or cleared here. Production never looks: the param is only
 * consulted when omega.isDevelopment().
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild —
 * the convention auth-policy.test.js and dev-palette.test.js set — with the
 * client stubbed. The stub's storage is lodash-pathed exactly like the real
 * one (@omega.js/client's Storage), so a nested path behaves as it does in a
 * browser. The assertion is the payload the intent route would have received.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');

const CORE_DIR = path.join(__dirname, '..', 'core');
const API_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules', 'api.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-decline-'));
const BUNDLE = path.join(BUNDLE_DIR, 'api.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [API_ENTRY],
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

/** The minimum client the module reaches for, plus the captured calls. */
function makeClient({ development, storage }) {
  const requests = [];
  // Nothing about a decline is stored any more — the removals are captured so
  // the tests can say so out loud.
  const removals = [];

  const client = {
    requests,
    removals,
    config: { environment: development ? 'development' : 'production' },
    isDevelopment: () => development,
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => { removals.push(keyPath); _set(storage, keyPath, undefined); },
    }),
    request: async (url, options) => {
      requests.push({ url, options });
      if (client.failRequest) {
        throw new Error('intent route unreachable');
      }
      return { url: 'https://provider.test/checkout/abc' };
    },
  };

  return client;
}

/** Run the REAL intent call once against one page URL; hand back the payload. */
async function createIntent({ development, search = '' }) {
  await bundleOnce();

  const client = makeClient({ development, storage: {} });

  globalThis.window = { location: { search } };
  // The intent payload also reads the ad platforms' cookies (#385) — an empty
  // jar is what a decline rehearsal has.
  globalThis.document = { cookie: '' };
  globalThis.__omegaClient = client;

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const api = require(BUNDLE);

  await api.createPaymentIntent({
    state: { product: { id: 'premium' }, frequency: 'monthly', trialEligible: false },
    provider: 'stripe',
    formData: {},
  });

  return { payload: client.requests.at(-1).options.body, removals: client.removals };
}

test('decline simulation: the applied param arms the intent, and stays armed after it', async () => {
  const { payload, removals } = await createIntent({ development: true, search: '?product=premium&_dev_decline=true' });

  assert.strictEqual(payload.simulate, 'decline', 'the armed checkout should ask the intent route to simulate a decline');
  assert.deepStrictEqual(removals, [], 'the param is the whole state — nothing is consumed, so a retry declines too');
});

test('decline simulation: the bare param is an arm', async () => {
  const { payload } = await createIntent({ development: true, search: '?_dev_decline' });

  assert.strictEqual(payload.simulate, 'decline', 'presence is the arm — a hand-typed param needs no value');
});

test('decline simulation: an unarmed dev checkout sends no simulate', async () => {
  const { payload } = await createIntent({ development: true, search: '?product=premium' });

  assert.strictEqual(Object.hasOwn(payload, 'simulate'), false, 'dev alone must not simulate anything');
});

test('decline simulation: production never reads the param', async () => {
  const { payload } = await createIntent({ development: false, search: '?_dev_decline=true' });

  assert.strictEqual(Object.hasOwn(payload, 'simulate'), false, 'a param a real user landed on can never decline their checkout');
});
