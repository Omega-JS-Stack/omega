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
const defineCases = require('@omega.js/devkit/test/define-cases');
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
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
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
    storage: {
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => _set(storage, keyPath, undefined),
    },
    request: async (url, options) => {
      requests.push({ url, options });
      return { url: 'https://provider.test/checkout/abc' };
    },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const api = require(BUNDLE);

  await api.createPaymentIntent({
    state: { product: { id: 'premium' }, frequency: 'monthly', trialEligible: false },
    provider: 'stripe',
    formData: {},
  });

  return { payload: requests.at(-1).options.body, storage: storage };
}

module.exports = defineCases({
  type: 'group',
  description: 'checkout-attribution-cookies',
  tests: [
    {
      name: 'platform cookies: every present cookie rides the intent attribution',
      run: async (ctx) => {
        const { payload } = await createIntent({
          cookie: '_ga=GA1.1.123; _fbc=fb.1.1754006400000.FB-CLICK; _fbp=fb.1.1754006400000.987654321; _ttp=TTP-COOKIE; session=abc',
        });

        ctx.expect(payload.attribution.cookies).toEqual({
          fbc: 'fb.1.1754006400000.FB-CLICK',
          fbp: 'fb.1.1754006400000.987654321',
          ttp: 'TTP-COOKIE',
        });

        ctx.expect(payload.attribution.first, 'the captured touches ride unchanged').toEqual(STORED_ATTRIBUTION.first);
        ctx.expect(payload.attribution.last).toEqual(STORED_ATTRIBUTION.last);
      },
    },

    {
      name: 'platform cookies: only the cookies that exist are sent',
      run: async (ctx) => {
        // A visitor who has the Meta pixel's browser id but never clicked a Meta ad,
        // and no TikTok pixel at all. The server constructs `fbc` from the captured
        // fbclid — the client only ever sends real cookies.
        const { payload } = await createIntent({ cookie: '_fbp=fb.1.1754006400000.987654321' });

        ctx.expect(payload.attribution.cookies).toEqual({ fbp: 'fb.1.1754006400000.987654321' });
      },
    },

    {
      name: 'platform cookies: an empty jar sends no cookies key at all',
      run: async (ctx) => {
        const { payload } = await createIntent({ cookie: '' });

        ctx.expect(Object.hasOwn(payload.attribution, 'cookies'), 'no husk when the pixels wrote nothing').toBe(false);
        ctx.expect(payload.attribution, 'the stored attribution rides exactly as captured').toEqual(STORED_ATTRIBUTION);
      },
    },

    {
      name: 'platform cookies: the read is fresh and never persisted',
      run: async (ctx) => {
        const { payload, storage } = await createIntent({ cookie: '_fbc=fb.1.1754006400000.FB-CLICK' });

        ctx.expect(payload.attribution.cookies.fbc).toBe('fb.1.1754006400000.FB-CLICK');
        ctx.expect(Object.hasOwn(storage.attribution, 'cookies'), 'a stale cookie in storage would match the wrong click on the next checkout').toBe(false);
      },
    },

    {
      name: 'platform cookies: a checkout with no stored attribution still sends what the jar holds',
      run: async (ctx) => {
        const { payload } = await createIntent({ cookie: '_ttp=TTP-COOKIE', attribution: {} });

        ctx.expect(payload.attribution).toEqual({ cookies: { ttp: 'TTP-COOKIE' } });
      },
    },
  ],
});
