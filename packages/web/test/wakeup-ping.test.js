/**
 * Every page that warms the backend on load
 * ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
 *
 * The ping (`omega.request(WAKEUP_ROUTE, { wakeup: true })`, docs/client/index.md
 * § The wakeup ping) used to fire from /pricing and checkout alone, so a new
 * user's first real hit — the `/omega/user/signup` POST — landed on a cold
 * function and ate the whole start on the button: 14 seconds, measured live
 * 2026-08-27. Every page whose first user action is a backend call now warms it
 * on load instead.
 *
 * Same convention as the checkout/pricing suites: the REAL page module through
 * esbuild behind its bundler aliases, with the client stubbed at its boundary.
 * The page's own promise is NOT awaited — a ping that waits for the page to
 * finish booting is the bug this pins, so what is asserted is that the request
 * is out before anything else the page does gets a chance to hold it.
 *
 * /pricing and /payment/checkout keep their pins in their own suites
 * (pricing-switch-cta.test.js, checkout-paint.test.js).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');

const CORE_DIR = path.join(__dirname, '..', 'core');
const THEMES_DIR = path.join(__dirname, '..', 'themes');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-wakeup-ping-'));

const bundles = new Map();

// One bundle per entry, cached: several tests boot the same page.
function bundleOnce(entry) {
  if (!bundles.has(entry)) {
    const outfile = path.join(BUNDLE_DIR, `${bundles.size}.cjs`);

    bundles.set(entry, esbuild.build({
      entryPoints: [entry],
      outfile,
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
          // FormManager is a whole state machine over a real form; nothing here
          // submits one.
          build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
            return { path: 'form-manager', namespace: 'omega-form-stub' };
          });
          build.onLoad({ filter: /.*/, namespace: 'omega-form-stub' }, () => {
            return { contents: 'export class FormManager { constructor() {} on() { return this; } addGate() { return this; } resolveGate() { return this; } ready() {} setData() {} getData() { return {}; } setDirty() {} showSuccess() {} }' };
          });
          build.onResolve({ filter: /^@omega\.js\/client\/modules\/analytics\.js$/ }, () => {
            return { path: 'analytics', namespace: 'omega-analytics-stub' };
          });
          build.onLoad({ filter: /.*/, namespace: 'omega-analytics-stub' }, () => {
            return { contents: 'export const analytics = { transports: { browser: {} }, createConsentGate: () => () => true, configure: () => {}, event: () => {} };' };
          });
        },
      }],
    }).then(() => outfile));
  }

  return bundles.get(entry);
}

/**
 * A document for a page that only has to boot far enough to have pinged.
 *
 * `found` decides what a lookup answers: nothing (the default — most pages
 * bail out early and quietly on a missing element) or an inert element, for a
 * page that writes to what it looks up.
 */
function makeDocument(found = false, present = []) {
  const element = {
    value: '',
    textContent: '',
    dataset: {},
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    appendChild: () => {},
    append: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const lookup = () => (found ? { ...element } : null);
  const lookupAll = (selector) => (present.includes(selector) ? [{ ...element }] : []);

  return {
    cookie: '',
    readyState: 'complete',
    documentElement: element,
    body: element,
    head: element,
    createElement: () => ({ ...element }),
    getElementById: lookup,
    querySelector: lookup,
    querySelectorAll: lookupAll,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

/**
 * Boot a REAL page module and record what it asked of the backend.
 *
 * The module's promise is deliberately left running: a page that only pings
 * after it has finished booting is what #644 is about, so the recording is read
 * one turn in, not after the page says it is done.
 *
 * @param {string} entry - absolute path to the page module
 * @param {object} [options]
 * @param {boolean} [options.found] - answer DOM lookups with an inert element
 * @param {string[]} [options.present] - selectors that DO match one element
 * @returns {Promise<object>} `requests` (every omega.request, in order) and the
 *   omega stub, so a caller can drive whatever the page wired onto it.
 */
async function bootPage(entry, { found = false, present = [] } = {}) {
  const bundle = await bundleOnce(entry);

  const requests = [];

  globalThis.window = {
    location: { search: '', href: 'https://brand.test/', origin: 'https://brand.test', hash: '' },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  globalThis.document = makeDocument(found, present);
  globalThis.navigator = { userAgent: 'node', language: 'en-US' };

  const omega = {
    config: { payment: {}, captcha: { providers: {} }, analytics: { providers: {} } },
    isDevelopment: () => false,
    getApiUrl: () => 'https://api.test',
    isValidRedirectUrl: () => true,
    dom: () => ({ ready: async () => {} }),
    bindings: () => ({ update: () => {} }),
    // Auth never settles: everything asserted here happens before it does.
    auth: () => ({ listen: () => {}, getUser: () => null, signOut: async () => {} }),
    storage: () => ({ get: (key, fallback) => fallback, set: () => {}, remove: () => {} }),
    firestore: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) }),
    sentry: () => ({ captureException: () => {} }),
    utilities: () => ({ getContext: () => ({}), showNotification: () => {}, getPlatform: () => 'macos' }),
    request: async (url, options = {}) => {
      requests.push({ url, options });
      return {};
    },
  };

  globalThis.__omegaClient = omega;

  delete require.cache[require.resolve(bundle)];
  const page = require(bundle);

  // The page runs on its own clock from here; a boot that throws behind the
  // ping is another suite's subject.
  Promise.resolve().then(() => page.default()).catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 5));

  return { requests, omega };
}

/** The one shape every site must have: one ping, aimed at the one route, nothing awaited. */
function assertWakeup(requests, where) {
  const wakeups = requests.filter((request) => request.options.wakeup);

  assert.strictEqual(wakeups.length, 1, `${where} fires the wakeup exactly once`);
  assert.strictEqual(wakeups[0].url, WAKEUP_ROUTE, `${where} aims it at the one route every wakeup names`);
  assert.deepStrictEqual(
    Object.keys(wakeups[0].options),
    ['wakeup'],
    `${where} sends nothing else with it — no auth, no body, no timeout`,
  );
}

test('#644: /signup warms the backend on load, before it boots the form', async () => {
  const { requests } = await bootPage(path.join(CORE_DIR, 'js', 'pages', 'signup', 'index.js'));

  assertWakeup(requests, '/signup');
});

test('#644: /signin warms the backend on load', async () => {
  const { requests } = await bootPage(path.join(CORE_DIR, 'js', 'pages', 'signin', 'index.js'));

  assertWakeup(requests, '/signin');
});

test('#644: the account dashboard warms the backend on load', async () => {
  const { requests } = await bootPage(path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'index.js'));

  assertWakeup(requests, '/account');
});

test('#644: /token warms the backend before it waits for auth', async () => {
  // This page's POST cannot go out until auth settles, and auth never settles
  // in this harness — so a ping recorded here is one that did not wait for it.
  const { requests } = await bootPage(path.join(CORE_DIR, 'js', 'pages', 'token', 'index.js'));

  assertWakeup(requests, '/token');
  assert.strictEqual(requests.length, 1, 'and it is the only thing on the wire while auth is pending');
});

test('#644: /oauth2 warms the backend before it waits for auth', async () => {
  const { requests } = await bootPage(path.join(CORE_DIR, 'js', 'pages', 'oauth2', 'index.js'));

  assertWakeup(requests, '/oauth2');
  assert.strictEqual(requests.length, 1, 'the tokenize POST is still behind the auth settle');
});

test('#644: /feedback warms the backend on load', async () => {
  const { requests } = await bootPage(path.join(CORE_DIR, 'js', 'pages', 'feedback', 'index.js'));

  assertWakeup(requests, '/feedback');
});

test('#644: the email-preferences portal warms the backend on load', async () => {
  // This one paints the masked address into the page as it boots, so its
  // lookups have to answer.
  const { requests } = await bootPage(path.join(CORE_DIR, 'js', 'pages', 'portal', 'email-preferences', 'index.js'), { found: true });

  assertWakeup(requests, '/portal/email-preferences');
});

test('#644: /download warms the backend where its notify-me form renders, and only there', async () => {
  const entry = path.join(CORE_DIR, 'js', 'pages', 'download', 'index.js');

  const withForm = await bootPage(entry, { present: ['.mobile-email-form'] });
  assertWakeup(withForm.requests, '/download with the form');

  const withoutForm = await bootPage(entry);
  assert.deepStrictEqual(
    withoutForm.requests,
    [],
    'a visitor on a platform that ships gets no ping — there is no form to submit',
  );
});

test('#644: the newsletter band warms the backend on first focus, never on load', async () => {
  // The band rides most pages, so this one is deliberately NOT a load-time
  // ping: a passive visitor scrolling past would warm a function they are never
  // going to POST to. The focus is the intent.
  const entry = path.join(THEMES_DIR, 'base', '_sections', 'marketing', 'newsletter-cta', 'section.js');
  const bundle = await bundleOnce(entry);

  const requests = [];
  const listeners = {};

  globalThis.window = { location: { search: '', href: 'https://brand.test/' }, addEventListener: () => {} };
  globalThis.document = makeDocument();
  globalThis.__omegaClient = {
    config: { captcha: { providers: {} } },
    getApiUrl: () => 'https://api.test',
    request: async (url, options = {}) => { requests.push({ url, options }); return {}; },
    sentry: () => ({ captureException: () => {} }),
  };

  const $form = {
    addEventListener: (event, handler) => { (listeners[event] ||= []).push(handler); },
    querySelector: () => null,
    querySelectorAll: () => [],
    reset: () => {},
  };

  delete require.cache[require.resolve(bundle)];
  require(bundle).default({ querySelector: () => $form });

  assert.deepStrictEqual(requests, [], 'nothing is warmed for a visitor who only scrolled past');

  for (const handler of listeners.focusin || []) {
    handler();
  }

  assertWakeup(requests, 'the newsletter band');
});
