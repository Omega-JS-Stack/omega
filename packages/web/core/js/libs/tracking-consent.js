/**
 * The TRACKING consent record — one home for "what may this page load, and
 * count?" ([#383](https://github.com/Omega-JS-Stack/omega/issues/383)).
 *
 * Shape, under `trackingConsent` in `omega.storage()`:
 *
 *   { analytics: bool, marketing: bool, region: 'opt-in'|'opt-out',
 *     timestamp: ISO string, version: 1 }
 *
 * The key is `trackingConsent`, not `consent`, and every export says TRACKING
 * out loud, because storage already has a `consent`: the signup form's LEGAL
 * consent (`libs/auth/forms.js` captureSignupConsent → `{ legal, marketing }`,
 * which the backend signup route interprets). Two different questions with two
 * different shapes — sharing one key would have read a tracking answer as a
 * revoked terms agreement.
 *
 * Two categories, because that is what a visitor can meaningfully answer:
 * `analytics` (GA4) and `marketing` (Meta, TikTok). Necessary is not a category
 * here — nothing about it is optional, so there is nothing to store.
 *
 * A stored record of the CURRENT version wins on every load. Anything else — no
 * record, or a record written under an older version — is no decision at all,
 * and the region default applies until the visitor makes one:
 *   - opt-out region: both categories granted, banner shown anyway (informational)
 *   - opt-in region: nothing granted; the gates stay closed until Accept/Save
 *
 * Bumping TRACKING_CONSENT_VERSION re-prompts everyone, which is what a change
 * to what the categories COVER requires. Renaming a provider inside a category
 * does not.
 *
 * The read API is deliberately tiny because it has callers beyond the banner:
 * the loader gates on it, and the checkout/signup payloads read it.
 */
import omega from '@omega.js/client';

import { createLogger } from '__main_assets__/js/libs/logger.js';
import { detectRegion } from '__main_assets__/js/libs/consent-region.js';

const logger = createLogger('tracking-consent');

// Storage path inside the client's `_manager` blob. NOT `consent` — that key is
// the signup form's legal consent (see the header).
export const TRACKING_CONSENT_KEY = 'trackingConsent';

// Bump to re-prompt every visitor (see the header).
export const TRACKING_CONSENT_VERSION = 1;

// The optional categories, in banner order.
export const TRACKING_CONSENT_CATEGORIES = ['analytics', 'marketing'];

const listeners = new Set();

/**
 * The stored record, or null when there is no decision this version can honor.
 * @returns {object|null}
 */
function readStored() {
  const stored = omega.storage().get(TRACKING_CONSENT_KEY);

  if (!stored || typeof stored !== 'object' || stored.version !== TRACKING_CONSENT_VERSION) {
    return null;
  }

  return {
    analytics: stored.analytics === true,
    marketing: stored.marketing === true,
    region: stored.region === 'opt-in' ? 'opt-in' : 'opt-out',
    timestamp: stored.timestamp || null,
    version: TRACKING_CONSENT_VERSION,
  };
}

/**
 * Has the visitor actually answered (under the current version)?
 * @returns {boolean}
 */
export function hasTrackingDecision() {
  return readStored() !== null;
}

/**
 * The consent in effect right now: the stored decision, or the region default.
 * @returns {{ analytics: boolean, marketing: boolean, region: string, timestamp: (string|null), version: number }}
 */
export function getTrackingConsent() {
  const stored = readStored();

  if (stored) {
    return stored;
  }

  const region = detectRegion();
  const granted = region === 'opt-out';

  return {
    analytics: granted,
    marketing: granted,
    region: region,
    timestamp: null,
    version: TRACKING_CONSENT_VERSION,
  };
}

/**
 * Record the visitor's answer and tell everyone who is listening.
 * @param {object} choices
 * @param {boolean} choices.analytics
 * @param {boolean} choices.marketing
 * @returns {object} the stored record
 */
export function setTrackingConsent(choices) {
  const record = {
    analytics: choices.analytics === true,
    marketing: choices.marketing === true,
    region: detectRegion(),
    timestamp: new Date().toISOString(),
    version: TRACKING_CONSENT_VERSION,
  };

  omega.storage().set(TRACKING_CONSENT_KEY, record);
  notify(record);

  return record;
}

/**
 * Forget the decision — the visitor reopened the banner to answer again. The
 * region default applies until they do.
 * @returns {object} the consent now in effect
 */
export function clearTrackingDecision() {
  omega.storage().remove(TRACKING_CONSENT_KEY);

  const record = getTrackingConsent();
  notify(record);

  return record;
}

/**
 * Subscribe to consent changes. Called with the record now in effect.
 * @param {Function} listener
 * @returns {Function} unsubscribe
 */
export function onTrackingConsentChange(listener) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function notify(record) {
  listeners.forEach((listener) => {
    // One broken listener never costs the others their update — and never
    // costs the visitor the choice they just made.
    try {
      listener(record);
    } catch (e) {
      logger.error('A consent listener threw:', e);
    }
  });
}
