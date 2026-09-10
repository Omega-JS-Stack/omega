// The failed-delete backstop for a reversed accidental signup
// ([#703](https://github.com/Omega-JS-Stack/omega/issues/703)).
//
// reverseAccidentalSignup (oauth.js) deletes the account Google auto-created
// during a signin attempt. When that .delete() FAILS (network/token), the
// account survives with no consent record — live, and nobody asked for it.
//
// Nothing about the account itself says so afterwards: Firestore rules always
// allow a user's self-read, so an orphan resolves as a normal empty account, and
// EVERY account is consent-less for the seconds between signup and the
// /user/signup post writing the consent record (the state the deleted consent
// guard collapsed into a lockout, #700). The only thing that knows an orphan is
// an orphan is the browser that failed to delete it — so that is what is
// recorded here, per uid, and read back at auth-ready on a later visit.

// Libraries
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('auth:orphan');

// Under `temporary.` like the signup-metadata marker in core/auth.js: transient
// state, not a preference. No TTL — the orphan it names lives until a delete
// lands, and a marker for a uid nobody signs into again is inert. Held through
// the client's storage module, which wraps every browser access itself, so
// private mode needs no guard here.
const ORPHAN_MARKER = 'temporary.orphanedAccount';

/**
 * Record that this account outlived its reversal.
 *
 * @param {string} uid - the auth uid whose delete failed
 */
export function markOrphanedAccount(uid) {
  if (!uid) {
    return;
  }

  omega.storage().set(`${ORPHAN_MARKER}.${uid}`, Date.now());
}

/**
 * Drop every orphan marker this browser holds.
 *
 * Called when a signup captures consent (libs/auth/forms.js), BEFORE the
 * Firebase call: somebody agreeing to the terms for the account they are about
 * to sign into is exactly the person the retry below must never delete, and at
 * that moment there is no uid yet to be precise about. A marker cleared for the
 * wrong account only costs a cleanup that Sentry already recorded.
 */
export function clearOrphanMarkers() {
  omega.storage().remove(ORPHAN_MARKER);
}

/**
 * Retry the reversal for a marked account, at auth-ready on a later visit.
 *
 * @param {object} state - the auth state (`user`, `account`) from omega.auth().listen
 * @returns {Promise<boolean>} true when the user was handled — deleted, or signed
 *   out because the delete failed again — and the caller is done with them
 */
export async function retryOrphanCleanup(state) {
  const uid = state.user?.uid;
  const key = uid ? `${ORPHAN_MARKER}.${uid}` : null;

  if (!key || !omega.storage().get(key, null)) {
    return false;
  }

  // The one hard invariant: an account with legal consent on record is somebody's
  // real account, whatever this browser remembers — they signed up for real since
  // (on another device, say). Drop the stale marker and never touch them again.
  if (state.account?.consent?.legal?.status === 'granted') {
    logger.log('Dropping the orphan marker — the account has legal consent on record');
    omega.storage().remove(key);

    return false;
  }

  // The listener's user is the client's own projection, which carries no
  // delete(): only the SDK's currentUser can delete itself, and only while it
  // still IS the marked account.
  const { getAuth, signOut } = await import('@firebase/auth');
  const auth = getAuth();

  if (auth.currentUser?.uid !== uid) {
    return false;
  }

  try {
    await auth.currentUser.delete();
    omega.storage().remove(key);
    logger.warn('Deleted an orphaned account on return — the reversal at signin never landed');
  } catch (e) {
    // Failed twice. Fall back to what the deleted consent guard did: the orphan
    // does not stay signed in. The marker HOLDS, so the next visit tries again.
    logger.error('Failed to delete the orphaned account again — signing out:', e);
    omega.sentry().captureException(new Error('Failed to delete an orphaned account on return', { cause: e }));
    await signOut(auth);
  }

  // Both paths leave the person signed out mid-page with no explanation
  // otherwise — the same message the old guard showed, for the same reason.
  omega.utilities().showNotification(
    `This account hasn't completed setup. Please sign up first.`,
    { type: 'danger', timeout: 8000 }
  );

  return true;
}
