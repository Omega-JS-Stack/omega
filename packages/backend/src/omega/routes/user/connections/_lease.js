const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { REFRESH_TIMEOUT_MS } = require('./_grant.js');

// ============================================================================
// The refresh lease ([#783](https://github.com/Omega-JS-Stack/omega/issues/783))
//
// A backend never runs as one process: Cloud Functions scales to as many
// instances as the traffic asks for, and two of them refreshing the SAME user's
// SAME provider at once spend a one-time refresh token twice (Twitch rotates
// its own on every use). The loser's exchange is refused and the token it stores
// is dead. A per-process lock cannot see the other instance; Firestore can, so
// the lease is a NOTE ON THE RECORD, taken in a transaction.
//
// It lives beside the route helpers rather than inside post.js so `delete` can
// take the same lease later — revoking under a running refresh is the same race.
// ============================================================================

// A lease older than this is STALE and anybody may take it: an instance that
// crashed mid-refresh (or was evicted) never runs its own clear, and a record
// that stayed leased forever would refuse every later refresh.
const LEASE_TTL_SECONDS = 30;

// How the loser waits for the winner's write: re-read every POLL, give up after WAIT.
const LEASE_POLL_MS = 500;
const LEASE_WAIT_MS = 10000;

// The lease has to OUTLIVE the call it protects. The winner holds it across the
// provider's refresh POST, and that call has its own timeout: if the timeout were
// the longer of the two, a slow provider would let the lease expire under a
// running refresh, a second caller would win it, and both would spend the same
// one-time refresh token — exactly the race the lease exists to stop. So the
// relationship is asserted here, at load, against the one home of the timeout:
// a programmer changing either number learns at boot, not from a dead token in
// production.
if (LEASE_TTL_SECONDS * 1000 <= REFRESH_TIMEOUT_MS) {
  throw new Error(`Connections refresh lease: LEASE_TTL_SECONDS (${LEASE_TTL_SECONDS}s) must exceed the refresh step's REFRESH_TIMEOUT_MS (${REFRESH_TIMEOUT_MS}ms) — a lease that expires under a running refresh lets a second caller spend the same one-time refresh token`);
}

// ONE id per process, minted at module load: the lease says which instance holds
// it, so a stalled refresh is nameable in a log and in the 409 a loser answers.
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');

/**
 * The stored connection record, whatever the document is missing.
 *
 * @param {object} snapshot - A Firestore document snapshot
 * @param {string} provider - The provider key
 * @returns {object} The record, or {}
 */
function connectionRecord(snapshot, provider) {
  return (snapshot.data() || {}).connections?.[provider] || {};
}

/**
 * Take the refresh lease on `users/<uid>.connections.<provider>`, in a
 * transaction so two instances reading the same absent lease cannot both write
 * one.
 *
 * The caller that WINS runs the provider refresh and is the one that clears the
 * lease (in its own write, or through clearRefreshLease() when it fails). The
 * caller that LOSES touches the provider not at all — it waits for the winner's
 * token with awaitRefreshedToken().
 *
 * @param {object} options
 * @param {object} options.admin - The firebase-admin library (the route's own handle)
 * @param {string} options.uid - The user the connection belongs to
 * @param {string} options.provider - The provider key
 * @returns {Promise<{won: boolean, lease: object, updatedUNIX: number, token: object|undefined}>}
 *   Whether this caller holds the lease, the lease note (this caller's, or the
 *   holder's when it lost), the `updated.timestampUNIX` the record carried at
 *   entry — the value a loser watches for movement past — and the stored token
 *   AS THE TRANSACTION SAW IT, which is the one a winner refreshes with
 */
async function acquireRefreshLease({ admin, uid, provider }) {
  const firestore = admin.firestore();
  const docRef = firestore.doc(`users/${uid}`);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const record = connectionRecord(snapshot, provider);

    const nowMs = Date.now();
    const nowUNIX = Math.floor(nowMs / 1000);
    const updatedUNIX = record.updated?.timestampUNIX || 0;
    const held = record.refreshing;

    if (held && nowUNIX - (held.timestampUNIX || 0) < LEASE_TTL_SECONDS) {
      return { won: false, lease: held, updatedUNIX, token: record.token };
    }

    const lease = {
      instance: INSTANCE_ID,
      timestamp: new Date(nowMs).toISOString(),
      timestampUNIX: nowUNIX,
    };

    transaction.set(docRef, {
      connections: { [provider]: { refreshing: lease } },
    }, { merge: true });

    return { won: true, lease, updatedUNIX, token: record.token };
  });
}

/**
 * Drop the lease without touching anything else — the FAILURE path of a winner
 * (the success path removes it in the same write that stores the token, so the
 * record is never one write away from consistent).
 *
 * @param {object} options
 * @param {object} options.admin - The firebase-admin library
 * @param {string} options.uid - The user the connection belongs to
 * @param {string} options.provider - The provider key
 * @returns {Promise<void>}
 */
async function clearRefreshLease({ admin, uid, provider }) {
  await admin.firestore().doc(`users/${uid}`).set({
    connections: { [provider]: { refreshing: FieldValue.delete() } },
  }, { merge: true });
}

/**
 * Wait for the caller that WON the lease to finish. A loser runs no grant step at
 * all: the refresh token is one-time, and the winner is already spending it.
 *
 * The wait has THREE outcomes, and only one of them is a token:
 *
 *   - `refreshed` — `updated.timestampUNIX` moved past what it was at entry. The
 *     winner wrote, and the record now holds a token this caller can answer with.
 *   - `abandoned` — the note is gone but the stamp never moved: the winner's
 *     provider call failed (or its lease expired) and the stored token is the
 *     PRE-refresh one. Answering it as a success would hand a caller a token that
 *     may be expired, and a rotating provider may already have invalidated it, so
 *     this is a conflict to report — never a token to return.
 *   - `timeout` — neither happened inside the window.
 *
 * `pollMs`/`timeoutMs` are the contract above, as parameters so the offline case
 * can drive a timeout without waiting ten real seconds.
 *
 * @param {object} options
 * @param {object} options.admin - The firebase-admin library
 * @param {string} options.uid - The user the connection belongs to
 * @param {string} options.provider - The provider key
 * @param {number} options.since - The `updated.timestampUNIX` seen at entry
 * @param {number} [options.pollMs] - Milliseconds between reads
 * @param {number} [options.timeoutMs] - Milliseconds before giving up
 * @returns {Promise<{outcome: 'refreshed'|'abandoned'|'timeout', token: object|null}>}
 *   The outcome, and the stored token on `refreshed` alone
 */
async function awaitRefreshedToken({ admin, uid, provider, since, pollMs = LEASE_POLL_MS, timeoutMs = LEASE_WAIT_MS }) {
  const docRef = admin.firestore().doc(`users/${uid}`);
  const startTime = Date.now();

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));

    const record = connectionRecord(await docRef.get(), provider);

    // The winner writes the token, the stamp and the note's removal in ONE
    // write, so a moved stamp is checked first: it is the only success
    if ((record.updated?.timestampUNIX || 0) > since) {
      return { outcome: 'refreshed', token: record.token || null };
    }

    if (!record.refreshing) {
      return { outcome: 'abandoned', token: null };
    }

    if (Date.now() - startTime >= timeoutMs) {
      return { outcome: 'timeout', token: null };
    }
  }
}

module.exports = {
  INSTANCE_ID,
  LEASE_TTL_SECONDS,
  LEASE_POLL_MS,
  LEASE_WAIT_MS,
  acquireRefreshLease,
  clearRefreshLease,
  awaitRefreshedToken,
};
