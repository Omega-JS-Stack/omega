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
 * The opt-in tier is a STRICT ROSTER, not a continent. A country joins only
 * when its law GENUINELY requires opt-in consent for tracking cookies and we
 * have verified that; when in doubt, it stays out and gets opt-out. The roster
 * is `Europe/*` — the EEA, the UK, and Turkey (Europe/Istanbul, KVKK), which
 * rides the prefix for free — plus the named zones below.
 *
 * Some countries cannot be expressed at all: Quebec's Law 25 is real, but
 * America/Montreal is an ALIAS of America/Toronto, so opting Quebec in would
 * opt Ontario in too. No zone of its own, no entry.
 *
 * A timezone we cannot place is opt-in. That is the only safe direction: a
 * wrong "opt-out" loads a tracker on someone the law protects, while a wrong
 * "opt-in" just asks a question first.
 *
 * Pure — the timezone is an argument, so every branch is testable without a
 * browser (and so a dev override can force a region).
 */

// The roster's zones outside the `Europe/` prefix, grouped by the country (and
// the law) that puts them here. Lowercased, because zone names are matched
// case-INSENSITIVELY: `Intl` accepts `europe/berlin`, so a case-sensitive
// prefix test would read a real European zone as unplaceable — and here that is
// the expensive direction to be wrong in.
const OPT_IN_ZONES = new Set([
  // EEA reach outside Europe/: Iceland, Spain's Canaries, Portugal's islands.
  'atlantic/reykjavik', // Iceland (EEA)
  'atlantic/canary',    // Spain
  'atlantic/madeira',   // Portugal
  'atlantic/azores',    // Portugal

  // Brazil — LGPD + ANPD cookie guidance: prior explicit consent for
  // non-essential cookies. All sixteen zones, because the law is national.
  'america/sao_paulo',
  'america/bahia',
  'america/fortaleza',
  'america/recife',
  'america/araguaina',
  'america/maceio',
  'america/belem',
  'america/santarem',
  'america/campo_grande',
  'america/cuiaba',
  'america/boa_vista',
  'america/porto_velho',
  'america/manaus',
  'america/eirunepe',
  'america/rio_branco',
  'america/noronha',

  // China — PIPL: opt-in consent is the default legal basis for tracking,
  // analytics and ads cookies.
  'asia/shanghai',
  'asia/urumqi',

  // South Korea — PIPA: prior specific consent for behavioral/identifiable
  // cookies; letting someone opt out after the cookie is set is not enough.
  'asia/seoul',
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
 * @returns {boolean} true for the strict roster and for anything unplaceable
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
