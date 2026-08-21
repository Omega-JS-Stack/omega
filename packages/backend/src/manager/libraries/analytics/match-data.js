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
 * normalization each platform requires on top, because an unnormalized hash
 * matches nobody. Email is the one value everybody normalizes alike (trimmed +
 * lowercased); the PHONE is not (#392): Meta's advanced matching hashes bare
 * digits, GA4's Measurement Protocol and TikTok's Events API both hash the E.164
 * form WITH the `+`. So the identity block carries BOTH digests under the same
 * key names the browser half uses (`web core/js/libs/analytics.js`), and each
 * sender picks its own.
 *
 * The normalizers themselves are the shared package's — `@omega.js/analytics/identity`
 * is where a platform's spec is written down, once, for both halves of a
 * conversion. Only the digest is local: the shared `sha256()` is async (a page's
 * only hash is `crypto.subtle`), and everything here is sync. The NAME rule
 * (#403) is the one normalizer written down here instead: no browser surface
 * sends a name, so the shared package carries no name key — the day one does,
 * this rule moves there with the rest.
 *
 * Everything here tolerates absence. The raw-API recovery lane writes orders with
 * no attribution and no request context at all, and a fire with external_id alone
 * is worth more than a throw.
 */
const crypto = require('crypto');

// @omega.js/analytics is a private workspace package: in the monorepo the bare
// specifier resolves via the workspace link (and the prepare-package vendor hook
// rewrites it in dist/), but src/ ships in the tarball UNREWRITTEN and the test
// corpus deep-requires it in consumers — so fall back to the copy vendored into
// dist/, which sits at the same depth from both trees.
let normalizeEmail;
let normalizeExternalId;
let metaPhone;
let tiktokPhone;
try {
  ({ normalizeEmail, normalizeExternalId, metaPhone, tiktokPhone } = require('@omega.js/analytics/identity'));
} catch (e) {
  ({ normalizeEmail, normalizeExternalId, metaPhone, tiktokPhone } = require('../../../../dist/vendor/analytics/identity.js'));
}

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
  const normalized = normalizeEmail(email);

  return normalized ? toSHA256(normalized) : null;
}

/**
 * Hash a NAME per GA4's user-data spec: trimmed, lowercased, then SHA256 — the
 * same rule email gets, and for the same reason: an account doc's casing is its
 * own business, and a raw digest misses every user who typed `Ada` where the ad
 * platform holds `ada`.
 *
 * @param {string} [name] - A given or family name as the account stores it.
 * @returns {string|null} The digest, or null when there is no name.
 */
function hashName(name) {
  const normalized = `${name || ''}`.trim().toLowerCase();

  return normalized ? toSHA256(normalized) : null;
}

/**
 * The bare digits of a stored phone — country code included, no `+`, no
 * punctuation — which is what both normalizations are built from.
 *
 * The account schema stores `{ countryCode, national }` as NUMBERS defaulting to
 * 0, and 0 means "no phone on file" — hashing it would hand every phoneless
 * account the same junk match key and poison the audience.
 *
 * @param {object|string} [telephone] - The user doc's `personal.telephone`
 *   ({ countryCode, national }), or a plain E.164 string (Auth's `phoneNumber`).
 * @returns {string} The digits, or '' when there is no number.
 */
function phoneDigits(telephone) {
  if (typeof telephone === 'string') {
    return metaPhone(telephone);
  }

  if (!telephone?.national) {
    return '';
  }

  return metaPhone(`${telephone.countryCode || ''}${telephone.national}`);
}

/**
 * Hash a phone number per META's advanced-matching spec: digits only (country
 * code included, no `+`, no punctuation), then SHA256.
 *
 * @param {object|string} [telephone] - `{ countryCode, national }`, or an E.164 string.
 * @returns {string|null} The digest, or null when there is no number.
 */
function hashPhone(telephone) {
  const digits = phoneDigits(telephone);

  return digits ? toSHA256(digits) : null;
}

/**
 * Hash a phone number in E.164 WITH the leading `+`, then SHA256 — what GA4's
 * Measurement Protocol and TikTok's Events API both ask for. A different digest
 * for the same person than `hashPhone()`, which is the entire point (#392).
 *
 * @param {object|string} [telephone] - `{ countryCode, national }`, or an E.164 string.
 * @returns {string|null} The digest, or null when there is no number.
 */
function hashPhoneE164(telephone) {
  const e164 = tiktokPhone(phoneDigits(telephone));

  return e164 ? toSHA256(e164) : null;
}

/**
 * Hash the uid the way TIKTOK's Events API demands of `external_id`: trimmed,
 * then SHA256 ([#410](https://github.com/Omega-JS-Stack/omega/issues/410)).
 *
 * Verified against the live docs, because a raw id here was the #397 failure
 * mode again — accepted by the API and matched to nobody. TikTok's
 * `/event/track/` reference: "external_id ... SHA-256 hashing is required", and
 * its Advanced Matching table takes the pixel half "Unhashed or hashed SHA-256.
 * Trim any leading and trailing spaces before hashing and ensure you are
 * consistent with the External ID used" — so the browser half hashes the same
 * uid the same way and the two halves still meet. The trim rule itself is the
 * shared package's `normalizeExternalId()`, like every other normalizer here:
 * one home, so the two halves cannot drift apart a character at a time.
 *
 * META is the deliberate exception and stays RAW on `identity.externalId`: its
 * customer-information reference marks external_id "Hashing recommended" (not
 * required), and its own Pixel example passes a bare id — so the raw uid is
 * what both Meta halves carry. GA4's sender needs it raw for a third reason:
 * `Manager.Analytics({ uuid })` derives the `user_id` from it.
 *
 * @param {string} [uid] - The owner's uid.
 * @returns {string|null} The digest, or null when there is no uid.
 */
function hashExternalId(uid) {
  const normalized = normalizeExternalId(uid);

  return normalized ? toSHA256(normalized) : null;
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
 * @param {string} options.uid - The owner's uid — the external_id every platform
 *   gets, raw for Meta and GA4, hashed for TikTok (`hashExternalId()`).
 * @param {string} [options.email] - The account's email address (hashed here, never sent raw).
 * @param {object|string} [options.telephone] - `{ countryCode, national }`, or an E.164 string.
 * @param {object} [options.request] - The captured `{ ip, userAgent }` of the checkout.
 * @returns {object} Only the keys that resolved to a value.
 */
function buildIdentity({ uid, email, telephone, request }) {
  return compact({
    externalId: uid || null,
    // TikTok's Events API requires the digest where Meta only recommends it, so
    // the id ships in both shapes and each sender picks its own (#410).
    tiktokExternalIdHash: hashExternalId(uid),
    emailHash: hashEmail(email),
    // One person, two digests — the normalization is the platform's, not ours.
    metaPhoneHash: hashPhone(telephone),
    tiktokPhoneHash: hashPhoneE164(telephone),
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
  hashExternalId,
  hashName,
  hashPhone,
  hashPhoneE164,
  toSHA256,
};
