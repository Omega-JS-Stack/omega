/**
 * The platform cookies riding the POST-AUTH request (`core/js/core/auth.js`'s
 * `sendUserSignupMetadata`) — [#577](https://github.com/Omega-JS-Stack/omega/issues/577).
 *
 * The server half of `sign_up` fires from this request, and it is the only
 * moment the backend hears from the browser that just registered: the request
 * carries the IP and user agent by itself, and the platform cookies only if this
 * payload brings them. Without them Meta scored the registration around 4/10 on
 * match quality.
 *
 * `_fbc`/`_fbp`/`_ttp` are written by the platforms' own pixels, so they are
 * read FRESH at send time through the ONE reader the checkout uses
 * (`libs/analytics.js` `readPlatformCookies`) and never persisted — a stale
 * value from an earlier session would match the wrong click.
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild —
 * the convention checkout-attribution-cookies.test.js set. The assertion is the
 * payload the `/user/signup` route would have received.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');

const CORE_DIR = path.join(__dirname, '..', 'core');
const AUTH_ENTRY = path.join(CORE_DIR, 'js', 'core', 'auth.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-signup-cookies-'));
const BUNDLE = path.join(BUNDLE_DIR, 'auth.cjs');

// The attribution the landing capture wrote before this visitor registered.
const STORED_ATTRIBUTION = {
  first: { tags: { utm_source: 'newsletter' }, referrer: null, url: 'https://brand.test/', page: '/', timestamp: '2026-06-01T00:00:00.000Z' },
  last: { clickIds: { fbclid: 'FB-CLICK' }, referrer: 'https://facebook.com/', url: 'https://brand.test/signup', page: '/signup', timestamp: '2026-08-01T00:00:00.000Z' },
};

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [AUTH_ENTRY],
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
        // The facade's own client import — the page seams it configures are not
        // what this file drives, so the stub only has to exist.
        build.onResolve({ filter: /^@omega\.js\/client\// }, () => {
          return { path: 'client-modules', namespace: 'omega-client-modules-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-modules-stub' }, () => {
          return {
            contents: `export const analytics = {
              configure() {},
              event() {},
              transports: { browser: {} },
              createConsentGate: () => ({ granted: () => false }),
              identity: {},
            };`,
          };
        });
      },
    }],
  });

  return building;
}

/** Run the REAL post-auth request once with a given cookie jar; hand back the payload. */
async function sendMetadata({ cookie = '', attribution = STORED_ATTRIBUTION } = {}) {
  await bundleOnce();

  const storage = { attribution: attribution, consent: { legal: { granted: true } }, trackingConsent: { analytics: true, marketing: true } };
  const requests = [];

  globalThis.window = { location: { href: 'https://brand.test/dashboard', search: '' } };
  globalThis.document = {
    cookie: cookie,
    documentElement: { getAttribute: () => '/dashboard' },
  };
  globalThis.__omegaClient = {
    config: { environment: 'production', analytics: { providers: {} } },
    isDevelopment: () => false,
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
    }),
    utilities: () => ({
      getContext: () => ({ client: { platform: 'macos' } }),
      showNotification: () => {},
    }),
    request: async (url, options) => {
      requests.push({ url, options });
      return { signedUp: true };
    },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const auth = require(BUNDLE);

  await auth.sendUserSignupMetadata({ flags: { signupProcessed: false } });

  return { request: requests.at(-1), payload: requests.at(-1)?.options?.body, storage: storage };
}

test('signup metadata: every present platform cookie rides the post-auth request', async () => {
  const { request, payload } = await sendMetadata({
    cookie: '_ga=GA1.1.123; _fbc=fb.1.1754006400000.FB-CLICK; _fbp=fb.1.1754006400000.987654321; _ttp=TTP-COOKIE; session=abc',
  });

  assert.strictEqual(request.url, '/omega/user/signup', 'the one request the browser already makes after auth');
  assert.deepStrictEqual(payload.attribution.cookies, {
    fbc: 'fb.1.1754006400000.FB-CLICK',
    fbp: 'fb.1.1754006400000.987654321',
    ttp: 'TTP-COOKIE',
  });

  assert.deepStrictEqual(payload.attribution.first, STORED_ATTRIBUTION.first, 'the captured touches ride unchanged');
  assert.deepStrictEqual(payload.attribution.last, STORED_ATTRIBUTION.last);
});

test('signup metadata: only the cookies that exist are sent', async () => {
  const { payload } = await sendMetadata({ cookie: '_fbp=fb.1.1754006400000.987654321' });

  assert.deepStrictEqual(payload.attribution.cookies, { fbp: 'fb.1.1754006400000.987654321' });
});

test('signup metadata: an empty jar sends no cookies key at all', async () => {
  const { payload } = await sendMetadata({ cookie: '' });

  assert.strictEqual(Object.hasOwn(payload.attribution, 'cookies'), false, 'no husk when the pixels wrote nothing');
  assert.deepStrictEqual(payload.attribution, STORED_ATTRIBUTION, 'the stored attribution rides exactly as captured');
});

test('signup metadata: the read is fresh and never persisted', async () => {
  const { payload, storage } = await sendMetadata({ cookie: '_fbc=fb.1.1754006400000.FB-CLICK' });

  assert.strictEqual(payload.attribution.cookies.fbc, 'fb.1.1754006400000.FB-CLICK');
  assert.strictEqual(Object.hasOwn(storage.attribution, 'cookies'), false, 'a stale cookie in storage would match the wrong click next time');
});

test('signup metadata: an already-processed account posts nothing', async () => {
  await bundleOnce();
  const { request } = await sendMetadata({ cookie: '_ttp=TTP-COOKIE' });

  assert.ok(request, 'precondition: an unprocessed account does post');

  // The doc's flag is the single source of truth, and the server half of
  // sign_up fires from this request — a second post would be a second
  // registration.
  globalThis.document.cookie = '_ttp=TTP-COOKIE';
  const requests = [];
  globalThis.__omegaClient.request = async (url, options) => {
    requests.push({ url, options });
    return {};
  };

  delete require.cache[require.resolve(BUNDLE)];
  const auth = require(BUNDLE);
  await auth.sendUserSignupMetadata({ flags: { signupProcessed: true } });

  assert.deepStrictEqual(requests, [], 'a processed account never posts again');
});
