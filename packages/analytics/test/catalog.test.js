/**
 * Catalog + adapter tests — the mapping layer is pure, so these are the
 * cheapest place to pin what each provider is told.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CATALOG, PLACEMENTS, KINDS, entryFor } = require('../src/catalog.js');
const ga4 = require('../src/adapters/ga4.js');
const meta = require('../src/adapters/meta.js');
const tiktok = require('../src/adapters/tiktok.js');

const ADAPTERS = [ga4, meta, tiktok];

// ─── Integrity ───

test('every entry declares a valid placement and a params array', () => {
  for (const [name, entry] of Object.entries(CATALOG)) {
    assert.ok(PLACEMENTS.includes(entry.placement), `${name} has placement "${entry.placement}"`);
    assert.ok(Array.isArray(entry.params), `${name} declares a params array`);
    assert.ok(entry.providers && typeof entry.providers === 'object', `${name} declares a providers object`);
  }
});

test('every provider mapping declares a native name and a known kind', () => {
  for (const [name, entry] of Object.entries(CATALOG)) {
    for (const [provider, mapping] of Object.entries(entry.providers)) {
      assert.ok(['ga4', 'meta', 'tiktok'].includes(provider), `${name} maps a known provider, got "${provider}"`);
      assert.ok(mapping.name && typeof mapping.name === 'string', `${name}.${provider} has a native name`);
      assert.ok(KINDS.includes(mapping.kind), `${name}.${provider} kind is standard|custom, got "${mapping.kind}"`);
      if (mapping.map !== undefined) {
        assert.strictEqual(typeof mapping.map, 'function', `${name}.${provider} map is a function`);
      }
    }
  }
});

test('the only zero-provider entries are the deliberate ones', () => {
  const empty = Object.entries(CATALOG)
    .filter(([, entry]) => Object.keys(entry.providers).length === 0)
    .map(([name]) => name)
    .sort();

  // A logout is not an ad signal; the signup funnel entry is ours to read.
  assert.deepEqual(empty, ['logout', 'sign_up_started']);
});

test('the live call sites the audit found all resolve — none can throw at rewire', () => {
  const live = [
    'pricing_toggle', 'contact_enterprise', 'copy_link',
    'contact_form_spam', 'review_prompt_shown', 'status_subscribe', 'screen_view',
  ];

  for (const name of live) {
    assert.ok(entryFor(name), `${name} is in the catalog`);
    assert.ok(ga4.resolve(name, {}), `${name} resolves for GA4`);
  }

  // Spot check on the shape, not just the presence.
  const facebook = meta.resolve('pricing_toggle', { billing_type: 'yearly' });
  assert.strictEqual(facebook.name, 'ViewContent');
  assert.strictEqual(facebook.kind, 'standard');
  assert.strictEqual(facebook.payload.billing_type, 'yearly');

  // GA4-only entries stay GA4-only: a spam signal never reaches an ad platform.
  assert.strictEqual(meta.resolve('contact_form_spam', {}), null);
  assert.strictEqual(tiktok.resolve('contact_form_spam', {}), null);
});

test('TikTok ViewContent and ClickButton are declared standard everywhere', () => {
  for (const [name, entry] of Object.entries(CATALOG)) {
    const mapping = entry.providers.tiktok;
    if (mapping && ['ViewContent', 'ClickButton'].includes(mapping.name)) {
      assert.strictEqual(mapping.kind, 'standard', `${name} → TikTok ${mapping.name} is a standard web event`);
    }
  }
});

test('the dropped and renamed names are gone', () => {
  // The new consent system has no auto-accept-on-scroll.
  assert.strictEqual(entryFor('cookie_consent_auto_accept'), null);
  // GA4's standard name replaces the literal `download` the page sends today.
  assert.strictEqual(entryFor('download'), null);
  assert.ok(entryFor('file_download'), 'file_download is the canonical name');
});

// ─── Page view ───

test('page_view maps all three providers, so one fire is the whole page view', () => {
  // The raw `fbq('track', 'PageView')` / `ttq.page()` the web loader fired at
  // pixel init are retired ([#409](https://github.com/Omega-JS-Stack/omega/issues/409)):
  // the catalog is what tells each platform about a page now.
  const params = { page_path: '/pricing', page_title: 'Pricing', page_location: 'https://brand.test/pricing' };

  const google = ga4.resolve('page_view', params);
  assert.strictEqual(google.name, 'page_view');
  assert.strictEqual(google.kind, 'standard');
  assert.strictEqual(google.payload.page_path, '/pricing', 'GA4 is pass-through, so the page params ride as-is');

  const facebook = meta.resolve('page_view', params);
  assert.strictEqual(facebook.name, 'PageView', 'Meta defines PageView — the pixel snippet\'s own standard event');
  assert.strictEqual(facebook.kind, 'standard');

  const tt = tiktok.resolve('page_view', params);
  assert.strictEqual(tt.name, 'Pageview', 'the event TikTok records for it — for the catalog and the fire log');
  assert.strictEqual(tt.kind, 'custom', 'a pixel method is not a standard trackable name');
  assert.strictEqual(tt.method, 'page', 'and the descriptor names the method TikTok documents: ttq.page()');
});

test('a pixel method is named by exactly one mapping', () => {
  // `method` exists for TikTok's SDK-managed page view and nothing else. Every
  // other mapping is a tracked event NAME, and a stray method would silently
  // stop a fire from reaching `ttq.track`.
  const named = Object.entries(CATALOG)
    .filter(([, entry]) => Object.values(entry.providers).some((mapping) => mapping.method !== undefined))
    .map(([name]) => name);

  assert.deepEqual(named, ['page_view']);
});

// ─── Commerce mapping ───

const PURCHASE_PARAMS = {
  transaction_id: 'sub_123',
  value: 49.99,
  currency: 'USD',
  items: [{ item_id: 'pro', item_name: 'Pro Plan', item_category: 'subscription', price: 49.99, quantity: 1 }],
  is_trial: false,
  is_recurring: false,
  payment_processor: 'stripe',
};

test('purchase maps to Purchase/CompletePayment with value and currency intact', () => {
  const google = ga4.resolve('purchase', PURCHASE_PARAMS);
  assert.strictEqual(google.name, 'purchase');
  assert.strictEqual(google.kind, 'standard');
  assert.deepEqual(google.payload.items, PURCHASE_PARAMS.items, 'GA4 keeps its own items array');
  assert.strictEqual(google.payload.value, 49.99);
  assert.strictEqual(google.payload.currency, 'USD');
  assert.strictEqual(google.payload.transaction_id, 'sub_123');

  const facebook = meta.resolve('purchase', PURCHASE_PARAMS);
  assert.strictEqual(facebook.name, 'Purchase');
  assert.strictEqual(facebook.kind, 'standard');
  assert.strictEqual(facebook.payload.value, 49.99);
  assert.strictEqual(facebook.payload.currency, 'USD');
  assert.deepEqual(facebook.payload.content_ids, ['pro'], 'Meta speaks content_ids, not items');
  assert.strictEqual(facebook.payload.content_name, 'Pro Plan');
  assert.strictEqual(facebook.payload.num_items, 1);
  assert.strictEqual(facebook.payload.items, undefined, 'GA4 vocabulary does not leak into Meta');

  const tt = tiktok.resolve('purchase', PURCHASE_PARAMS);
  assert.strictEqual(tt.name, 'CompletePayment');
  assert.strictEqual(tt.kind, 'standard');
  assert.strictEqual(tt.payload.value, 49.99);
  assert.strictEqual(tt.payload.currency, 'USD');
  assert.strictEqual(tt.payload.content_id, 'pro', 'TikTok speaks a single content_id');
  assert.strictEqual(tt.payload.price, 49.99);
  assert.strictEqual(tt.payload.quantity, 1);
});

test('the recurring events ride GA4 purchase with is_recurring set', () => {
  for (const name of ['subscription_renewed', 'payment_recovered']) {
    const google = ga4.resolve(name, { ...PURCHASE_PARAMS, is_recurring: false });
    assert.strictEqual(google.name, 'purchase', `${name} → GA4 purchase`);
    assert.strictEqual(google.payload.is_recurring, true, `${name} is flagged recurring for GA4`);

    assert.strictEqual(meta.resolve(name).name, 'Subscribe');
    assert.strictEqual(tiktok.resolve(name).name, 'Subscribe');
  }
});

// The four subscription lifecycle moments the 2026-08-20 coverage audit found
// dark or mislabeled ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).

test('a trial conversion is a purchase to GA4 and a Subscribe to the ad platforms', () => {
  const params = { ...PURCHASE_PARAMS, is_trial: true, is_recurring: false };

  const google = ga4.resolve('trial_converted', params);
  assert.strictEqual(google.name, 'purchase', 'the first real charge belongs in GA4\'s revenue report');
  assert.strictEqual(google.kind, 'standard');
  assert.strictEqual(google.payload.value, 49.99);
  assert.strictEqual(google.payload.is_trial, true, 'the pair of flags is what marks it inside GA4 purchase');
  assert.strictEqual(google.payload.is_recurring, false, 'a conversion is the FIRST payment, never a renewal');

  const facebook = meta.resolve('trial_converted', params);
  assert.strictEqual(facebook.name, 'Subscribe', 'Meta already heard StartTrial — this is the subscription starting to pay');
  assert.strictEqual(facebook.kind, 'standard');
  assert.deepEqual(facebook.payload.content_ids, ['pro']);

  const tt = tiktok.resolve('trial_converted', params);
  assert.strictEqual(tt.name, 'Subscribe');
  assert.strictEqual(tt.kind, 'standard');
  assert.strictEqual(tt.payload.content_id, 'pro');
});

// The exclusion-audience half ([#415](https://github.com/Omega-JS-Stack/omega/issues/415)).

test('a cancellation and a refund reach the ad platforms as zero-value audience signals', () => {
  for (const [name, native] of [['subscription_cancelled', 'SubscriptionCancelled'], ['refund', 'Refunded']]) {
    const facebook = meta.resolve(name, PURCHASE_PARAMS);

    assert.strictEqual(facebook.name, native, `${name} → Meta ${native}`);
    assert.strictEqual(facebook.kind, 'custom', 'Meta defines no churn event, so this is a custom one and says so');
    assert.strictEqual(facebook.payload.value, 0, 'a churn signal must never book revenue in an ad account');
    assert.deepEqual(facebook.payload.content_ids, ['pro'], 'the plan is what makes the audience worth building');

    const tt = tiktok.resolve(name, PURCHASE_PARAMS);

    assert.strictEqual(tt.name, native, `${name} → TikTok ${native}`);
    assert.strictEqual(tt.kind, 'custom');
    assert.strictEqual(tt.payload.value, 0, 'TikTok cannot subtract revenue either');
    assert.strictEqual(tt.payload.content_id, 'pro');
    assert.strictEqual(tt.payload.price, undefined, 'the per-item price would put the amount back on the wire');
    assert.strictEqual(tt.payload.quantity, undefined, 'and Meta\'s signal carries neither, by construction');
  }

  // GA4 is where the money is netted, so it keeps the real number.
  assert.strictEqual(ga4.resolve('refund', PURCHASE_PARAMS).payload.value, 49.99);
  assert.strictEqual(ga4.resolve('subscription_cancelled', PURCHASE_PARAMS).payload.value, 49.99);
});

test('the outcomes an ad platform has no use for stay GA4-only', () => {
  // `trial_lapsed` is the deliberate omission of the exclusion lane above: a
  // lapsed trialist is a win-back audience to RETARGET, not one to hide ads
  // from. The other two are dark to an ad platform for the older reason — no
  // money moved, and a platform optimizes toward conversions.
  for (const name of ['trial_lapsed', 'subscription_uncancelled', 'plan_changed']) {
    const google = ga4.resolve(name, PURCHASE_PARAMS);

    assert.strictEqual(google.name, name, `${name} resolves on GA4 under its own name`);
    assert.strictEqual(google.kind, 'custom', `no platform defines a standard ${name}`);
    assert.strictEqual(meta.resolve(name, PURCHASE_PARAMS), null, `${name} has no Meta mapping`);
    assert.strictEqual(tiktok.resolve(name, PURCHASE_PARAMS), null, `${name} has no TikTok mapping`);
  }
});

test('a plan change carries the plan it came from', () => {
  const entry = entryFor('plan_changed');

  for (const param of ['previous_item_id', 'previous_item_name', 'previous_value']) {
    assert.ok(entry.params.includes(param), `plan_changed declares ${param}`);
  }

  const google = ga4.resolve('plan_changed', {
    ...PURCHASE_PARAMS,
    previous_item_id: 'starter',
    previous_item_name: 'Starter',
    previous_value: 9.99,
  });

  assert.strictEqual(google.payload.previous_item_id, 'starter', 'GA4 is pass-through, so the from-plan rides as-is');
  assert.strictEqual(google.payload.previous_item_name, 'Starter');
  assert.strictEqual(google.payload.previous_value, 9.99);
  assert.strictEqual(google.payload.items[0].item_id, 'pro', 'and items[] is still the plan they moved TO');
});

test('search hands the ad platforms search_string, GA4 search_term', () => {
  const params = { search_term: 'omega', content_category: 'blog' };

  assert.strictEqual(ga4.resolve('search', params).payload.search_term, 'omega');
  assert.strictEqual(meta.resolve('search', params).payload.search_string, 'omega');
  assert.strictEqual(meta.resolve('search', params).payload.search_term, undefined);
  assert.strictEqual(tiktok.resolve('search', params).payload.search_string, 'omega');
});

test('a map never mutates the caller params', () => {
  const params = { ...PURCHASE_PARAMS };
  meta.resolve('purchase', params);
  tiktok.resolve('purchase', params);
  ga4.resolve('subscription_renewed', params);

  assert.deepEqual(params, PURCHASE_PARAMS, 'the caller object is untouched');
});

// ─── No mapping ───

test('an unmapped provider resolves to null', () => {
  // vert_click is GA4-only; refund_action likewise.
  assert.ok(ga4.resolve('vert_click', { vert_id: 'x' }));
  assert.strictEqual(meta.resolve('vert_click', { vert_id: 'x' }), null);
  assert.strictEqual(tiktok.resolve('vert_click', { vert_id: 'x' }), null);
  assert.strictEqual(tiktok.resolve('cookie_banner_show'), null);
});

test('an unknown event resolves to null on every adapter', () => {
  for (const adapter of ADAPTERS) {
    assert.strictEqual(adapter.resolve('not_an_event', {}), null, `${adapter.provider} returns null`);
  }
});

// ─── Consent categories + attribution ───

test('each adapter exports its consent category', () => {
  assert.strictEqual(ga4.CONSENT_CATEGORY, 'analytics');
  assert.strictEqual(meta.CONSENT_CATEGORY, 'marketing');
  assert.strictEqual(tiktok.CONSENT_CATEGORY, 'marketing');
});

test('attribution lands where each provider wants it', () => {
  const attribution = { campaign: 'summer', source: 'newsletter', fbc: 'fb.1.x', ttclid: 'tt-1', gclid: 'g-1' };
  const context = { attribution };

  const google = ga4.resolve('sign_up', { method: 'google' }, context);
  assert.strictEqual(google.payload.campaign, 'summer', 'GA4 takes campaign as a flat event param');
  assert.strictEqual(google.payload.source, 'newsletter');
  assert.strictEqual(google.payload.gclid, 'g-1', 'GA4 has no match block, so the Google click id is a param too');
  assert.strictEqual(google.payload.fbc, undefined, 'another platform\'s click id never rides GA4');

  const facebook = meta.resolve('sign_up', { method: 'google' }, context);
  assert.strictEqual(facebook.userData.fbc, 'fb.1.x', 'Meta match data lands in userData');
  assert.strictEqual(facebook.payload.fbc, undefined, 'never in the custom data');

  const tt = tiktok.resolve('sign_up', { method: 'google' }, context);
  assert.strictEqual(tt.userData.ttclid, 'tt-1', 'TikTok click id lands in userData');
  assert.strictEqual(tt.payload.gclid, undefined, 'and GA4\'s param never rides another platform');
});

test('every descriptor carries a userData block for the server enrichment', () => {
  for (const adapter of ADAPTERS) {
    const descriptor = adapter.resolve('sign_up', { method: 'email' });
    assert.deepEqual(descriptor.userData, {}, `${adapter.provider} has an empty match block by default`);
  }
});
