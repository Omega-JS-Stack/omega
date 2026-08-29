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
    'contact_form_spam', 'review_prompt_show', 'status_subscribe', 'screen_view',
  ];

  for (const name of live) {
    assert.ok(entryFor(name), `${name} is in the catalog`);
    assert.ok(ga4.resolve(name, {}), `${name} resolves for GA4`);
  }

  // Spot check on the shape, not just the presence.
  const facebook = meta.resolve('pricing_toggle', { billing_type: 'yearly' });
  assert.strictEqual(facebook.name, 'PricingToggle');
  assert.strictEqual(facebook.kind, 'custom');
  assert.strictEqual(facebook.payload.billing_type, 'yearly');

  // GA4-only entries stay GA4-only: a spam signal never reaches an ad platform.
  assert.strictEqual(meta.resolve('contact_form_spam', {}), null);
  assert.strictEqual(tiktok.resolve('contact_form_spam', {}), null);
});

// The 2026-08-27 live cross-check ([#652]): every `standard` claim is spelled
// the way the platform's own list spells it, and a name the platform does not
// list may only be `custom`. The rosters below are the live pages verbatim:
//   Meta   https://www.facebook.com/business/help/402791146561655
//   TikTok https://ads.tiktok.com/help/article/standard-events-parameters
const META_STANDARD = [
  'AddPaymentInfo', 'AddToCart', 'AddToWishlist', 'CompleteRegistration', 'Contact',
  'CustomizeProduct', 'Donate', 'FindLocation', 'InitiateCheckout', 'Lead', 'PageView',
  'Purchase', 'Schedule', 'Search', 'StartTrial', 'SubmitApplication', 'Subscribe',
  'ViewContent',
];

const TIKTOK_STANDARD = [
  'AddPaymentInfo', 'AddToCart', 'AddToWishlist', 'ApplicationApproval',
  'CompleteRegistration', 'Contact', 'CustomizeProduct', 'Download', 'FindLocation',
  'InitiateCheckout', 'Purchase', 'Schedule', 'Search', 'StartTrial',
  'SubmitApplication', 'SubmitForm', 'Subscribe', 'ViewContent',
];

test('a standard mapping only ever claims a name its platform actually lists', () => {
  for (const [name, entry] of Object.entries(CATALOG)) {
    for (const [provider, roster] of [['meta', META_STANDARD], ['tiktok', TIKTOK_STANDARD]]) {
      const mapping = entry.providers[provider];

      if (mapping && mapping.kind === 'standard') {
        assert.ok(roster.includes(mapping.name), `${name} → ${provider} ${mapping.name} is on the platform's standard list`);
      }
    }
  }
});

test('the names the platforms retired or never had are gone from the catalog', () => {
  // TikTok retired CompletePayment for Purchase, and ClickButton is on NEITHER
  // roster — both were claimed as `standard` until the live check ([#652]).
  const claimed = Object.values(CATALOG)
    .flatMap((entry) => Object.values(entry.providers))
    .map((mapping) => mapping.name);

  assert.strictEqual(claimed.includes('CompletePayment'), false, 'CompletePayment is retired');
  assert.strictEqual(claimed.includes('ClickButton'), false, 'ClickButton was never a standard event');

  // Meta's Subscribe means "the START of a paid subscription", which is what
  // `purchase` and `trial_start` already say — so it is deliberately unused,
  // and a renewal is a Purchase (Ian's money-event table).
  const metaNames = Object.values(CATALOG)
    .map((entry) => entry.providers.meta)
    .filter(Boolean)
    .map((mapping) => mapping.name);

  assert.strictEqual(metaNames.includes('Subscribe'), false, 'Meta Subscribe stays unused');
});

test('the dropped and renamed names are gone', () => {
  // The new consent system has no auto-accept-on-scroll.
  assert.strictEqual(entryFor('cookie_consent_auto_accept'), null);
  // GA4's standard name replaces the literal `download` the page sends today.
  assert.strictEqual(entryFor('download'), null);
  assert.ok(entryFor('file_download'), 'file_download is the canonical name');
});

test('the email-preferences pair carries the same marketing prefix', () => {
  // One ternary on one page fires both halves ([#416]): an opt-out named for a
  // different family than the opt-in it sits beside is a reporting trap.
  assert.strictEqual(entryFor('email_unsubscribe'), null, 'the unprefixed opt-out name is gone');

  for (const name of ['marketing_email_subscribe', 'marketing_email_unsubscribe']) {
    const google = ga4.resolve(name, { content_type: 'marketing' });

    assert.strictEqual(google.name, name, `${name} resolves on GA4 under its own name`);
    assert.strictEqual(google.kind, 'custom', `${name} is a GA4 custom event`);
  }

  // Meta's wire names are the live custom ones, untouched by the rename: the
  // canonical key moved, the data continuity in the ad account did not.
  assert.strictEqual(meta.resolve('marketing_email_subscribe', {}).name, 'EmailSubscribe');
  assert.strictEqual(meta.resolve('marketing_email_unsubscribe', {}).name, 'EmailUnsubscribe');
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
  // One CHARGE's id — the order on a first purchase, the provider's invoice id
  // on a renewal. NEVER the subscription id, which GA4 would dedupe every later
  // charge away on ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)).
  transaction_id: 'ORD-1',
  value: 49.99,
  currency: 'USD',
  items: [{ item_id: 'pro', item_name: 'Pro Plan', item_category: 'subscription', price: 49.99, quantity: 1 }],
  is_trial: false,
  is_recurring: false,
  payment_provider: 'stripe',
};

test('purchase maps to Purchase on both ad platforms, with value and currency intact', () => {
  const google = ga4.resolve('purchase', PURCHASE_PARAMS);
  assert.strictEqual(google.name, 'purchase');
  assert.strictEqual(google.kind, 'standard');
  assert.deepEqual(google.payload.items, PURCHASE_PARAMS.items, 'GA4 keeps its own items array');
  assert.strictEqual(google.payload.value, 49.99);
  assert.strictEqual(google.payload.currency, 'USD');
  // GA4 deduplicates `purchase` on transaction_id, so the param is not optional
  // decoration — it is the key the browser and the webhook halves collapse on
  // ([#656](https://github.com/Omega-JS-Stack/omega/issues/656)).
  assert.strictEqual(google.payload.transaction_id, 'ORD-1');

  const facebook = meta.resolve('purchase', PURCHASE_PARAMS);
  assert.strictEqual(facebook.name, 'Purchase');
  assert.strictEqual(facebook.kind, 'standard');
  assert.strictEqual(facebook.payload.value, 49.99, 'Meta REQUIRES value and currency on a Purchase');
  assert.strictEqual(facebook.payload.currency, 'USD');
  assert.deepEqual(facebook.payload.content_ids, ['pro'], 'Meta speaks content_ids, not items');
  assert.strictEqual(facebook.payload.content_name, 'Pro Plan');
  assert.strictEqual(facebook.payload.num_items, 1);
  assert.strictEqual(facebook.payload.items, undefined, 'GA4 vocabulary does not leak into Meta');

  const tt = tiktok.resolve('purchase', PURCHASE_PARAMS);
  assert.strictEqual(tt.name, 'Purchase', 'TikTok retired CompletePayment');
  assert.strictEqual(tt.kind, 'standard');
  assert.strictEqual(tt.payload.value, 49.99);
  assert.strictEqual(tt.payload.currency, 'USD');
  assert.strictEqual(tt.payload.content_type, 'product');
  assert.deepEqual(
    tt.payload.contents,
    [{ content_id: 'pro', content_name: 'Pro Plan', price: 49.99, quantity: 1 }],
    'TikTok speaks a contents array of product objects — the shape its pixel reference documents',
  );
  assert.strictEqual(tt.payload.content_id, undefined, 'and the flat single-item shape is gone');
  assert.strictEqual(tt.payload.price, undefined);
});

test('every item rides TikTok\'s contents array, not just the first', () => {
  // The flat shape could only ever describe items[0]; `contents` is a list.
  const tt = tiktok.resolve('purchase', {
    ...PURCHASE_PARAMS,
    items: [
      { item_id: 'pro', item_name: 'Pro Plan', price: 40, quantity: 1 },
      { item_id: 'addon', item_name: 'Extra Seat', price: 9.99, quantity: 2 },
    ],
  });

  assert.deepEqual(tt.payload.contents, [
    { content_id: 'pro', content_name: 'Pro Plan', price: 40, quantity: 1 },
    { content_id: 'addon', content_name: 'Extra Seat', price: 9.99, quantity: 2 },
  ]);
});

test('a trial start is StartTrial on both ad platforms, and the browser may fire it', () => {
  // TikTok's Subscribe ("subscribes... including paid subscriptions") said a
  // trial was a subscription; StartTrial is the event both platforms define for
  // "a customer begins a free trial" ([#652]). The browser half exists because a
  // trial checkout used to fire `purchase` there ([#654]).
  const params = { ...PURCHASE_PARAMS, transaction_id: 'ORD-1', value: 0, is_trial: true };

  assert.strictEqual(entryFor('trial_start').placement, 'both');

  const facebook = meta.resolve('trial_start', params);
  assert.strictEqual(facebook.name, 'StartTrial');
  assert.strictEqual(facebook.kind, 'standard');
  assert.strictEqual(facebook.payload.value, 0, 'a trial charges nothing');
  assert.strictEqual(facebook.payload.currency, 'USD');

  const tt = tiktok.resolve('trial_start', params);
  assert.strictEqual(tt.name, 'StartTrial');
  assert.strictEqual(tt.kind, 'standard');
  assert.strictEqual(tt.payload.value, 0);
  assert.strictEqual(tt.payload.currency, 'USD');

  // GA4's trial_start is a custom event: no standard purchase to deduplicate,
  // so the server owns it outright and the browser half names ads only.
  const google = ga4.resolve('trial_start', params);
  assert.strictEqual(google.name, 'trial_start');
  assert.strictEqual(google.kind, 'custom');
});

test('the recurring events ride GA4 purchase with is_recurring set, and Purchase on the ad platforms', () => {
  for (const name of ['subscription_renew', 'payment_recovered']) {
    const google = ga4.resolve(name, { ...PURCHASE_PARAMS, is_recurring: false });
    assert.strictEqual(google.name, 'purchase', `${name} → GA4 purchase`);
    assert.strictEqual(google.payload.is_recurring, true, `${name} is flagged recurring for GA4`);

    // Every real charge is a Purchase: Meta's Subscribe means the START of a
    // paid subscription, so a renewal counted a new subscriber every month
    // ([#652]).
    const facebook = meta.resolve(name, PURCHASE_PARAMS);
    assert.strictEqual(facebook.name, 'Purchase', `${name} → Meta Purchase`);
    assert.strictEqual(facebook.payload.value, 49.99, 'for the real amount');
    assert.strictEqual(facebook.payload.currency, 'USD');

    const tt = tiktok.resolve(name, PURCHASE_PARAMS);
    assert.strictEqual(tt.name, 'Purchase', `${name} → TikTok Purchase`);
    assert.strictEqual(tt.payload.value, 49.99);
    assert.strictEqual(tt.payload.currency, 'USD');
  }
});

// The four subscription lifecycle moments the 2026-08-20 coverage audit found
// dark or mislabeled ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).

test('a trial conversion is a purchase everywhere — the first real charge', () => {
  const params = { ...PURCHASE_PARAMS, is_trial: true, is_recurring: false };

  const google = ga4.resolve('trial_convert', params);
  assert.strictEqual(google.name, 'purchase', 'the first real charge belongs in GA4\'s revenue report');
  assert.strictEqual(google.kind, 'standard');
  assert.strictEqual(google.payload.value, 49.99);
  assert.strictEqual(google.payload.is_trial, true, 'the pair of flags is what marks it inside GA4 purchase');
  assert.strictEqual(google.payload.is_recurring, false, 'a conversion is the FIRST payment, never a renewal');

  const facebook = meta.resolve('trial_convert', params);
  assert.strictEqual(facebook.name, 'Purchase', 'Meta already heard StartTrial — and money moving is a Purchase');
  assert.strictEqual(facebook.kind, 'standard');
  assert.strictEqual(facebook.payload.value, 49.99, 'the amount actually charged');
  assert.deepEqual(facebook.payload.content_ids, ['pro']);

  const tt = tiktok.resolve('trial_convert', params);
  assert.strictEqual(tt.name, 'Purchase');
  assert.strictEqual(tt.kind, 'standard');
  assert.strictEqual(tt.payload.value, 49.99);
  assert.deepEqual(tt.payload.contents, [{ content_id: 'pro', content_name: 'Pro Plan', price: 49.99, quantity: 1 }]);
});

// The exclusion-audience half ([#415](https://github.com/Omega-JS-Stack/omega/issues/415)).

test('a cancellation and a refund reach the ad platforms as zero-value audience signals', () => {
  for (const [name, native] of [['subscription_cancel', 'SubscriptionCancel'], ['refund', 'Refund']]) {
    const facebook = meta.resolve(name, PURCHASE_PARAMS);

    assert.strictEqual(facebook.name, native, `${name} → Meta ${native}`);
    assert.strictEqual(facebook.kind, 'custom', 'Meta defines no churn event, so this is a custom one and says so');
    assert.strictEqual(facebook.payload.value, 0, 'a churn signal must never book revenue in an ad account');
    assert.deepEqual(facebook.payload.content_ids, ['pro'], 'the plan is what makes the audience worth building');

    const tt = tiktok.resolve(name, PURCHASE_PARAMS);

    assert.strictEqual(tt.name, native, `${name} → TikTok ${native}`);
    assert.strictEqual(tt.kind, 'custom');
    assert.strictEqual(tt.payload.value, 0, 'TikTok cannot subtract revenue either');
    assert.deepEqual(tt.payload.contents, [{ content_id: 'pro', content_name: 'Pro Plan' }], 'who and which plan is the whole point of the audience');
    assert.strictEqual(tt.payload.contents[0].price, undefined, 'the per-item price would put the amount back on the wire');
    assert.strictEqual(tt.payload.contents[0].quantity, undefined, 'and Meta\'s signal carries neither, by construction');
  }

  // GA4 is where the money is netted, so it keeps the real number.
  assert.strictEqual(ga4.resolve('refund', PURCHASE_PARAMS).payload.value, 49.99);
  assert.strictEqual(ga4.resolve('subscription_cancel', PURCHASE_PARAMS).payload.value, 49.99);
});

test('the outcomes an ad platform has no use for stay GA4-only', () => {
  // `trial_lapse` is the deliberate omission of the exclusion lane above: a
  // lapsed trialist is a win-back audience to RETARGET, not one to hide ads
  // from. The other two are dark to an ad platform for the older reason — no
  // money moved, and a platform optimizes toward conversions.
  for (const name of ['trial_lapse', 'subscription_uncancel', 'subscription_plan_change']) {
    const google = ga4.resolve(name, PURCHASE_PARAMS);

    assert.strictEqual(google.name, name, `${name} resolves on GA4 under its own name`);
    assert.strictEqual(google.kind, 'custom', `no platform defines a standard ${name}`);
    assert.strictEqual(meta.resolve(name, PURCHASE_PARAMS), null, `${name} has no Meta mapping`);
    assert.strictEqual(tiktok.resolve(name, PURCHASE_PARAMS), null, `${name} has no TikTok mapping`);
  }
});

test('a plan change carries the plan it came from', () => {
  const entry = entryFor('subscription_plan_change');

  for (const param of ['previous_item_id', 'previous_item_name', 'previous_value']) {
    assert.ok(entry.params.includes(param), `subscription_plan_change declares ${param}`);
  }

  const google = ga4.resolve('subscription_plan_change', {
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

// ─── The live-spec cross-check's "wrong meaning" rows ([#652]) ───

test('an interaction the platforms do not define is a custom event under its canonical name', () => {
  // Each of these claimed a standard event whose OWN definition says something
  // else: Meta's SubmitApplication is "an application for a product, service or
  // program", its Lead "a submission of information", and both platforms'
  // ViewContent a page view. A toggle, a popup and a click are none of those.
  const rows = [
    ['feedback_submit', 'meta', 'FeedbackSubmit'],
    ['pricing_toggle', 'meta', 'PricingToggle'],
    ['pricing_toggle', 'tiktok', 'PricingToggle'],
    ['review_click', 'meta', 'ReviewClick'],
    ['review_click', 'tiktok', 'ReviewClick'],
    ['copy_link', 'tiktok', 'CopyLink'],
    ['exit_popup_show', 'tiktok', 'ExitPopupShow'],
    ['exit_popup_click', 'meta', 'ExitPopupClick'],
    ['exit_popup_click', 'tiktok', 'ExitPopupClick'],
    ['exit_popup_dismiss', 'tiktok', 'ExitPopupDismiss'],
  ];

  const adapters = { meta: meta, tiktok: tiktok };

  for (const [name, provider, native] of rows) {
    const descriptor = adapters[provider].resolve(name, {});

    assert.strictEqual(descriptor.name, native, `${name} → ${provider} ${native}`);
    assert.strictEqual(descriptor.kind, 'custom', `${name} → ${provider} is a custom event, honestly declared`);
  }
});

test('a lead form is a form submit to TikTok, and still a Lead to Meta', () => {
  // TikTok's Contact is "when a visitor contacts you"; a lead form is its
  // SubmitForm. Meta's Lead — "a submission of information by a customer with
  // the understanding that they may be contacted" — is exactly this event.
  assert.strictEqual(tiktok.resolve('generate_lead', { lead_source: 'pricing' }).name, 'SubmitForm');
  assert.strictEqual(tiktok.resolve('generate_lead', {}).kind, 'standard');
  assert.strictEqual(meta.resolve('generate_lead', {}).name, 'Lead');
  assert.strictEqual(ga4.resolve('generate_lead', {}).name, 'generate_lead');
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
  ga4.resolve('subscription_renew', params);

  assert.deepEqual(params, PURCHASE_PARAMS, 'the caller object is untouched');
});

// ─── No mapping ───

test('an unmapped provider resolves to null', () => {
  // vert_click is GA4-only; user_refund_request likewise.
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

test('the touch\'s page rides the descriptor for the server senders', () => {
  // The attribution touch is the only URL a server conversion has any claim to
  // (a webhook has no page of its own), and the two ad platforms both read one:
  // TikTok's `page: { url, referrer }` data-item member and Meta's
  // `event_source_url` ([#497](https://github.com/Omega-JS-Stack/omega/issues/497)).
  const context = { attribution: { url: 'https://brand.test/pricing?utm_source=meta', referrer: 'https://facebook.com/' } };

  for (const adapter of [meta, tiktok]) {
    const descriptor = adapter.resolve('purchase', { value: 9.99, currency: 'USD' }, context);

    assert.deepEqual(descriptor.page, { url: 'https://brand.test/pricing?utm_source=meta', referrer: 'https://facebook.com/' }, `${adapter.provider} carries the page`);
    assert.strictEqual(descriptor.payload.url, undefined, `${adapter.provider} never rides the url in the event payload`);
    assert.strictEqual(descriptor.userData.url, undefined, 'nor in the match block');
  }

  // GA4's Measurement Protocol has no slot the campaign params do not already
  // fill, and an invented one is worse than an absent one.
  const google = ga4.resolve('purchase', { value: 9.99, currency: 'USD' }, context);

  assert.strictEqual(Object.hasOwn(google, 'page'), false, 'GA4 is untouched');
  assert.strictEqual(google.payload.url, undefined, 'and gains no url param');
});

test('a touch with no referrer carries a page of the url alone', () => {
  const context = { attribution: { url: 'https://brand.test/' } };

  for (const adapter of [meta, tiktok]) {
    const descriptor = adapter.resolve('purchase', { value: 9.99 }, context);

    assert.deepEqual(descriptor.page, { url: 'https://brand.test/' }, `${adapter.provider} sends the url without an empty referrer`);
    assert.strictEqual(Object.hasOwn(descriptor.page, 'referrer'), false, 'a direct landing has no referrer to send');
  }
});

test('no touch url means no page at all', () => {
  // The raw-API recovery lane: no browser was ever involved. A referrer with no
  // url is not half a page — it is nothing to send.
  for (const attribution of [undefined, {}, { referrer: 'https://facebook.com/' }]) {
    for (const adapter of [meta, tiktok]) {
      const descriptor = adapter.resolve('purchase', { value: 9.99 }, { attribution: attribution });

      assert.strictEqual(Object.hasOwn(descriptor, 'page'), false, `${adapter.provider} invents no page from ${JSON.stringify(attribution)}`);
    }
  }
});

test('every descriptor carries a userData block for the server enrichment', () => {
  for (const adapter of ADAPTERS) {
    const descriptor = adapter.resolve('sign_up', { method: 'email' });
    assert.deepEqual(descriptor.userData, {}, `${adapter.provider} has an empty match block by default`);
  }
});
