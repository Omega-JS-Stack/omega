/**
 * The platform cookies riding the intent (`core/js/pages/payment/checkout/
 * modules/api.js`) — stage D of [#302](https://github.com/Omega-JS-Stack/omega/issues/302)
 * ([#385](https://github.com/Omega-JS-Stack/omega/issues/385)).
 *
 * Meta's `_fbc`/`_fbp` and TikTok's `_ttp` are written by the platforms' own
 * pixels into `document.cookie`. They are what lets a SERVER conversion be
 * matched to the browser session that clicked the ad, so the one payload that
 * leaves the browser at checkout has to carry them — read FRESH at send time,
 * never persisted into the stored attribution, where a stale value from an
 * earlier session would match the wrong click.
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild —
 * the convention checkout-decline.test.js set. The assertion is the payload the
 * intent route would have received.
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

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-cookies-'));
const BUNDLE = path.join(BUNDLE_DIR, 'api.cjs');

// The stored attribution a returning visitor carries into checkout.
const STORED_ATTRIBUTION = {
  first: { tags: { utm_source: 'newsletter' }, referrer: null, url: 'https://brand.test/', page: '/', timestamp: '2026-06-01T00:00:00.000Z' },
  last: { clickIds: { fbclid: 'FB-CLICK' }, referrer: 'https://facebook.com/', url: 'https://brand.test/pricing', page: '/pricing', timestamp: '2026-08-01T00:00:00.000Z' },
};

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

/** Run the REAL intent call once with a given cookie jar; hand back the payload + storage. */
async function createIntent({ cookie = '', attribution = STORED_ATTRIBUTION } = {}) {
  await bundleOnce();

  const storage = { attribution: attribution };
  const requests = [];

  globalThis.window = { location: { search: '' } };
  globalThis.document = { cookie: cookie };
  globalThis.__omegaClient = {
    config: { environment: 'production' },
    isDevelopment: () => false,
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => _set(storage, keyPath, undefined),
    }),
    request: async (url, options) => {
      requests.push({ url, options });
      return { url: 'https://processor.test/checkout/abc' };
    },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const api = require(BUNDLE);

  await api.createPaymentIntent({
    state: { product: { id: 'premium' }, frequency: 'monthly', trialEligible: false },
    processor: 'stripe',
    formData: {},
  });

  return { payload: requests.at(-1).options.body, storage: storage };
}

test('platform cookies: every present cookie rides the intent attribution', async () => {
  const { payload } = await createIntent({
    cookie: '_ga=GA1.1.123; _fbc=fb.1.1754006400000.FB-CLICK; _fbp=fb.1.1754006400000.987654321; _ttp=TTP-COOKIE; session=abc',
  });

  assert.deepStrictEqual(payload.attribution.cookies, {
    fbc: 'fb.1.1754006400000.FB-CLICK',
    fbp: 'fb.1.1754006400000.987654321',
    ttp: 'TTP-COOKIE',
  });

  assert.deepStrictEqual(payload.attribution.first, STORED_ATTRIBUTION.first, 'the captured touches ride unchanged');
  assert.deepStrictEqual(payload.attribution.last, STORED_ATTRIBUTION.last);
});

test('platform cookies: only the cookies that exist are sent', async () => {
  // A visitor who has the Meta pixel's browser id but never clicked a Meta ad,
  // and no TikTok pixel at all. The server constructs `fbc` from the captured
  // fbclid — the client only ever sends real cookies.
  const { payload } = await createIntent({ cookie: '_fbp=fb.1.1754006400000.987654321' });

  assert.deepStrictEqual(payload.attribution.cookies, { fbp: 'fb.1.1754006400000.987654321' });
});

test('platform cookies: an empty jar sends no cookies key at all', async () => {
  const { payload } = await createIntent({ cookie: '' });

  assert.strictEqual(Object.hasOwn(payload.attribution, 'cookies'), false, 'no husk when the pixels wrote nothing');
  assert.deepStrictEqual(payload.attribution, STORED_ATTRIBUTION, 'the stored attribution rides exactly as captured');
});

test('platform cookies: the read is fresh and never persisted', async () => {
  const { payload, storage } = await createIntent({ cookie: '_fbc=fb.1.1754006400000.FB-CLICK' });

  assert.strictEqual(payload.attribution.cookies.fbc, 'fb.1.1754006400000.FB-CLICK');
  assert.strictEqual(Object.hasOwn(storage.attribution, 'cookies'), false, 'a stale cookie in storage would match the wrong click on the next checkout');
});

test('platform cookies: a checkout with no stored attribution still sends what the jar holds', async () => {
  const { payload } = await createIntent({ cookie: '_ttp=TTP-COOKIE', attribution: {} });

  assert.deepStrictEqual(payload.attribution, { cookies: { ttp: 'TTP-COOKIE' } });
});
