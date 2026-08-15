/**
 * The billing card's ACTION GATING (`core/js/pages/dashboard/account/sections/
 * billing.js`) — which buttons a given subscription is offered, i.e. the
 * `billing.buttons.*` flags `buildBillingState()` hands the bindings. #226 adds
 * the uncancel button, and the only state that may ever offer it is a live paid
 * subscription that is scheduled to end.
 *
 * Plus the DETAILS row beside them (`billing.details.*`): every paid state owes
 * the user its price, its cadence, and an honest date line. It used to gate on
 * `resolved.active && hasValidBilling`, so a cancelled or cancelling account —
 * the two states where "when does this end?" is the whole question — showed
 * nothing at all ([#236]). QA round 3 pins the next layer: all three slots
 * RENDER in every paid state, and a value the subscription never recorded says
 * so with the muted placeholder instead of dropping out of the row.
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
  // A billing page with no plan-switch request in its URL — the section reads
  // `?product=` on load ([#236]), and a browser always has a location to read.
  globalThis.window = {
    location: { pathname: '/dashboard/account', search: '', hash: '#billing' },
    history: { replaceState: () => {} },
  };
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
      // Change is NOT offered here: the backend refuses a switch under a
      // scheduled cancellation (`cancellation-pending`, #237), because the
      // processors swap the price and leave the schedule standing. Undo
      // cancellation is the honest button.
      what: 'a cancelling subscription',
      account: paidAccount({ status: 'active', cancellation: { pending: true, date: { timestampUNIX: HOUR_FROM_NOW } } }),
      buttons: { upgrade: false, change: false, manage: true, cancel: false, uncancel: true },
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
      // BOTH gates read the raw cancellation.pending flag, not
      // resolveSubscription().cancelling (which is `pending && !trialing`).
      // A trialing subscription CAN carry a scheduled cancellation — the
      // processor's own billing portal schedules one — and reading the derived
      // flag offered this account neither Change nor Undo: a dead end.
      what: 'a trial with a cancellation requested',
      account: paidAccount({
        status: 'active',
        trial: { claimed: true, expires: { timestampUNIX: HOUR_FROM_NOW } },
        cancellation: { pending: true, date: { timestampUNIX: HOUR_FROM_NOW } },
      }),
      buttons: { upgrade: false, change: false, manage: true, cancel: true, uncancel: true },
    },
  ];

  for (const testCase of cases) {
    const state = await billingStateFor(testCase.account);
    assert.deepStrictEqual(state.buttons, testCase.buttons, testCase.what);
  }
});

const TERM_END = Math.floor(Date.now() / 1000) + (86400 * 20);
const ENDED_AT = Math.floor(Date.now() / 1000) - 86400;

/** The date exactly as the section formats it. */
function shown(timestampUNIX) {
  return new Date(timestampUNIX * 1000).toLocaleDateString();
}

// The three slots of the details row, as the bindings receive them: a known
// value at full ink, an unknown one carrying the placeholder's own class.
const INK = 'omega-billing-detail';
const MUTED = 'omega-billing-detail omega-billing-detail--unknown';

/** The details state for one row, spelled out slot by slot. */
function row({ dateLabel, date, amount, cadence }) {
  return {
    visible: true,
    dateLabel: dateLabel,
    date: date || 'Unknown',
    dateClass: date ? INK : MUTED,
    amount: amount || 'Unknown',
    amountClass: amount ? INK : MUTED,
    cadence: cadence || 'Unknown',
    cadenceClass: cadence ? INK : MUTED,
  };
}

test('billing details: every paid state shows all three slots — price, cadence, honest date', async () => {
  const cases = [
    {
      // The repro (Ian, cancel journey): a cancelled account's card said the
      // subscription had ended and then showed no price, no cadence and no
      // date — the one screen that owes you "ended when?".
      what: 'an ended subscription says when it ended',
      account: paidAccount({ status: 'cancelled', cancellation: { pending: false, date: { timestampUNIX: ENDED_AT } } }),
      details: row({ dateLabel: 'Ended', date: shown(ENDED_AT), amount: '$10.00', cadence: 'Monthly' }),
    },
    {
      what: 'a scheduled cancellation says how long access lasts',
      account: paidAccount({ status: 'active', expires: { timestampUNIX: TERM_END }, cancellation: { pending: true, date: { timestampUNIX: TERM_END } } }),
      details: row({ dateLabel: 'Access until', date: shown(TERM_END), amount: '$10.00', cadence: 'Monthly' }),
    },
    {
      what: 'a live subscription renews',
      account: paidAccount({ status: 'active', expires: { timestampUNIX: TERM_END } }),
      details: row({ dateLabel: 'Renews', date: shown(TERM_END), amount: '$10.00', cadence: 'Monthly' }),
    },
    {
      // Nothing is scheduled while the payment is failing, so no date is
      // CLAIMED — but the slot still renders, named and placeheld, because a
      // row that silently loses a third of itself reads as broken.
      what: 'a suspended subscription names the date slot without claiming a date',
      account: paidAccount({ status: 'suspended', expires: { timestampUNIX: TERM_END } }),
      details: row({ dateLabel: 'Next billing', date: '', amount: '$10.00', cadence: 'Monthly' }),
    },
    {
      what: 'an ended subscription with no date on record keeps the slot, placeheld',
      account: paidAccount({ status: 'cancelled', expires: {}, cancellation: { pending: false } }),
      details: row({ dateLabel: 'Ended', date: '', amount: '$10.00', cadence: 'Monthly' }),
    },
    {
      what: 'a subscription with no recorded price places the amount, never prints undefined',
      account: paidAccount({ status: 'active', expires: { timestampUNIX: TERM_END }, payment: { processor: 'stripe' } }),
      details: row({ dateLabel: 'Renews', date: shown(TERM_END), amount: '', cadence: '' }),
    },
    {
      what: 'a price with no recorded cadence places the cadence alone',
      account: paidAccount({ status: 'active', expires: { timestampUNIX: TERM_END }, payment: { price: 10, processor: 'stripe' } }),
      details: row({ dateLabel: 'Renews', date: shown(TERM_END), amount: '$10.00', cadence: '' }),
    },
    {
      // The QA persona behind this round (_test-journey-flows-cancel): a live
      // subscription whose doc carries neither price nor frequency. Two of the
      // three slots used to vanish, leaving one date beside a blank half-row.
      what: 'the hollow persona places BOTH unknown slots and still dates the renewal',
      account: paidAccount({ status: 'active', expires: { timestampUNIX: TERM_END }, payment: { price: 0, frequency: null, processor: 'test' } }),
      details: row({ dateLabel: 'Renews', date: shown(TERM_END), amount: '', cadence: '' }),
    },
    {
      // Free accounts are unchanged: the whole row stays hidden, so what the
      // slots would have said never reaches a screen.
      what: 'a free account has no billing details at all',
      account: { subscription: { status: 'active', product: { id: 'basic', name: 'Basic' } } },
      details: { ...row({ dateLabel: 'Next billing', date: '', amount: '', cadence: '' }), visible: false },
    },
  ];

  for (const testCase of cases) {
    const state = await billingStateFor(testCase.account);
    assert.deepStrictEqual(state.details, testCase.details, testCase.what);

    // Nothing a subscription failed to record may reach the user as a
    // language-level accident.
    for (const [slot, value] of Object.entries(state.details)) {
      assert.ok(!/undefined|NaN/.test(String(value)), `${testCase.what}: ${slot} must never print an internal blank`);
    }
  }
});
