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
 * Two more landed on 2026-08-27, and each has its case below too:
 *
 *  4. A TRIAL CHECKOUT FIRED A PURCHASE
 *     ([#654](https://github.com/Omega-JS-Stack/omega/issues/654)). `?track=true`
 *     rides EVERY checkout, so a $0 trial sent a browser Purchase while the
 *     webhook sent `trial_start`. The value was already 0 (the intent route puts
 *     `amount=0` on a trial's confirmation URL); the NAME was the defect — two
 *     different event names never deduplicate, so each platform counted the
 *     browser half as a second conversion on top of the server's trial.
 *  5. GA4 WAS LEFT OFF THE PURCHASE
 *     ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)). GA4
 *     deduplicates `purchase` on `transaction_id`, so the browser half can carry
 *     the session and the campaign a webhook has none of, and GA4 still counts
 *     one purchase.
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

/** The state the page parses out of the provider's redirect. */
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

test('#386/#656: the purchase pixel fires to all three, GA4 included', async (t) => {
  t.after(clearPage);

  const { tracked } = await trackOnce(purchaseState());

  assert.deepStrictEqual(
    tracked.map(([provider]) => provider),
    ['gtag', 'fbq', 'ttq'],
    'Meta and TikTok get the retargeting signal, and GA4 gets the browser attribution it deduplicates against the webhook on transaction_id (#656)',
  );

  const [google, meta, tiktok] = tracked;
  assert.strictEqual(google[1], 'event');
  assert.strictEqual(google[2], 'purchase');
  assert.strictEqual(google[3].transaction_id, 'ORD-1', 'the id the webhook sends too — GA4 collapses the two halves on it');
  assert.strictEqual(google[3].value, 19, 'and the browser half carries the real amount');
  assert.strictEqual(meta[1], 'track', 'Purchase is one of Meta\'s standard events');
  assert.strictEqual(meta[2], 'Purchase');
  assert.strictEqual(tiktok[1], 'Purchase', 'TikTok retired CompletePayment for its own Purchase (#652)');
});

test('#386: both halves name the same dedupe id, derived from the order', async (t) => {
  t.after(clearPage);

  const { tracked } = await trackOnce(purchaseState());

  const [, meta, tiktok] = tracked;

  // The backend keys the two browser-twinned events on the ORDER
  // (payments-webhooks/analytics.js resolveEventId) — the only id a browser holds.
  assert.deepStrictEqual(meta.at(-1), { eventID: 'purchase.ORD-1' }, 'Meta deduplicates on (event_name, event_id)');
  assert.deepStrictEqual(tiktok.at(-1), { event_id: 'purchase.ORD-1' }, 'and TikTok on event_id');
});

test('#654: a trial checkout fires trial_start with value 0 — never a purchase', async (t) => {
  t.after(clearPage);

  const { tracked } = await trackOnce(purchaseState({ hasFreeTrial: true }));

  assert.deepStrictEqual(
    tracked.map(([provider]) => provider),
    ['fbq', 'ttq'],
    'the ad platforms only: GA4\'s trial_start is a custom event with no dedupe, and the webhook owns it',
  );

  const [meta, tiktok] = tracked;

  assert.strictEqual(meta[2], 'StartTrial', 'Meta\'s own event for the start of a free trial');
  assert.strictEqual(meta[3].value, 0, 'a trial charges nothing, whatever amount the confirmation URL carried');
  assert.strictEqual(meta[3].currency, 'USD');
  assert.deepStrictEqual(meta.at(-1), { eventID: 'trial_start.ORD-1' }, 'and the id the webhook now derives the same way');

  assert.strictEqual(tiktok[1], 'StartTrial');
  assert.strictEqual(tiktok[2].value, 0);
  assert.deepStrictEqual(tiktok.at(-1), { event_id: 'trial_start.ORD-1' });
});

test('#654: a trial never sends a Purchase to any platform', async (t) => {
  t.after(clearPage);

  // The state's `amount: 19` is DEFENSIVE, not what a live trial arrives with:
  // the intent route already puts `amount=0` on a trial's confirmation URL. The
  // fixture proves the pixel's own guard, not the URL's.
  const { tracked } = await trackOnce(purchaseState({ hasFreeTrial: true }));

  const names = JSON.stringify(tracked);

  assert.strictEqual(names.includes('Purchase'), false, `a $0 trial must book no purchase anywhere: ${names}`);
  assert.strictEqual(names.includes('19'), false, 'nor the plan price nobody was charged');
});

test('#386: a one-time buy is not a subscription (the frequency-string bug)', async (t) => {
  t.after(clearPage);

  // Checkout sends `frequency=once` for a one-time purchase, so the old
  // `state.frequency ? 'subscription' : 'one-time'` called every one of them a
  // subscription — the same truthiness bug the receipt copy carried (#282).
  const { tracked } = await trackOnce(purchaseState({ frequency: 'once' }));

  const [, meta] = tracked;
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

test('#668: a one-time purchase reports itself as one to every platform', async () => {
  await bundleOnce();

  const { buildItems } = require(BUNDLE);

  // The live buy (order 5434-3892-3088) reached this file as
  // `frequency=annually` — checkout resolved a cadence for a product that has
  // none — so the browser purchase told GA4, Meta and TikTok that a $49.99
  // one-time buy was a subscription. The redirect now carries what was bought
  // outright, so even that URL is classified by the TYPE and the cadence beside
  // it decides nothing.
  const [stale] = buildItems(purchaseState({
    productId: 'launch-kit',
    productName: 'Starter Library',
    amount: 49.99,
    type: 'one-time',
    frequency: 'annually',
  }));

  assert.strictEqual(stale.item_category, 'one-time', 'the conversion is categorized by what was bought, not by the cadence beside it');
  assert.strictEqual(stale.item_variant, 'once', 'and a stale link never reports a cadence on a one-time buy');
  assert.strictEqual(stale.price, 49.99, 'at the price the card was charged');

  // And checkout now sends the word a one-time buy actually bills on, so a
  // freshly minted link names no cadence the buyer will never be billed on.
  const [item] = buildItems(purchaseState({
    productId: 'launch-kit',
    productName: 'Starter Library',
    amount: 49.99,
    type: 'one-time',
    frequency: 'once',
  }));

  assert.strictEqual(item.item_category, 'one-time', 'still a one-time purchase');
  assert.strictEqual(item.item_variant, 'once', 'and its variant is the one-time word, not a cadence');
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
