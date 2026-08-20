/**
 * The confirmation page's purchase PIXEL — revived, deduped, and classified
 * ([#386](https://github.com/Omega-JS-Stack/omega/issues/386), stage E of
 * [#328](https://github.com/Omega-JS-Stack/omega/issues/328); the two carried
 * bugs are specced on [#302](https://github.com/Omega-JS-Stack/omega/issues/302)).
 *
 * Three things were wrong at once, and each has a case here:
 *
 *  1. THE CALL WAS COMMENTED OUT. The backend's webhook captured the revenue,
 *     but the browser never told Meta or TikTok anything — so every purchase
 *     was invisible to the retargeting that paid for it.
 *  2. THE CLASSIFIER READ THE FREQUENCY STRING. `state.frequency ? 'subscription'
 *     : 'one-time'` called a one-time buy a subscription, because checkout sends
 *     `frequency=once` for one (#282, the same bug the receipt copy carried).
 *  3. NO DEDUPE ID. A browser half and a server half of the same purchase with
 *     no shared id are two purchases to Meta and TikTok.
 *
 * The module is browser code behind two bundler aliases, so the harness drives
 * the REAL file through esbuild — and through the REAL catalog, adapters and
 * guarded transport, so what the page globals receive is what a live pixel
 * would (the convention analytics-blocked.test.js sets).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const PKG = path.join(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const CORE_DIR = path.join(PKG, 'core');
const CONFIRMATION = path.join(CORE_DIR, 'js', 'pages', 'payment', 'confirmation');
const TRACKING_ENTRY = path.join(CONFIRMATION, 'modules', 'tracking.js');

// The client's built module — the door web core reaches the analytics package
// through, vendored copy and all.
const CLIENT_ANALYTICS = path.join(ROOT, 'packages', 'client', 'dist', 'modules', 'analytics.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-confirmation-pixel-'));
const BUNDLE = path.join(BUNDLE_DIR, 'tracking.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [TRACKING_ENTRY],
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
        // The REAL client module: the catalog, the adapters and the guarded
        // transport are the contract under test, never a stub of them.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/analytics\.js$/ }, () => {
          return { path: CLIENT_ANALYTICS };
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

/** A page with the pixels loaded and the visitor consented to everything. */
function wirePage() {
  const tracked = [];
  const stored = new Map([
    // The tracking-consent record the banner writes (#383). Without a granted
    // record the marketing category is closed and no pixel may be told anything.
    ['trackingConsent', { analytics: true, marketing: true, region: 'opt-out', version: 1 }],
  ]);

  globalThis.window = {
    location: { pathname: '/payment/confirmation', search: '?track=true', href: 'https://brand.test/payment/confirmation?track=true' },
    history: { replaceState: () => {} },
  };
  globalThis.document = { title: 'Confirmation', cookie: '' };
  globalThis.__omegaClient = {
    config: { analytics: { providers: { meta: { id: 'META-1' } } } },
    storage: () => ({
      get: (key, fallback) => (stored.has(key) ? stored.get(key) : fallback),
      set: (key, value) => stored.set(key, value),
    }),
  };

  globalThis.gtag = (...args) => tracked.push(['gtag', ...args]);
  globalThis.fbq = (...args) => tracked.push(['fbq', ...args]);
  globalThis.ttq = { track: (...args) => tracked.push(['ttq', ...args]) };

  return { tracked, stored };
}

function clearPage() {
  for (const name of ['gtag', 'fbq', 'ttq', 'window', 'document', '__omegaClient']) {
    delete globalThis[name];
  }
}

/** The state the page parses out of the processor's redirect. */
function purchaseState(overrides = {}) {
  return {
    orderId: 'ORD-1',
    productId: 'premium',
    productName: 'Premium',
    amount: 19,
    currency: 'USD',
    frequency: 'monthly',
    paymentMethod: 'stripe',
    hasFreeTrial: false,
    ...overrides,
  };
}

async function trackOnce(state) {
  await bundleOnce();

  const page = wirePage();

  delete require.cache[require.resolve(BUNDLE)];
  const tracking = require(BUNDLE);

  tracking.trackPurchaseIfNeeded(state);

  return page;
}

test('#386: the purchase pixel fires again, to the platforms that dedupe', async (t) => {
  t.after(clearPage);

  const { tracked } = await trackOnce(purchaseState());

  assert.deepStrictEqual(
    tracked.map(([provider]) => provider),
    ['fbq', 'ttq'],
    'Meta and TikTok get the retargeting signal — and GA4 does NOT: the webhook owns the revenue there, and GA4 has no cross-source dedupe, so a browser copy would be a second purchase',
  );

  const [meta, tiktok] = tracked;
  assert.strictEqual(meta[1], 'track', 'Purchase is one of Meta\'s standard events');
  assert.strictEqual(meta[2], 'Purchase');
  assert.strictEqual(tiktok[1], 'CompletePayment', 'TikTok\'s own name for the same conversion');
});

test('#386: both halves name the same dedupe id, derived from the order', async (t) => {
  t.after(clearPage);

  const { tracked } = await trackOnce(purchaseState());

  const [meta, tiktok] = tracked;

  // The backend keys a payment event `<canonical>.<webhook event id>`, falling
  // back to the order id (payments-webhooks/analytics.js resolveEventId). The
  // order id is the only half of that a browser holds.
  assert.deepStrictEqual(meta.at(-1), { eventID: 'purchase.ORD-1' }, 'Meta deduplicates on (event_name, event_id)');
  assert.deepStrictEqual(tiktok.at(-1), { event_id: 'purchase.ORD-1' }, 'and TikTok on event_id');
});

test('#386: a one-time buy is not a subscription (the frequency-string bug)', async (t) => {
  t.after(clearPage);

  // Checkout sends `frequency=once` for a one-time purchase, so the old
  // `state.frequency ? 'subscription' : 'one-time'` called every one of them a
  // subscription — the same truthiness bug the receipt copy carried (#282).
  const { tracked } = await trackOnce(purchaseState({ frequency: 'once' }));

  const [meta] = tracked;
  assert.strictEqual(meta[3].content_type, 'product', 'the item still rides as a product');

  const { tracked: subscription } = await trackOnce(purchaseState({ frequency: 'monthly' }));
  assert.ok(subscription.length, 'a subscription purchase still fires');
});

test('#386: the classifier reads the product, never the frequency string', async () => {
  await bundleOnce();

  const { buildItems } = require(BUNDLE);

  assert.strictEqual(
    buildItems(purchaseState({ frequency: 'once' }))[0].item_category,
    'one-time',
    'frequency=once is a one-time purchase',
  );
  assert.strictEqual(
    buildItems(purchaseState({ frequency: 'monthly' }))[0].item_category,
    'subscription',
    'a real billing cadence is a subscription',
  );
  assert.strictEqual(
    buildItems(purchaseState({ frequency: '' }))[0].item_category,
    'one-time',
    'and no frequency at all is not a subscription either',
  );
});

test('#386: the page really calls the tracker — the commented-out state is gone', () => {
  const source = fs.readFileSync(path.join(CONFIRMATION, 'index.js'), 'utf8');

  // Comments blanked, line structure intact: a call that only exists inside a
  // comment is exactly the bug this pins.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (match, before) => before + ' '.repeat(match.length - before.length));

  assert.match(code, /trackPurchaseIfNeeded\(state\)/, 'the confirmation page calls the purchase tracker in live code');
});
