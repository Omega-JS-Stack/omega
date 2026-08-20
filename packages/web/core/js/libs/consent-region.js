/**
 * Which consent regime this visitor gets
 * ([#383](https://github.com/Omega-JS-Stack/omega/issues/383)).
 *
 * Two tiers, and the browser's own timezone picks between them — no network
 * call, no IP lookup, nothing to consent to before consent exists. GDPR/ePrivacy
 * regions get real OPT-IN (no provider script loads until the visitor accepts);
 * everywhere else gets opt-out (scripts load, the banner informs, Customize
 * still turns them off).
 *
 * The zone list is the EEA plus the UK, which is exactly `Europe/*` plus the
 * four Atlantic zones the EEA reaches outside it: Iceland (Reykjavik), Spain's
 * Canaries, and Portugal's Madeira and Azores.
 *
 * A timezone we cannot place is opt-in. That is the only safe direction: a
 * wrong "opt-out" loads a tracker on someone the law protects, while a wrong
 * "opt-in" just asks a question first.
 *
 * Pure — the timezone is an argument, so every branch is testable without a
 * browser (and so a dev override can force a region).
 */

// EEA/UK zones outside the `Europe/` prefix. Lowercased, because zone names are
// matched case-INSENSITIVELY: `Intl` accepts `europe/berlin`, so a
// case-sensitive prefix test would read a real European zone as unplaceable —
// and here that is the expensive direction to be wrong in.
const OPT_IN_ZONES = new Set([
  'atlantic/reykjavik', // Iceland (EEA)
  'atlantic/canary',    // Spain
  'atlantic/madeira',   // Portugal
  'atlantic/azores',    // Portugal
]);

const OPT_IN_PREFIX = 'europe/';

/**
 * The browser's IANA timezone, or '' when the environment has no answer.
 * @returns {string}
 */
export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {
    // Intl missing or throwing is the "we do not know" case, not a crash.
    return '';
  }
}

/**
 * Whether a timezone names a zone the runtime recognizes at all. A string that
 * is not a real IANA zone tells us nothing about where the visitor is, so it
 * reads as unknown rather than as "not Europe".
 * @param {string} timeZone - an IANA timezone name
 * @returns {boolean}
 */
function isKnownZone(timeZone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Does this visitor need to opt IN before any provider script loads?
 * @param {string} [timeZone] - IANA timezone; defaults to the browser's own
 * @returns {boolean} true for EEA/UK and for anything unplaceable
 */
export function requiresOptIn(timeZone = detectTimeZone()) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    return true;
  }

  const zone = timeZone.trim().toLowerCase();

  if (zone.startsWith(OPT_IN_PREFIX) || OPT_IN_ZONES.has(zone)) {
    return true;
  }

  return !isKnownZone(timeZone.trim());
}

/**
 * The region name the consent record stores.
 * @param {string} [timeZone] - IANA timezone; defaults to the browser's own
 * @returns {'opt-in'|'opt-out'}
 */
export function detectRegion(timeZone = detectTimeZone()) {
  return requiresOptIn(timeZone) ? 'opt-in' : 'opt-out';
}
