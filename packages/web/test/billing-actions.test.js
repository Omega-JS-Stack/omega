/**
 * The billing card's ACTION GATING (`core/js/pages/dashboard/account/sections/
 * billing.js`) — which buttons a given subscription is offered, i.e. the
 * `billing.buttons.*` flags `buildBillingState()` hands the bindings. #226 adds
 * the uncancel button, and the only state that may ever offer it is a live paid
 * subscription that is scheduled to end.
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild —
 * the convention auth-policy.test.js and dev-palette.test.js set — over a
 * document that answers nothing (the section wires its controls by id at
 * init(); this suite only calls loadData). Subscription resolution is NOT
 * stubbed: the stub client delegates to @omega.js/account, the same resolver
 * the real client calls, so "cancelling" here means what it means in
 * production. The assertion is the buttons object.
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

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-actions-'));
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
        // The cancel form's manager is a class the section only CONSTRUCTS
        // against a real #cancel-subscription-form (init(), which this suite
        // never calls). Its published build is a hybrid ESM/CJS file whose
        // `module.exports =` tail clobbers the harness bundle's own exports,
        // so it stays a name here.
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
    { id: 'pro', name: 'Pro', type: 'subscription', prices: { monthly: 25, annually: 250 } },
  ],
};

const HOUR_FROM_NOW = Math.floor(Date.now() / 1000) + 3600;

/** A paid subscription in whatever state the case needs. */
function paidAccount(subscription) {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      payment: { frequency: 'monthly', price: 10, processor: 'stripe' },
      expires: { timestampUNIX: HOUR_FROM_NOW },
      ...subscription,
    },
  };
}

/** The minimum client the section reaches for, plus the captured calls. */
function makeClient() {
  const updates = [];
  const notifications = [];

  const client = {
    updates,
    notifications,
    auth: () => ({ resolveSubscription: (account) => resolveSubscription(account) }),
    bindings: () => ({ update: (state) => updates.push(state) }),
    utilities: () => ({
      showNotification: (message, type) => notifications.push({ message, type }),
      escapeHTML: (value) => value,
    }),
    request: async () => ({}),
  };

  return client;
}

/** Load the REAL section against one stub client, hand back its bindings state. */
async function billingStateFor(account) {
  await bundleOnce();

  const client = makeClient();

  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = {};
  globalThis.__omegaClient = client;

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.loadData(account, PAYMENT_CONFIG);

  return client.updates.at(-1).billing;
}

test('billing buttons: only a live subscription scheduled to end offers undo', async () => {
  const cases = [
    {
      what: 'a cancelling subscription',
      account: paidAccount({ status: 'active', cancellation: { pending: true, date: { timestampUNIX: HOUR_FROM_NOW } } }),
      buttons: { upgrade: false, change: true, manage: true, cancel: false, uncancel: true },
    },
    {
      what: 'a plain active subscription',
      account: paidAccount({ status: 'active' }),
      buttons: { upgrade: false, change: true, manage: true, cancel: true, uncancel: false },
    },
    {
      what: 'a free account',
      account: { subscription: { status: 'active', product: { id: 'basic', name: 'Basic' } } },
      buttons: { upgrade: true, change: false, manage: false, cancel: false, uncancel: false },
    },
    {
      what: 'an ended subscription',
      account: paidAccount({ status: 'cancelled', cancellation: { pending: false } }),
      buttons: { upgrade: true, change: false, manage: false, cancel: false, uncancel: false },
    },
    {
      what: 'a suspended subscription',
      account: paidAccount({ status: 'suspended' }),
      buttons: { upgrade: false, change: false, manage: true, cancel: true, uncancel: false },
    },
    {
      // A trial cancellation is IMMEDIATE — there is no scheduled end to undo,
      // which is exactly why the gate reads resolveSubscription().cancelling
      // rather than the raw cancellation.pending flag.
      what: 'a trial with a cancellation requested',
      account: paidAccount({
        status: 'active',
        trial: { claimed: true, expires: { timestampUNIX: HOUR_FROM_NOW } },
        cancellation: { pending: true, date: { timestampUNIX: HOUR_FROM_NOW } },
      }),
      buttons: { upgrade: false, change: true, manage: true, cancel: true, uncancel: false },
    },
  ];

  for (const testCase of cases) {
    const state = await billingStateFor(testCase.account);
    assert.deepStrictEqual(state.buttons, testCase.buttons, testCase.what);
  }
});
