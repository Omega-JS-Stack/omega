/**
 * The account page's USAGE BARS (`core/js/pages/dashboard/account/sections/
 * billing.js`) — what a customer is told about what they have left
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 *
 * The promises, all of them things a customer can be misled by:
 *  - a bar exists per COUNTED feature the catalog defines and the plan prices —
 *    a perk is not a meter and never draws one;
 *  - each counted feature shows BOTH numbers, today's and this month's, because
 *    either one can be the thing standing in the user's way: a paced feature
 *    refuses on the day's share long before the month runs out;
 *  - a feature that opted out of pacing shows only the month, since no day cap
 *    exists to be refused by;
 *  - override credits an admin granted are INCLUDED in the month's number and
 *    said out loud — the number beside the bar is not the number /pricing
 *    quotes, and a silent difference reads as a bug;
 *  - unlimited says "Unlimited" instead of drawing a percentage of nothing;
 *  - the name, icon and definition come from the CATALOG, so a brand renames a
 *    feature in one place.
 *
 * Same harness as billing-plan-switcher.test.js: the REAL module through
 * esbuild behind its bundler aliases, over a document that answers only the
 * ids the usage section writes, and the assertion is the HTML it wrote.
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

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-billing-usage-'));
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

// The FEATURES CATALOG: `saves` is counted and paced (the default), `exports`
// is counted but opted out of pacing, `support` is a perk.
const FEATURE_CATALOG = {
  saves: { name: 'Saves', icon: 'feather', definition: 'Notes you can save each month.', usage: {} },
  exports: { name: 'Exports', icon: 'file-export', usage: { pace: false } },
  support: { name: 'Priority support', icon: 'headset' },
};

const PAYMENT_CONFIG = {
  currency: 'USD',
  products: [
    { id: 'basic', name: 'Basic', type: 'subscription', prices: {}, features: { saves: 100 } },
    {
      id: 'premium',
      name: 'Premium',
      type: 'subscription',
      prices: { monthly: 10 },
      features: { saves: 3100, exports: 50, support: true },
    },
  ],
};

function makeElement() {
  return { innerHTML: '', listeners: {}, addEventListener() {}, querySelectorAll: () => [] };
}

function paidAccount(usage) {
  return {
    auth: { uid: 'user-647' },
    subscription: {
      product: { id: 'premium' },
      status: 'active',
      expires: { timestampUNIX: Math.floor(Date.now() / 1000) + 86400 },
    },
    usage: usage,
  };
}

/** Render the usage section for an account and hand back the HTML it wrote. */
async function renderUsage(account, config) {
  await bundleOnce();

  const elements = {
    'usage-metrics-container': makeElement(),
    'change-plan-modal': makeElement(),
    'change-plan-cadence': makeElement(),
    'change-plan-options': makeElement(),
    'change-plan-confirm-btn': makeElement(),
  };

  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = { location: { search: '', href: 'https://x.test/account' }, history: { replaceState() {} }, addEventListener() {} };
  globalThis.bootstrap = { Tooltip: class { static getInstance() { return null; } dispose() {} }, Modal: class { show() {} hide() {} static getOrCreateInstance() { return { show() {}, hide() {} }; } } };
  globalThis.__omegaClient = {
    config: { features: FEATURE_CATALOG },
    library: () => ({ motion: { scan: () => {} } }),
    auth: () => ({ resolveSubscription: (a) => resolveSubscription(a) }),
    bindings: () => ({ update: () => {} }),
    utilities: () => ({ showNotification: () => {}, escapeHTML: (value) => `${value}` }),
    request: async () => ({}),
  };

  delete require.cache[require.resolve(BUNDLE)];
  const billing = require(BUNDLE);

  await billing.init();
  await billing.loadData(account, config || PAYMENT_CONFIG);

  return elements['usage-metrics-container'].innerHTML;
}

test('usage bars: a bar per counted feature, both counters, catalog copy', async () => {
  const html = await renderUsage(paidAccount({
    saves: { monthly: 600, daily: 40, total: 9000 },
    exports: { monthly: 10, daily: 10 },
  }));

  // The catalog's name, icon and definition — not a hard-coded label map
  assert.ok(html.includes('Saves'), 'the catalog name');
  assert.ok(html.includes('fa-feather'), 'the catalog icon');
  assert.ok(html.includes('data-bs-title="Notes you can save each month."'), 'the catalog definition, on hover');

  // BOTH counters for the paced feature: 3100/month → ceil over a 28-31 day
  // month is 100..111 a day, so today's number is real either way
  assert.ok(/left today/.test(html), 'the day counter is shown');
  assert.ok(html.includes('2,500 of 3,100 left this month'), `the month counter is shown: ${html}`);

  // A perk is not a meter
  assert.ok(!html.includes('Priority support'), 'a perk draws no bar');
});

test('usage bars: a feature that opted out of pacing shows only the month', async () => {
  const html = await renderUsage(paidAccount({ exports: { monthly: 10, daily: 10 } }));

  const exportsBlock = html.slice(html.indexOf('Exports'));

  assert.ok(exportsBlock.includes('40 of 50 left this month'), `the month counter: ${exportsBlock}`);
  assert.ok(!exportsBlock.includes('left today'), 'no day cap exists, so none is drawn');
});

test('usage bars: override credits are IN the month number and said out loud', async () => {
  const html = await renderUsage(paidAccount({
    saves: { monthly: 3100, daily: 0 },
    overrides: { saves: 5000 },
  }));

  assert.ok(html.includes('1,900 of 5,000 left this month'), `the override is the limit that counts: ${html}`);
  assert.ok(html.includes('granted'), 'and the extra credits are named, not silently folded in');
});

test('usage bars: an override AT or BELOW the plan sets the limit and claims no credit', async () => {
  // An override is not always a grant — support can also DIAL A PLAN DOWN for
  // one account. The badge subtracts, so a lower override rendered "+-50
  // granted": a negative number announced as a gift.
  const lower = await renderUsage(paidAccount({
    saves: { monthly: 100, daily: 0 },
    overrides: { saves: 500 },
  }));

  assert.ok(lower.includes('400 of 500 left this month'), `the override is still the limit that counts: ${lower}`);
  assert.ok(!lower.includes('granted'), 'but nothing was granted, so nothing claims it was');
  assert.ok(!lower.includes('+-'), 'and no negative is dressed up as a credit');

  const equal = await renderUsage(paidAccount({
    saves: { monthly: 100, daily: 0 },
    overrides: { saves: 3100 },
  }));

  assert.ok(!equal.includes('granted'), 'an override equal to the plan grants nothing either');
});

test('usage bars: unlimited says so instead of drawing a percentage of nothing', async () => {
  const html = await renderUsage(paidAccount({ saves: { monthly: 90000, daily: 10 } }), {
    currency: 'USD',
    products: [{ id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 10 }, features: { saves: -1 } }],
  });

  assert.ok(html.includes('Unlimited this month'), `unlimited is stated: ${html}`);
  assert.ok(!html.includes('left today'), 'unlimited has no day share to be refused by, so no day bar is drawn');
  assert.ok(!html.includes('NaN') && !html.includes('Infinity'), 'and no arithmetic leaks');
});

test('usage bars: a plan that meters nothing says so', async () => {
  const html = await renderUsage({
    auth: { uid: 'user-647' },
    subscription: { product: { id: 'basic' }, status: 'active' },
    usage: {},
  }, { currency: 'USD', products: [{ id: 'basic', name: 'Basic', type: 'subscription', prices: {}, features: { support: true } }] });

  assert.ok(html.includes('Usage tracking not available for this plan.'), html);
});
