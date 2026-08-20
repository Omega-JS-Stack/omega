/**
 * identity — the match keys a signed-in visitor is recognized BY, normalized the
 * way each platform's own spec demands
 * ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)).
 *
 * Every ad platform matches on a SHA-256 of a NORMALIZED value, and normalized
 * is not one rule. Meta's advanced matching wants a phone as bare digits —
 * country code included, no `+`, no punctuation — while TikTok's pixel wants the
 * E.164 form WITH the `+`. Same person, two digests, so the normalizer is per
 * provider and only the hash is shared. Email is the one value everybody
 * normalizes alike: trimmed and lowercased.
 *
 * RAW PII NEVER LEAVES: a caller hashes here and hands the pixel the digest.
 * `external_id` is the deliberate exception and it is not PII — the raw uid is
 * exactly what the SERVER sends as `identity.externalId` (@omega.js/backend's
 * `libraries/analytics/match-data.js`), and the browser half and the server half
 * of one person only link because both carry that same string.
 *
 * Pure and runtime-neutral like the rest of the package's pieces: no DOM, no
 * transport, no state. CJS, so the backend can require() it and the browser
 * bundles import it with standard interop.
 */

// The node digest's specifier, held in a VARIABLE on purpose: the web bundle is
// built for the browser, where a builtin has no home, and esbuild fails the
// whole build on a literally-named builtin it cannot resolve. Read through a
// variable it is left alone — and the branch below only ever runs off-page.
const NODE_CRYPTO = 'crypto';

/**
 * Is this runtime node? The node digest is chosen by the RUNTIME and never by
 * `typeof require`: a bundler rewrites that name to a shim of its own, which IS
 * a function and throws the moment it is called with a builtin — a rejection
 * thrown at a visitor, exactly where this module promises a quiet null.
 * @returns {boolean}
 */
function isNode() {
  return typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
}

/**
 * SHA-256 hex — the digest every platform's match spec asks for.
 *
 * A page's only hash is `crypto.subtle`, which is asynchronous and absent on a
 * non-secure origin; node's `crypto` covers the runtimes that have no secure
 * context (the test runner, a Cloud Function, a plain-http page).
 *
 * @param {string} [value] - The ALREADY-normalized value.
 * @returns {Promise<string|null>} Lowercase hex, or null when there is nothing
 *   to hash and when no digest exists to hash it with.
 */
async function sha256(value) {
  if (!value) {
    return null;
  }

  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // A page with no secure context and no node under it has no digest at all,
  // which means no identity — and silence, never a raise at a visitor (#306).
  if (!isNode()) {
    return null;
  }

  try {
    return require(NODE_CRYPTO).createHash('sha256').update(value).digest('hex');
  } catch (e) {
    // A bundler that shims `require` throws here rather than resolving a
    // builtin. Same answer as every other missing digest: no match key, no
    // noise — the promise above holds in every shape this module is built into.
    return null;
  }
}

/**
 * Email, normalized the one way every platform agrees on: trimmed, lowercased.
 * @param {string} [email]
 * @returns {string} The normalized address, or '' when there is none.
 */
function normalizeEmail(email) {
  return `${email || ''}`.trim().toLowerCase();
}

/**
 * Phone for META: digits only, country code included, no `+` and no punctuation
 * (Meta's advanced-matching spec hashes the bare number).
 * @param {string} [phone] - Any written form; Auth's `phoneNumber` is E.164.
 * @returns {string} The digits, or '' when there is no number.
 */
function metaPhone(phone) {
  return `${phone || ''}`.replace(/\D/g, '');
}

/**
 * Phone for TIKTOK: the same digits in E.164, with the leading `+` its pixel
 * spec requires. Nothing to normalize stays empty rather than becoming a lone
 * `+`, which would hash to a match key shared by every phoneless account.
 * @param {string} [phone] - Any written form; Auth's `phoneNumber` is E.164.
 * @returns {string} The E.164 number, or '' when there is no number.
 */
function tiktokPhone(phone) {
  const digits = metaPhone(phone);

  return digits ? `+${digits}` : '';
}

module.exports = {
  sha256,
  normalizeEmail,
  metaPhone,
  tiktokPhone,
};
