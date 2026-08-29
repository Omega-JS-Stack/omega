/**
 * Shared harness for driving the REAL checkout page module
 * (`core/js/pages/payment/checkout/index.js`) in node.
 *
 * The page is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so it is bundled through esbuild — the convention
 * auth-policy.test.js and checkout-decline.test.js set — with the client
 * package stubbed at its boundary. The client's own modules are stubbed at
 * their named exports: pulling the real ones would drag the Firebase singleton
 * into a bundle that only wants to watch a page paint.
 *
 * The trial-eligibility request is held OPEN until the caller answers it,
 * which is what makes the paint ORDER observable at all (#637).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', '..', 'core');
const PAGE_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'index.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-boot-'));
const BUNDLE = path.join(BUNDLE_DIR, 'checkout.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [PAGE_ENTRY],
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
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-client-stub-named' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/analytics\.js$/ }, () => {
          return { path: 'analytics', namespace: 'omega-client-stub-named' };
        });
        build.onLoad({ filter: /^form-manager$/, namespace: 'omega-client-stub-named' }, () => {
          return { contents: 'export const FormManager = globalThis.__FormManager;' };
        });
        build.onLoad({ filter: /^analytics$/, namespace: 'omega-client-stub-named' }, () => {
          return { contents: 'export const analytics = globalThis.__analytics;' };
        });
      },
    }],
  });

  return building;
}

/** The brand's catalog as build config hands it over: $100/yr, also monthly, trial on offer. */
const SUBSCRIPTION = {
  id: 'premium',
  name: 'Premium',
  type: 'subscription',
  prices: { monthly: 10, annually: 100 },
  trial: { days: 14 },
};

/** The FormManager surface the page drives, with its gate + listener traffic recorded. */
function makeFormManager(record) {
  return class StubFormManager {
    constructor(selector, options) {
      record.options = options;
      record.gates = [];
      record.resolved = [];
      record.ready = false;
      record.listeners = {};
    }

    on(event, handler) {
      (record.listeners[event] ||= []).push(handler);
      return this;
    }

    addGate(name) { record.gates.push(name); return this; }
    resolveGate(name) { record.resolved.push(name); return this; }
    ready() { record.ready = true; }
    setData(data) { record.data = data; }
    getData() { return record.data || {}; }
    setDirty() {}
  };
}

/**
 * Boot the REAL checkout page with the trial-eligibility request held open.
 *
 * Every caller answers it before its test ends, even one asserting nothing
 * about the answer: an unanswered race leaves the page's own 8s deadline
 * standing, and node keeps the process alive for it.
 *
 * @param {object} [options]
 * @param {string} [options.search] - the page URL's query string
 * @param {object} [options.product] - the product the catalog sells
 * @returns {Promise<object>} the recorded bindings updates, form traffic,
 *   requests, `emit(event, payload)` for a form listener, and
 *   `answerEligibility(eligible)` for the server finally replying.
 */
async function bootCheckout({ search = '?product=premium', product = SUBSCRIPTION } = {}) {
  await bundleOnce();

  const updates = [];
  const requests = [];
  const form = {};
  let answerEligibility;
  const eligibility = new Promise((resolve) => { answerEligibility = resolve; });

  globalThis.__FormManager = makeFormManager(form);
  globalThis.__analytics = {
    transports: { browser: {} },
    createConsentGate: () => () => true,
    configure: () => {},
    event: () => {},
  };

  globalThis.window = {
    location: { search, href: `https://brand.test/payment/checkout${search}`, origin: 'https://brand.test' },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = {
    cookie: '',
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
  };

  globalThis.__omegaClient = {
    config: { payment: { providers: { stripe: { publishableKey: 'pk_test_123' } }, products: [product] } },
    isDevelopment: () => false,
    getApiUrl: () => 'https://api.test',
    dom: () => ({ ready: async () => {} }),
    bindings: () => ({ update: (data) => updates.push(data) }),
    // Auth never settles on its own here: only the listener the page registers
    // decides when, and the page must have painted long before that.
    auth: () => ({
      listen: (options, callback) => setTimeout(() => callback({ user: null, account: null }), 0),
      getUser: () => ({ uid: 'u1', email: 'buyer@brand.test' }),
    }),
    storage: () => ({ get: (key, fallback) => fallback, set: () => {}, remove: () => {} }),
    firestore: () => ({ doc: () => ({ set: async () => {} }) }),
    request: async (url, options = {}) => {
      requests.push({ url, options });

      if (url.includes('trial-eligibility')) {
        return { eligible: await eligibility };
      }

      return {};
    },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const page = require(BUNDLE);

  // The page module must resolve on its own paint, never on the server's
  // answer — a page that only finishes when the backend does is the bug, so it
  // gets a verdict here rather than hanging the run.
  let deadline;
  const painted = await Promise.race([
    page.default().then(() => true),
    new Promise((resolve) => { deadline = setTimeout(() => resolve(false), 2000); }),
  ]);
  clearTimeout(deadline);
  assert.ok(painted, 'the checkout page finished initializing without waiting on trial eligibility');

  // One turn for the request, one for the paint that follows it. A caller
  // waiting out the page's own eligibility deadline passes its own ms.
  const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    updates,
    requests,
    form,
    settle,
    emit: async (event, payload) => {
      for (const handler of form.listeners[event] || []) {
        await handler(payload);
      }
    },
    answerEligibility: async (eligible) => {
      answerEligibility(eligible);
      await settle();
    },
  };
}

module.exports = { bootCheckout, SUBSCRIPTION };
