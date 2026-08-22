// Has the purchase the redirect claims actually LANDED? (#232)
//
// Entitlement is granted by the payment webhook, which arrives AFTER the
// provider has redirected the browser here — usually a second or two later,
// sometimes never (a declined charge, an undelivered webhook in local dev). The
// redirect's URL params are the provider's claim, not proof, so the page asks
// the account itself before it congratulates anyone.
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';
import { FREQUENCIES } from '../../checkout/modules/state.js';

const logger = createLogger('confirmation');

// How often to ask, and how long before pointing the customer at support.
export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 30000;

/**
 * Is this a purchase whose landing the account doc can actually prove?
 *
 * Only the billing cadences checkout sells (`FREQUENCIES`) write account
 * state to wait for. A one-time purchase arrives as `frequency=once` and
 * writes nothing to the account doc — the receipt is the whole answer there.
 */
export function isVerifiable(state) {
  return FREQUENCIES.includes(state?.frequency);
}

/**
 * The moment the page OPENS in.
 *
 * A purchase with a poll behind it opens UNSURE — nothing about the order may
 * render until the account answers, or the receipt sits on screen beside a
 * spinner and reads as broken (Ian's QA). One with no poll — a one-time buy the
 * account doc never records — is already answered, so it renders at once.
 *
 * @param {object} state - the confirmation page state (frequency)
 * @returns {'processing'|'confirmed'}
 */
export function initialStatus(state) {
  return isVerifiable(state) ? 'processing' : 'confirmed';
}

/**
 * Does this account carry the purchase that was just made?
 *
 * The account doc is the only purchase state a browser may read — `payments-orders`
 * is admin-only by security rule — and it is exactly what the subscription
 * webhook writes. The plan has to MATCH: a user who already held one plan while
 * buying another must not be confirmed by the plan they walked in with.
 *
 * @param {object|null} account - the user doc, or null when there is none
 * @param {string} productId - the plan the redirect says was bought
 */
export function purchaseLanded(account, productId) {
  // No account doc is no ANSWER, never a yes — and it must not be asked about
  // either: the client's `resolveSubscription(account)` falls back to the STORED
  // auth state when it is handed nothing, so a null read would be answered out
  // of localStorage with the plan the shopper walked in with.
  if (!account) {
    return false;
  }

  const resolved = omega.auth().resolveSubscription(account);

  if (!resolved.active) {
    return false;
  }

  return !productId || resolved.plan === productId;
}

// Read the buyer's own account doc.
async function readAccount() {
  const user = omega.auth().getUser();

  if (!user) {
    return null;
  }

  const snapshot = await omega.firestore().doc(`users/${user.uid}`).get();

  return snapshot.exists() ? snapshot.data() : null;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask until the purchase is real, or the budget runs out.
 *
 * Every I/O seam is injected so the loop itself is unit-testable at full speed.
 *
 * @param {object} state - the confirmation page state (productId, frequency)
 * @param {object} [seams] - read/sleep/now/interval/timeout overrides
 * @returns {Promise<'confirmed'|'timeout'>}
 */
export async function verifyPurchase(state, {
  read = readAccount,
  sleep = wait,
  now = () => Date.now(),
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = POLL_TIMEOUT_MS,
} = {}) {
  if (!isVerifiable(state)) {
    return 'confirmed';
  }

  const deadline = now() + timeoutMs;

  while (true) {
    let account = null;

    try {
      account = await read();
    } catch (e) {
      // A read that FAILED is no answer, not a NO — the webhook may still be in
      // flight behind a network blip. Keep asking; the budget decides.
      logger.warn(`Could not read the account while confirming the purchase: ${e.message}`);
    }

    if (purchaseLanded(account, state.productId)) {
      return 'confirmed';
    }

    if (now() >= deadline) {
      return 'timeout';
    }

    await sleep(intervalMs);
  }
}
