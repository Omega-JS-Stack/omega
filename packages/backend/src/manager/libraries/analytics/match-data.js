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
 *     `userData` match block, and both take the touch's page (`url`/`referrer`)
 *     into the descriptor's own `page` member. What each provider wants is the
 *     adapter's call, never a caller's.
 *
 *   buildIdentity() — who the person is: the uid, their hashed email/phone, the
 *     IP + user agent of the request that started this, and EVERY other match
 *     parameter the platforms accept off the account doc — name, city, state,
 *     zip, country, date of birth, gender
 *     ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)). Each sender
 *     maps these into its own spec's key names.
 *
 * RAW PII NEVER LEAVES. Every personal value is SHA256 hex, the same mechanism
 * the GA4 Measurement Protocol helper uses (`helpers/analytics.js`) — with the
 * normalization each platform requires on top, because an unnormalized hash
 * matches nobody. Email is the one value everybody normalizes alike (trimmed +
 * lowercased); the PHONE is not (#392): Meta's advanced matching hashes bare
 * digits, GA4's Measurement Protocol and TikTok's Events API both hash the E.164
 * form WITH the `+`. So the identity block carries BOTH digests under the same
 * key names the browser half uses (`web core/js/libs/analytics.js`), and each
 * sender picks its own.
 *
 * ONE TABLE PER PROVIDER, and no shared "close enough" normalizer: the rules
 * genuinely differ key by key (Meta wants a state as the 2-letter ANSI code and
 * a country lowercase; GA4 wants the region NAME and the country UPPERCASE), and
 * a value normalized by the wrong platform's rule is accepted by the API and
 * matched to nobody. Both tables were written against the platforms' live specs
 * (fetched 2026-08-24), each cited above its table below.
 *
 * TIKTOK gets no personal table because its Events API has no parameter to put
 * one in: the 2.0 `user` object documents email, phone, external_id, ttclid,
 * ttp, ip and user_agent, full stop.
 *
 * The email/phone/external-id normalizers are the shared package's —
 * `@omega.js/analytics/identity` is where a spec is written down once for BOTH
 * halves of a conversion. Only the digest is local: the shared `sha256()` is
 * async (a page's only hash is `crypto.subtle`), and everything here is sync.
 * The rules below are the ones written down here instead, for the reason the
 * NAME rule (#403) always was: no browser surface sends any of these, so the
 * shared package carries no key for them — the day one does, they move there
 * with the rest.
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

// ---------------------------------------------------------------------------
// META's customer-information table
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
// Every parameter below is "Hashing required", each with its own normalization.
// ---------------------------------------------------------------------------

// The 2-character ANSI abbreviation Meta's `st` asks for, by the name a
// geolocation header writes it under (`cf-region` sends "California" where
// `x-appengine-region` sends "ca"). A state Meta cannot be given as its code is
// a state matched to nobody, so the lookup is the difference between sending the
// key and wasting it. Non-US states fall through to Meta's own second rule.
const US_STATE_CODES = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', 'district of columbia': 'dc',
  florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il',
  indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi',
  minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt',
  nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj',
  'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc',
  'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or',
  pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut',
  vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv',
  wisconsin: 'wi', wyoming: 'wy', 'puerto rico': 'pr',
};

/**
 * Meta's text rule: lowercase, no punctuation, UTF-8 left alone. `\p{P}\p{S}`
 * is punctuation AND symbols, so `O'Byrne` and `Ada-Marie` normalize the way
 * Meta's own parameter builder does rather than hashing their apostrophes.
 *
 * @param {string} [value]
 * @param {boolean} [spaces] - Keep internal spaces (names) or drop them (city,
 *   state — Meta's own city example is `newyork`).
 * @returns {string} The normalized value, or '' when there is nothing to send.
 */
function metaText(value, spaces = true) {
  const stripped = `${value ?? ''}`.toLowerCase().replace(/[\p{P}\p{S}]/gu, '');

  return (spaces ? stripped.trim().replace(/\s+/g, ' ') : stripped.replace(/\s+/gu, '')).trim();
}

/** Meta `ct`: the text rule with the spaces out too — its own example is `newyork`. */
function metaCity(value) {
  return metaText(value, false);
}

/** Meta `st`: the 2-character ANSI code in lowercase; other countries' own rule. */
function metaState(value) {
  return US_STATE_CODES[metaText(value)] || metaCity(value);
}

/**
 * Meta `zp`: lowercase, no spaces and no dash, and the first FIVE digits of a US
 * zip. An all-digit code longer than five is a zip+4 (`94035-1234`); the shorter
 * numeric codes other countries use are left whole.
 */
function metaZip(value) {
  const normalized = `${value ?? ''}`.toLowerCase().replace(/[\s-]/g, '');

  return /^\d{6,}$/.test(normalized) ? normalized.slice(0, 5) : normalized;
}

/**
 * Meta `country`: the ISO 3166-1 alpha-2 code, lowercase. A country NAME is not
 * a code — hashing `unitedstates` would send a key nobody matches on, which is
 * worse than the absent key an empty string compacts into.
 */
function metaCountry(value) {
  const normalized = `${value ?? ''}`.trim().toLowerCase();

  return /^[a-z]{2}$/.test(normalized) ? normalized : '';
}

/**
 * Meta `db`: YYYYMMDD. The account schema stores a birthday as the `$timestamp`
 * pair, and UTC is what it was stamped in.
 *
 * THE EPOCH IS NOT A BIRTHDAY. That pair's default is `1970-01-01` /
 * `timestampUNIX: 0`, so hashing it would hand every account with nothing on
 * file the digest of `19700101` — one junk match key shared by all of them, the
 * same trap `personal.telephone`'s `0` default is (#388).
 *
 * @param {object|string|number} [birthday] - `{ timestamp, timestampUNIX }`, an
 *   ISO string, or epoch millis.
 * @returns {string} The date, or '' when there is none (or it is unparseable).
 */
function metaDateOfBirth(birthday) {
  const raw = birthday?.timestamp ?? birthday;
  const date = new Date(raw ?? '');

  if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
    return '';
  }

  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Meta `ge`: the lowercase initial, and Meta accepts exactly two of them. */
function metaGender(value) {
  const initial = `${value ?? ''}`.trim().toLowerCase().charAt(0);

  return initial === 'f' || initial === 'm' ? initial : '';
}

// The table itself: Meta's key → where the value comes from on the account, and
// the rule its own spec states. `buildMetaMatch()` walks it, so adding a
// parameter is one row and no branching anywhere else.
const META_MATCH = {
  fn: { from: 'firstName', normalize: metaText },
  ln: { from: 'lastName', normalize: metaText },
  ct: { from: 'city', normalize: metaCity },
  st: { from: 'state', normalize: metaState },
  zp: { from: 'zip', normalize: metaZip },
  country: { from: 'country', normalize: metaCountry },
  db: { from: 'dateOfBirth', normalize: metaDateOfBirth },
  ge: { from: 'gender', normalize: metaGender },
};

/**
 * Meta's customer-information block for one person, already in Meta's own key
 * names because the normalization is Meta's own.
 *
 * @param {object} fields - The shared reader's output (`readUserMatchFields`).
 * @returns {object} Only the parameters that normalized to something.
 */
function buildMetaMatch(fields) {
  const block = {};

  for (const [key, { from, normalize }] of Object.entries(META_MATCH)) {
    const normalized = normalize(fields[from]);

    if (normalized) {
      block[key] = toSHA256(normalized);
    }
  }

  return block;
}

// ---------------------------------------------------------------------------
// GA4's user-data table
// https://developers.google.com/analytics/devguides/collection/ga4/uid-data
// Names and street are HASHED; city, region, postal code and country ride in
// the clear — and none of these rules is Meta's.
// ---------------------------------------------------------------------------

/**
 * GA4's text rule: digits and symbol characters removed, lowercase, trimmed.
 * @param {string} [value]
 * @param {boolean} [keepDigits] - The street's exception (its number is the point).
 * @returns {string} The normalized value, or '' when there is nothing to send.
 */
function ga4Text(value, keepDigits = false) {
  return `${value ?? ''}`
    .toLowerCase()
    .replace(keepDigits ? /[\p{P}\p{S}]/gu : /[\p{P}\p{S}\d]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** GA4 `address.sha256_first_name` / `sha256_last_name`. */
function hashGA4Name(name) {
  const normalized = ga4Text(name);

  return normalized ? toSHA256(normalized) : null;
}

/** GA4 `address.sha256_street` — the one text key whose digits stay (the number). */
function hashGA4Street(street) {
  const normalized = ga4Text(street, true);

  return normalized ? toSHA256(normalized) : null;
}

/** GA4 `address.city` / `address.region`: normalized, never hashed. */
function ga4Place(value) {
  return ga4Text(value);
}

/** GA4 `address.postal_code`: only `.` and `~` come out, and it is never hashed. */
function ga4PostalCode(value) {
  return `${value ?? ''}`.replace(/[.~]/g, '').trim();
}

/** GA4 `address.country`: ISO 3166-1 alpha-2, UPPERCASE (its own sample sends `US`). */
function ga4Country(value) {
  const normalized = `${value ?? ''}`.trim().toUpperCase();

  return /^[A-Z]{2}$/.test(normalized) ? normalized : '';
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

    // The page the credited touch happened on. A server conversion fires from a
    // webhook or an auth trigger and has no page of its own, so this is the only
    // URL it can honestly claim — and both ad platforms read one (TikTok's
    // `page: { url, referrer }`, Meta's `event_source_url`), so dropping it cost
    // match quality on both ([#497](https://github.com/Omega-JS-Stack/omega/issues/497)).
    // The adapters place it; a touch that carried none sends none.
    url: touch.url,
    referrer: touch.referrer,
  };

  return compact(context);
}

/**
 * The match values a user doc holds, by the name the tables above ask for them.
 *
 * The ONE reader (#577): every server-side caller hands `buildIdentity()` the
 * doc and nothing else decides which key an address lives under. A call site
 * that read `personal.location.region` itself is how `personal.telephone.number`
 * — a field no account has ever carried — went unnoticed for a year (#388).
 *
 * `zip` is the PLATFORM's parameter name, so it stays the bag key the tables
 * above normalize — the account schema calls the field
 * `personal.location.postalCode`, because a postal code is not a US zip
 * ([#663](https://github.com/Omega-JS-Stack/omega/issues/663)). It and
 * `personal.location.street` are the account page's optional address fields; an
 * account that left them empty sends no key, like any other absent value.
 *
 * @param {object} [user] - A `users/{uid}` doc.
 * @returns {object} The flat field bag the per-provider tables normalize.
 */
function readUserMatchFields(user) {
  const personal = user?.personal || {};

  return {
    email: user?.auth?.email,
    telephone: personal.telephone,
    firstName: personal.name?.first,
    lastName: personal.name?.last,
    city: personal.location?.city,
    state: personal.location?.region,
    zip: personal.location?.postalCode,
    country: personal.location?.country,
    street: personal.location?.street,
    dateOfBirth: personal.birthday,
    gender: personal.gender,
  };
}

/**
 * Who the conversion belongs to.
 *
 * @param {object} options
 * @param {string} options.uid - The owner's uid — the external_id every platform
 *   gets, raw for Meta and GA4, hashed for TikTok (`hashExternalId()`).
 * @param {object} [options.user] - The owner's user doc, read by the ONE reader
 *   above for every personal parameter the platforms accept.
 * @param {string} [options.email] - An email that beats the doc's (Firebase Auth's
 *   record on the signup path). Hashed here, never sent raw.
 * @param {object|string} [options.telephone] - `{ countryCode, national }`, or an
 *   E.164 string; beats the doc's the same way.
 * @param {object} [options.request] - The captured `{ ip, userAgent }` of the
 *   checkout intent, or of the post-auth request on a signup.
 * @returns {object} Only the keys that resolved to a value.
 */
function buildIdentity({ uid, user, email, telephone, request }) {
  const fields = readUserMatchFields(user);
  const meta = buildMetaMatch(fields);

  return compact({
    externalId: uid || null,
    // TikTok's Events API requires the digest where Meta only recommends it, so
    // the id ships in both shapes and each sender picks its own (#410).
    tiktokExternalIdHash: hashExternalId(uid),
    emailHash: hashEmail(email || fields.email),
    // One person, two digests — the normalization is the platform's, not ours.
    metaPhoneHash: hashPhone(telephone || fields.telephone),
    tiktokPhoneHash: hashPhoneE164(telephone || fields.telephone),
    ip: request?.ip || null,
    userAgent: request?.userAgent || null,
    // META's customer-information set, in Meta's own key names — the only
    // provider with parameters for any of it. Absent entirely when the account
    // filled none of them, so a fire with nothing to say keeps saying nothing.
    meta: Object.keys(meta).length ? meta : null,
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
  readUserMatchFields,
  constructFbc,
  hashEmail,
  hashExternalId,
  hashPhone,
  hashPhoneE164,
  // Meta's table, and the walk over it — exported so the parameter list is
  // readable (and testable) as the table it is
  META_MATCH,
  buildMetaMatch,
  // GA4's table: the Measurement Protocol helper builds its own `user_data`
  // block, from these rules and nobody else's
  hashGA4Name,
  hashGA4Street,
  ga4Place,
  ga4PostalCode,
  ga4Country,
  toSHA256,
};
