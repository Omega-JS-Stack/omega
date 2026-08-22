/**
 * Server-side conversion delivery — the ONE place a backend event reaches an ad
 * platform ([#385](https://github.com/Omega-JS-Stack/omega/issues/385), stage D
 * of [#302](https://github.com/Omega-JS-Stack/omega/issues/302)).
 *
 * Callers speak CANONICAL: one event name from `@omega.js/analytics`' catalog and
 * its canonical params. Every native name and payload shape comes from that
 * package's adapters, so the backend and the browser cannot drift — the catalog
 * is the SSOT for both. What lives here is the part a browser has no use for:
 * the three HTTP transports (GA4 Measurement Protocol, Meta Conversions API,
 * TikTok Events API) and the match data they carry.
 *
 * The name is checked against the catalog FIRST — an entry nobody knows is a
 * typo, and it says so once rather than reading like three deliberate
 * non-mappings. Then one fire walks the same three steps per provider the
 * browser facade walks:
 *   1. consent — the order's/user's `trackingConsent` snapshot gates the category
 *   2. adapter — the catalog mapping, or null when the provider has none
 *      (`subscription_plan_change` and `trial_lapse` are GA4-only by catalog design)
 *   3. transport — the platform's HTTP API, fire-and-forget, errors isolated
 *
 * Delivery is NON-BLOCKING and never throws at its caller: a payment webhook or
 * a user creation must never fail because an ad platform did.
 *
 * Google enhanced conversions PROPER (the Google Ads API, uploading hashed
 * identifiers against a gclid) is a FUTURE platform file — it is a different API,
 * a different credential and a different consent story. v1 is GA4 Measurement
 * Protocol carrying the campaign params and gclid as event params.
 */
const fetch = require('wonderful-fetch');

// @omega.js/analytics is a private workspace package: in the monorepo the bare
// specifier resolves via the workspace link (and the prepare-package vendor hook
// rewrites it in dist/), but src/ ships in the tarball UNREWRITTEN and the test
// corpus deep-requires it in consumers — so fall back to the copy vendored into
// dist/, which sits at the same depth from both trees.
let adapters;
let entryFor;
try {
  adapters = {
    ga4: require('@omega.js/analytics/adapters/ga4'),
    meta: require('@omega.js/analytics/adapters/meta'),
    tiktok: require('@omega.js/analytics/adapters/tiktok'),
  };
  ({ entryFor } = require('@omega.js/analytics/catalog'));
} catch (e) {
  adapters = {
    ga4: require('../../../../dist/vendor/analytics/adapters/ga4.js'),
    meta: require('../../../../dist/vendor/analytics/adapters/meta.js'),
    tiktok: require('../../../../dist/vendor/analytics/adapters/tiktok.js'),
  };
  ({ entryFor } = require('../../../../dist/vendor/analytics/catalog.js'));
}

// Meta's Graph version the Conversions API is called on.
const META_API_VERSION = 'v21.0';

/**
 * Resolve the consent snapshot into the two category answers.
 *
 * ABSENCE IS NOT A DENIAL. A legacy order predating the consent system, and the
 * raw-API recovery lane that mints orders with no client anywhere near them,
 * both carry no snapshot — and refusing to report their revenue would be a
 * silent accounting hole. Only an EXPLICIT `false` blocks.
 *
 * @param {object|null} [trackingConsent] - The `{ analytics, marketing, ... }` snapshot.
 * @returns {{ analytics: boolean, marketing: boolean }}
 */
function resolveTrackingConsent(trackingConsent) {
  return {
    analytics: trackingConsent?.analytics !== false,
    marketing: trackingConsent?.marketing !== false,
  };
}

/**
 * Deliver one canonical event to every provider that maps it.
 *
 * @param {object} options
 * @param {string} options.event - The canonical event name (a catalog entry).
 * @param {object} [options.params] - The canonical params for that event.
 * @param {object} [options.attribution] - The flat attribution context (match-data.js).
 * @param {object} [options.identity] - The identity block (match-data.js buildIdentity).
 * @param {object|null} [options.trackingConsent] - The consent snapshot that rode the payload.
 * @param {string[]} [options.providers] - Restrict the fire to these providers. For a
 *   `placement: 'both'` event whose halves do not all deduplicate — the caller names
 *   the providers THIS half owns. Absent = every provider the catalog maps.
 * @param {string} options.eventId - The platform dedupe id for this fire.
 * @param {object} options.ctx - The route/event context (logging + GA4's request data).
 * @param {object} options.Manager - The backend Manager (config + the GA4 helper).
 * @returns {object[]} One `{ provider, outcome }` per provider — for logs and tests.
 */
function deliverConversion({ event, params = {}, attribution = {}, identity = {}, trackingConsent = null, providers = null, eventId, ctx, Manager }) {
  const granted = resolveTrackingConsent(trackingConsent);
  const context = { attribution: attribution };
  const results = [];

  // A name the catalog does not know reaches every adapter and resolves to null
  // in each — indistinguishable, per-provider, from a real event a provider
  // deliberately does not map (`subscription_plan_change` on Meta). So a typo
  // in a canonical name would stop reporting revenue and say nothing about it.
  // It gets its OWN outcome and one loud line, and it still never throws: a
  // webhook that has already taken the customer's money must not die on a
  // misspelling.
  if (!entryFor(event)) {
    ctx.error(`deliverConversion: [unknown canonical event] ${event} — not in the catalog; nothing sent (event_id=${eventId})`);

    return Object.keys(adapters).map((provider) => ({ provider, outcome: 'skipped (unknown event)' }));
  }

  for (const [provider, adapter] of Object.entries(adapters)) {
    // Selection comes before consent: a provider this half does not own was
    // never going to be asked, whatever the visitor consented to.
    if (providers && !providers.includes(provider)) {
      results.push({ provider, outcome: 'skipped (not selected)' });
      continue;
    }

    if (!granted[adapter.CONSENT_CATEGORY]) {
      results.push({ provider, outcome: `skipped (consent: ${adapter.CONSENT_CATEGORY})` });
      continue;
    }

    const descriptor = adapter.resolve(event, params, context);

    if (!descriptor) {
      results.push({ provider, outcome: 'skipped (no mapping)' });
      continue;
    }

    try {
      results.push({ provider, outcome: SENDERS[provider]({ descriptor, identity, eventId, ctx, Manager }), descriptor });
    } catch (e) {
      ctx.error(`deliverConversion [${provider}] failed: ${e.message}`, e);
      results.push({ provider, outcome: 'failed' });
    }
  }

  ctx.log(`deliverConversion: ${event} → ${results.map((result) => `${result.provider} ${result.outcome}`).join(', ')} (event_id=${eventId})`);

  return results;
}

// ---------------------------------------------------------------------------
// GA4 — Measurement Protocol
// ---------------------------------------------------------------------------

/**
 * Fire the descriptor through the Measurement Protocol helper, which owns the
 * MP envelope (client id, user properties, request context) for the whole
 * backend. The descriptor's payload already carries the campaign params the GA4
 * adapter lifted out of the attribution context.
 *
 * No hashed PII here: `helpers/analytics.js` builds GA4's `user_data` from the
 * authenticated request's own user, which a webhook or an auth trigger does not
 * have. Meta and TikTok are where the match data earns its keep.
 *
 * https://developers.google.com/analytics/devguides/collection/protocol/ga4
 */
function sendGA4({ descriptor, identity, ctx, Manager }) {
  Manager.Analytics({ ctx, uuid: identity.externalId }).event(descriptor.name, descriptor.payload);

  return 'sent';
}

// ---------------------------------------------------------------------------
// Meta — Conversions API
// ---------------------------------------------------------------------------

/**
 * Build the Conversions API body for one descriptor.
 *
 * `user_data` is the match block: the adapter has already put `fbc`/`fbp` there,
 * and the identity block fills the rest. `event_id` is Meta's DEDUPLICATION key —
 * a browser event with the same name and id is counted once.
 *
 * https://developers.facebook.com/docs/marketing-api/conversions-api
 *
 * @param {object} options
 * @param {object} options.descriptor - The resolved provider descriptor.
 * @param {object} options.identity - The identity block (match-data.js).
 * @param {string} options.eventId - The dedupe id.
 * @returns {object} The POST body.
 */
function buildMetaBody({ descriptor, identity, eventId }) {
  const userData = { ...descriptor.userData };

  if (identity.externalId) {
    // RAW on purpose, verified against the live spec (#410): Meta's
    // customer-information reference marks external_id "Hashing recommended",
    // not required, and its Pixel example passes a bare id — so both Meta
    // halves carry the same raw uid. TikTok's is the half that must be hashed.
    userData.external_id = identity.externalId;
  }
  if (identity.emailHash) {
    userData.em = identity.emailHash;
  }
  if (identity.metaPhoneHash) {
    // Meta's own spec: the phone hashed as BARE DIGITS (#392).
    userData.ph = identity.metaPhoneHash;
  }
  if (identity.ip) {
    userData.client_ip_address = identity.ip;
  }
  if (identity.userAgent) {
    userData.client_user_agent = identity.userAgent;
  }

  return {
    data: [{
      event_name: descriptor.name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      user_data: userData,
      custom_data: descriptor.payload,
    }],
  };
}

function sendMeta({ descriptor, identity, eventId, ctx, Manager }) {
  const pixelId = Manager.config.analytics?.providers?.meta?.id;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return 'skipped (not configured)';
  }

  post(`https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${accessToken}`, {
    body: buildMetaBody({ descriptor, identity, eventId }),
  }, { provider: 'Meta', descriptor, ctx });

  return 'sent';
}

// ---------------------------------------------------------------------------
// TikTok — Events API
// ---------------------------------------------------------------------------

/**
 * Build the Events API body for one descriptor.
 *
 * TikTok's match block is `context.user` (hashed email, phone and external id,
 * plus `ttp`), with the click id in `context.ad.callback` and the request pair at
 * context level. The adapter has already put `ttclid`/`ttp` in `userData`; this
 * is where they land in TikTok's own vocabulary.
 *
 * https://business-api.tiktok.com/portal/docs?id=1771100865818625
 *
 * @param {object} options
 * @param {object} options.descriptor - The resolved provider descriptor.
 * @param {object} options.identity - The identity block (match-data.js).
 * @param {string} options.eventId - The dedupe id.
 * @param {string} options.pixelCode - The brand's TikTok pixel code.
 * @returns {object} The POST body.
 */
function buildTikTokBody({ descriptor, identity, eventId, pixelCode }) {
  const user = {};
  const context = {};

  if (identity.tiktokExternalIdHash) {
    // TikTok's Events API reference: "SHA-256 hashing is required" for
    // external_id, where Meta's spec only recommends it (#410). The browser
    // half hashes the same uid the same way, so the two still link.
    user.external_id = identity.tiktokExternalIdHash;
  }
  if (identity.emailHash) {
    user.email = identity.emailHash;
  }
  if (identity.tiktokPhoneHash) {
    // TikTok's own spec: the phone hashed in E.164, WITH the plus (#392) — a
    // different digest from Meta's for the same person.
    user.phone_number = identity.tiktokPhoneHash;
  }
  if (descriptor.userData.ttp) {
    user.ttp = descriptor.userData.ttp;
  }
  if (descriptor.userData.ttclid) {
    context.ad = { callback: descriptor.userData.ttclid };
  }
  if (identity.ip) {
    context.ip = identity.ip;
  }
  if (identity.userAgent) {
    context.user_agent = identity.userAgent;
  }

  return {
    data: [{
      pixel_code: pixelCode,
      event: descriptor.name,
      event_id: eventId,
      timestamp: new Date().toISOString(),
      context: { ...context, user: user },
      properties: descriptor.payload,
    }],
  };
}

function sendTikTok({ descriptor, identity, eventId, ctx, Manager }) {
  const pixelCode = Manager.config.analytics?.providers?.tiktok?.id;
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

  if (!pixelCode || !accessToken) {
    return 'skipped (not configured)';
  }

  post('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
    headers: { 'Access-Token': accessToken },
    body: buildTikTokBody({ descriptor, identity, eventId, pixelCode }),
  }, { provider: 'TikTok', descriptor, ctx });

  return 'sent';
}

// The provider key → its transport. A new platform joins here, in the catalog,
// and as an adapter — nothing else in the backend changes.
const SENDERS = {
  ga4: sendGA4,
  meta: sendMeta,
  tiktok: sendTikTok,
};

/**
 * Fire-and-forget POST. The conversion is a side effect of work that already
 * succeeded, so a platform being down is a log line, never a rejection.
 */
function post(url, options, { provider, descriptor, ctx }) {
  fetch(url, {
    method: 'post',
    response: 'json',
    timeout: 60000,
    tries: 2,
    ...options,
  })
    .then(() => {
      ctx.log(`deliverConversion [${provider}]: ${descriptor.name} delivered`);
    })
    .catch((e) => {
      ctx.error(`deliverConversion [${provider}] failed: ${e.message}`, e);
    });
}

module.exports = {
  deliverConversion,
  // Exported for testing — the payload shapes are the contract with the platforms
  resolveTrackingConsent,
  buildMetaBody,
  buildTikTokBody,
  adapters,
};
