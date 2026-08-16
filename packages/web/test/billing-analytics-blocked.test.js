/**
 * The billing card's ACTIONS survive blocked analytics
 * ([#283](https://github.com/Omega-JS-Stack/omega/issues/283)).
 *
 * `trackBilling()` (`core/js/pages/dashboard/account/sections/billing.js`) used
 * to reach for `gtag`, `fbq` and `ttq` as bare globals. An ad blocker does not
 * stub them, it keeps the snippets from ever defining them, so the first call
 * threw a ReferenceError — and because the counting runs BEFORE the work on
 * every one of these paths, the button the customer pressed did nothing at
 * all. Undoing a cancellation was the worst of them: the route was never
 * called. The guard is now the framework's own analytics helper
 * ([#306](https://github.com/Omega-JS-Stack/omega/issues/306)), which this
 * suite still holds to the behavior #283 pinned.
 *
 * What this suite pins, both directions:
 *  - with all three globals undefined, every billing action still runs;
 *  - with them present, all three are still called — a guard that silently
 *    stopped counting would be the same bug pointed the other way.
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild —
 * the convention billing-actions.test.js sets — over a document built from the
 * ids `init()` wires its controls by.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { resolveSubscription } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const BILLING_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'billing.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-analytics-'));
const BUNDLE = path.join(BUNDLE_DIR, 'billing.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [BILLING_ENTRY],
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
        // Same reason billing-actions.test.js keeps it a name: the published
        // FormManager build's `module.exports =` tail clobbers the harness
        // bundle's own exports, and there is no cancellation form here.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager {}' };
        });
      },
    }],
  });

  return building;
}

const PAYMENT_CONFIG = {
  currency: 'USD',
  products: [
    { id: 'basic', name: 'Basic', type: 'subscription', prices: {} },
    { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10, annually: 100 } },
  ],
};

const MONTH_FROM_NOW = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

/** A live subscription that is scheduled to end — the state that offers undo. */
function cancellingAccount() {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { frequency: 'monthly', price: 10, processor: 'stripe' },
      expires: { timestampUNIX: MONTH_FROM_NOW },
      cancellation: { pending: true, date: { timestampUNIX: MONTH_FROM_NOW } },
    },
  };
}

/**
 * Drive the REAL init() over a document built from ids, with the page's
 * analytics globals either present or blocked.
 *
 * `analyticsBlocked` is what an ad blocker leaves behind: the snippets never
 * run, so the names are simply not there.
 */
async function wireBilling({ analyticsBlocked }) {
  await bundleOnce();

  const requests = [];
  const opened = [];
  const tracked = [];
  const elements = new Map();

  const makeEl = (id) => ({
    id,
    handlers: [],
    addEventListener(type, handler) { this.handlers.push({ type, handler }); },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    classList: { contains: () => false, add: () => {}, remove: () => {}, toggle: () => {} },
    querySelector: () => null,
  });

  for (const id of ['upgrade-plan-btn', 'change-plan-btn', 'manage-billing-btn', 'uncancel-confirm-btn']) {
    elements.set(id, makeEl(id));
  }

  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = {
    location: { pathname: '/dashboard/account', search: '', hash: '#billing', href: '/dashboard/account' },
    history: { replaceState: () => {} },
    open: (url) => opened.push(url),
  };
  globalThis.__omegaClient = {
    auth: () => ({ resolveSubscription: (account) => resolveSubscription(account) }),
    bindings: () => ({ update: () => {} }),
    utilities: () => ({ showNotification: () => {}, escapeHTML: (value) => value }),
    request: async (route, options) => {
      requests.push({ route, options });
      return route.endsWith('/portal') ? { url: 'https://portal.example/session' } : {};
    },
  };

  for (const name of ['gtag', 'fbq', 'ttq']) {
    delete globalThis[name];
  }
  if (!analyticsBlocked) {
    globalThis.gtag = (...args) => tracked.push(['gtag', ...args]);
    globalThis.fbq = (...args) => tracked.push(['fbq', ...args]);
    globalThis.ttq = { track: (...args) => tracked.push(['ttq', ...args]) };
  }

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.init();
  await billing.loadData(cancellingAccount(), PAYMENT_CONFIG);

  /**
   * Click one control the way a browser does: the handler's own error reaches
   * the caller, and the async work it started is awaited before we look.
   */
  const clickById = async (id) => {
    for (const { type, handler } of elements.get(id).handlers) {
      if (type === 'click') handler({ preventDefault() {}, stopPropagation() {} });
    }

    await new Promise((resolve) => setImmediate(resolve));
  };

  return { requests, opened, tracked, clickById };
}

test('#283: a blocked analytics global never stops a billing action', async () => {
  // The repro: `gtag` is not a function that fails, it is a name that does not
  // exist. The first line of trackBilling() throws a ReferenceError and takes
  // the whole click handler with it.
  const { requests, opened, clickById } = await wireBilling({ analyticsBlocked: true });

  // Undo cancellation counts BEFORE it calls the route, so the throw meant the
  // customer's subscription was never actually resumed.
  await clickById('uncancel-confirm-btn');
  assert.deepStrictEqual(
    requests.map((request) => request.route),
    ['/omega/payments/uncancel'],
    'the uncancel route is called with the analytics scripts blocked',
  );
  assert.strictEqual(requests[0].options.body.confirmed, true, 'and carries the confirmation the backend expects');

  await clickById('manage-billing-btn');
  assert.strictEqual(requests.at(-1).route, '/omega/payments/portal', 'the billing portal still opens');
  assert.deepStrictEqual(opened, ['https://portal.example/session'], 'and the customer is taken to it');

  await clickById('upgrade-plan-btn');
  assert.strictEqual(globalThis.window.location.href, '/pricing', 'the upgrade button still navigates');

  // The plan switcher's own click only counts the intent, so the proof is that
  // it raises nothing at all.
  await assert.doesNotReject(() => clickById('change-plan-btn'), 'recording the change-plan intent throws nothing');
});

test('#283: with the scripts present, every provider is still counted', async () => {
  // The guard must not become a silent opt-out: an unblocked page counts a
  // billing action on all three providers, exactly as it did before.
  const { tracked, clickById } = await wireBilling({ analyticsBlocked: false });

  await clickById('uncancel-confirm-btn');

  const providers = tracked.map(([provider]) => provider);
  assert.deepStrictEqual(providers, ['gtag', 'fbq', 'ttq'], 'all three providers counted the action');

  const [gtagCall] = tracked;
  assert.strictEqual(gtagCall[1], 'event', 'gtag is called as an event');
  assert.strictEqual(gtagCall[2], 'billing_action', 'with the billing action name');
  assert.strictEqual(gtagCall[3].action, 'uncancel_submit', 'and the action that happened');
});

test('#283: a half-blocked page counts what it can and still acts', async () => {
  // Blockers are per-provider: one list blocks Meta and leaves Google alone.
  // Each call has to stand on its own, which a single try/catch around all
  // three would not do.
  const { tracked, requests, clickById } = await wireBilling({ analyticsBlocked: false });

  delete globalThis.fbq;
  globalThis.ttq = {};

  await clickById('uncancel-confirm-btn');

  assert.deepStrictEqual(tracked.map(([provider]) => provider), ['gtag'], 'the provider that loaded still counts');
  assert.deepStrictEqual(requests.map((request) => request.route), ['/omega/payments/uncancel'], 'and the action ran');
});
