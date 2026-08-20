/**
 * Conversion match data — everything a platform needs to tie a SERVER event back
 * to the person who clicked the ad
 * ([#385](https://github.com/Omega-JS-Stack/omega/issues/385), stage D of
 * [#302](https://github.com/Omega-JS-Stack/omega/issues/302)).
 *
 * Two halves, because the adapters already own the split:
 *
 *   buildAttributionContext() — the FLAT attribution the adapters read out of
 *     `context.attribution`: GA4 takes the campaign fields as event params,
 *     Meta takes `fbc`/`fbp` and TikTok `ttclid`/`ttp` into the descriptor's
 *     `userData` match block. What each provider wants is the adapter's call,
 *     never a caller's.
 *
 *   buildIdentity() — who the person is: the uid, their hashed email/phone, and
 *     the IP + user agent captured when they created the checkout intent. Each
 *     sender maps these into its own spec's key names.
 *
 * RAW PII NEVER LEAVES. Email and phone are SHA256 hex, the same mechanism the
 * GA4 Measurement Protocol helper uses (`helpers/analytics.js`) — with the
 * normalization Meta and TikTok both require on top (trimmed + lowercased email,
 * digits-only phone), because an unnormalized hash matches nobody.
 *
 * Everything here tolerates absence. The raw-API recovery lane writes orders with
 * no attribution and no request context at all, and a fire with external_id alone
 * is worth more than a throw.
 */
const crypto = require('crypto');

// The campaign params GA4's Measurement Protocol reads, and the utm key each one
// is captured under by the landing-page capture (`web core/js/core/query-strings.js`).
const CAMPAIGN_PARAMS = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  term: 'utm_term',
  content: 'utm_content',
};

/**
 * SHA256 hex, the hashing every platform's match spec asks for.
 * @param {string} value - The already-normalized value.
 * @returns {string} Lowercase hex digest.
 */
function toSHA256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Hash an email address per Meta/TikTok spec: trimmed, lowercased, then SHA256.
 * @param {string} [email]
 * @returns {string|null} The digest, or null when there is no email.
 */
function hashEmail(email) {
  const normalized = `${email || ''}`.trim().toLowerCase();

  return normalized ? toSHA256(normalized) : null;
}

/**
 * Hash a phone number per Meta/TikTok spec: digits only (country code included,
 * no `+`, no punctuation), then SHA256.
 *
 * The account schema stores `{ countryCode, national }` as NUMBERS defaulting to
 * 0, and 0 means "no phone on file" — hashing it would hand every phoneless
 * account the same junk match key and poison the audience.
 *
 * @param {object|string} [telephone] - The user doc's `personal.telephone`
 *   ({ countryCode, national }), or a plain E.164 string (Auth's `phoneNumber`).
 * @returns {string|null} The digest, or null when there is no number.
 */
function hashPhone(telephone) {
  if (typeof telephone === 'string') {
    const digits = telephone.replace(/\D/g, '');

    return digits ? toSHA256(digits) : null;
  }

  if (!telephone?.national) {
    return null;
  }

  const digits = `${telephone.countryCode || ''}${telephone.national}`.replace(/\D/g, '');

  return digits ? toSHA256(digits) : null;
}

/**
 * The touch a conversion is credited to: last touch when there is one, else first.
 *
 * Last-touch is only ever written by a TAGGED visit (#384), so falling back to
 * first is what gives an organic-then-direct user their campaign back.
 *
 * @param {object} [attribution] - The order/user `attribution` object.
 * @returns {object} The winning touch, or {} when there is none.
 */
function resolveTouch(attribution) {
  return attribution?.last || attribution?.first || {};
}

/**
 * Meta's `fbc` from a click id, per its spec: `fb.<subdomainIndex>.<creationTime>.<fbclid>`.
 *
 * The client only ever sends REAL cookies, so this is the server's half of the
 * deal: a visitor who landed on an ad but whose `_fbc` cookie never made it to
 * checkout (a different device, a cleared cookie jar, an ITP-shortened lifetime)
 * still matches, because the fbclid was captured at landing and rode the order.
 *
 * subdomainIndex is 1 — the cookie the Pixel would have written lives on the
 * brand's own domain. creationTime is the moment the click id was CAPTURED (the
 * touch's timestamp), which is what the cookie would have carried.
 *
 * @param {object} touch - The winning touch.
 * @returns {string|null} The constructed fbc, or null with no fbclid to build from.
 */
function constructFbc(touch) {
  const fbclid = touch?.clickIds?.fbclid;

  if (!fbclid) {
    return null;
  }

  const captured = Date.parse(touch.timestamp || '');
  const creationTime = Number.isNaN(captured) ? Date.now() : captured;

  return `fb.1.${creationTime}.${fbclid}`;
}

/**
 * The flat attribution context the adapters read.
 *
 * @param {object} [attribution] - The order/user `attribution` — { first, last, affiliate, cookies }.
 * @returns {object} Only the keys that resolved to a value.
 */
function buildAttributionContext(attribution) {
  const touch = resolveTouch(attribution);
  const cookies = attribution?.cookies || {};
  const clickIds = touch.clickIds || {};
  const tags = touch.tags || {};

  const context = {
    // GA4's campaign vocabulary (the adapter lifts these into the event params)
    ...Object.fromEntries(
      Object.entries(CAMPAIGN_PARAMS)
        .map(([param, utmKey]) => [param, tags[utmKey]])
        .filter(([, value]) => !!value)
    ),

    // Meta's match keys: the real cookie wins, and a click id constructs one.
    fbc: cookies.fbc || constructFbc(touch),
    fbp: cookies.fbp,

    // TikTok's match keys
    ttclid: clickIds.ttclid,
    ttp: cookies.ttp,

    // Google Ads' click id. GA4 MP takes it as an event param rather than a
    // match key — the Google Ads API's enhanced conversions (a FUTURE platform
    // file, see conversions.js) is what consumes it as identity.
    gclid: clickIds.gclid,
  };

  return compact(context);
}

/**
 * Who the conversion belongs to.
 *
 * @param {object} options
 * @param {string} options.uid - The owner's uid — the external_id every platform gets.
 * @param {string} [options.email] - The account's email address (hashed here, never sent raw).
 * @param {object|string} [options.telephone] - `{ countryCode, national }`, or an E.164 string.
 * @param {object} [options.request] - The captured `{ ip, userAgent }` of the checkout.
 * @returns {object} Only the keys that resolved to a value.
 */
function buildIdentity({ uid, email, telephone, request }) {
  return compact({
    externalId: uid || null,
    emailHash: hashEmail(email),
    phoneHash: hashPhone(telephone),
    ip: request?.ip || null,
    userAgent: request?.userAgent || null,
  });
}

// Drop the keys nothing resolved for — a match block carrying `fbp: undefined`
// is noise the platforms read as a field we tried and failed to send.
function compact(object) {
  const out = {};

  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }

  return out;
}

module.exports = {
  buildAttributionContext,
  buildIdentity,
  constructFbc,
  hashEmail,
  hashPhone,
  toSHA256,
};
