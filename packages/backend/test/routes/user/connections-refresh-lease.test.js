/**
 * Test: routes/user/connections — the refresh lease
 * ([#783](https://github.com/Omega-JS-Stack/omega/issues/783)).
 *
 * Run (from the framework repo): npm test routes/user/connections-refresh-lease
 *
 * A backend never runs as ONE process. Two instances refreshing the same user's
 * same provider at once spend a one-time refresh token twice (Twitch rotates its
 * own on every use): the loser's exchange is refused, and the token it writes
 * back is dead. Nothing serialized them — no in-flight map could, since the
 * other refresh is in another process. What does is a LEASE on the record,
 * taken in a Firestore transaction.
 *
 * What this pins:
 *
 *   1. the transaction decides: an absent lease and a lease older than 30
 *      seconds are both WON; a fresh one is LOST, with nothing written;
 *   2. a winner runs the provider once, stores the token and removes the lease
 *      in the same write — and a FAILING winner removes it too, so a crash never
 *      wedges the record past the expiry;
 *   3. a loser never touches the provider: it waits for the stored token and
 *      answers it, or answers 409 naming the stalled refresh and writes nothing;
 *   4. both paths answer `{ success: true, token }`.
 *
 * Everything is offline. The offline lane has no Firestore, so the seam is the
 * `admin` handle the route already takes: an in-memory store that applies a
 * `set(..., { merge: true })` the way Firestore does (deep merge, and
 * `FieldValue.delete()` removes the key) and answers a transaction from the same
 * documents. No emulator, no network, no provider.
 */

const path = require('path');
const jetpack = require('fs-jetpack');
const { FieldValue } = require('firebase-admin/firestore');

const postRoute = require('../../../dist/manager/routes/user/connections/post.js');
const {
  acquireRefreshLease,
  clearRefreshLease,
  awaitRefreshedToken,
  INSTANCE_ID,
  LEASE_TTL_SECONDS,
} = require('../../../dist/manager/routes/user/connections/_lease.js');
const { REFRESH_TIMEOUT_MS } = require('../../../dist/manager/routes/user/connections/_grant.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const PROVIDER_ID = 'lease-fixture-783';
const PROVIDER_ENV_KEY = 'LEASE_FIXTURE_783';
const USER_UID = 'user-783';

// The one sentinel a merge removes a field with — `FieldValue.delete()` is a
// singleton, so the store below compares it by identity.
const DELETE = FieldValue.delete();

// The credentials the lane resolves for the fixture provider. Restored in
// cleanup() — a run that leaves them behind changes what the next file reads.
const originalEnv = {
  [`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_ID`]: process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_ID`],
  [`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_SECRET`]: process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_SECRET`],
};

process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_ID`] = 'client-id-783';
process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_SECRET`] = 'client-secret-783';

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// The provider module is loaded from a FILE by the lane's own resolver, so what
// its refresh was called with lives where both the file and the case can see it:
// the one thing "spent twice" means is `calls` reaching 2, and the one thing
// "spent the SUPERSEDED token" means is `tokens` naming the pre-lease one.
const CALL_STATE = '__omegaLeaseRefresh783';

/** A provider whose refresh takes `delayMs`, records its calls, and never leaves the process. */
function providerSource({ delayMs = 0, fail = false } = {}) {
  return [
    'module.exports = {',
    `  provider: '${PROVIDER_ID}',`,
    "  name: 'Lease Fixture',",
    "  urls: { authorize: 'https://provider.test/a', token: 'https://provider.test/t' },",
    '  async refresh(context) {',
    `    const state = global['${CALL_STATE}'] = global['${CALL_STATE}'] || { calls: 0, tokens: [] };`,
    '    state.calls += 1;',
    '    state.tokens.push(context.token && context.token.refresh_token);',
    `    await new Promise((resolve) => setTimeout(resolve, ${delayMs}));`,
    ...(fail ? ["    throw new Error('the provider said no');"] : []),
    "    return { access_token: 'refreshed-783', refresh_token: 'rotated-783', token_type: 'Bearer', expires_in: 3600, scope: 'identify' };",
    '  },',
    "  async identity() { return { id: 'fixture-user' }; },",
    '};',
  ].join('\n');
}

function refreshCalls() {
  return (global[CALL_STATE] || {}).calls || 0;
}

function refreshTokensSpent() {
  return (global[CALL_STATE] || {}).tokens || [];
}

function resetRefreshCalls() {
  global[CALL_STATE] = { calls: 0, tokens: [] };
}

/** The stored connection record a refresh acts on, plus whatever a case adds to it. */
function storedRecord(extra) {
  return {
    id: USER_UID,
    connections: {
      [PROVIDER_ID]: {
        type: 'oauth2',
        token: { access_token: 'access-old', refresh_token: 'refresh-783' },
        ...extra,
      },
    },
  };
}

/** A lease note as another instance would have left it, `ageSeconds` ago. */
function heldLease(ageSeconds, instance) {
  const timestampUNIX = Math.floor(Date.now() / 1000) - ageSeconds;

  return {
    instance: instance || 'other-instance-783',
    timestamp: new Date(timestampUNIX * 1000).toISOString(),
    timestampUNIX,
  };
}

/** Firestore's merge, as much of it as a connection record needs. */
function mergeInto(target, payload) {
  for (const [key, value] of Object.entries(payload)) {
    if (value === DELETE) {
      delete target[key];
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Copied, never merged in place: a stored document is not the object the
      // case handed in, and a lease note taken over must not rewrite the
      // fixture's own copy of the note it replaced
      const existing = target[key] && typeof target[key] === 'object' && !Array.isArray(target[key]) ? { ...target[key] } : {};

      target[key] = mergeInto(existing, value);
      continue;
    }

    target[key] = value;
  }

  return target;
}

/**
 * The Firestore stand-in: documents in memory, writes APPLIED (so the next read
 * sees the lease the transaction just took), and a `runTransaction` reading and
 * writing the same store. `onRead` is the hook a case moves the record under a
 * waiting loser with.
 */
function leaseFirestore(docs, onRead) {
  const writes = [];
  const reads = [];

  const snapshot = (docPath) => ({ exists: !!docs[docPath], data: () => docs[docPath] });

  const read = async (docPath) => {
    reads.push(docPath);

    if (onRead) {
      await onRead(reads.length, docs);
    }

    return snapshot(docPath);
  };

  const write = (verb, docPath, payload) => {
    writes.push({ verb, path: docPath, payload });
    docs[docPath] = mergeInto(docs[docPath] || {}, payload);
  };

  const firestore = {
    doc: (docPath) => ({
      path: docPath,
      get: () => read(docPath),
      set: async (payload) => write('set', docPath, payload),
      update: async (payload) => write('update', docPath, payload),
    }),
    runTransaction: (fn) => fn({
      get: (ref) => read(ref.path),
      set: (ref, payload) => write('transaction.set', ref.path, payload),
    }),
  };

  return { admin: { firestore: () => firestore }, docs, writes, reads };
}

/** The lane, wired: a brand provider dir, the store above, and a ctx. */
function lane({ docs, provider, onRead } = {}) {
  const cwd = jetpack.tmpDir({ prefix: 'omega-connections-783' }).path();

  jetpack.write(path.join(cwd, 'connections', `${PROVIDER_ID}.js`), provider || providerSource());

  const store = leaseFirestore(docs || {}, onRead);

  const Manager = {
    cwd,
    libraries: { admin: store.admin },
    project: { websiteUrl: 'https://brand.test' },
    config: {},
    Metadata: () => ({ set: () => ({}) }),
  };

  const responses = [];

  const ctx = {
    Manager,
    log() {},
    respond: (message, options) => {
      responses.push({ message, options: options || {} });
      return { message, options: options || {} };
    },
    meta: { startTime: { timestamp: 'now', timestampUNIX: Math.floor(Date.now() / 1000) } },
  };

  return { ...store, ctx, Manager, responses };
}

/** The caller's own record IS what the self path reads (it only goes to Firestore for another uid). */
function userWithConnection(extra) {
  return {
    authenticated: true,
    auth: { uid: USER_UID },
    roles: { admin: false },
    connections: storedRecord(extra).connections,
  };
}

/** The last thing the route answered. */
function answered(responses) {
  return responses[responses.length - 1] || {};
}

/** The connection record as it stands in the store. */
function recordIn(docs) {
  return docs[`users/${USER_UID}`]?.connections?.[PROVIDER_ID] || {};
}

module.exports = defineCases({
  description: 'Connections refresh: the cross-instance lease',
  type: 'group',

  cleanup() {
    restoreEnv();
    delete global[CALL_STATE];
  },

  tests: [
    {
      // The lease has to outlive the call it protects. The refresh POST used to
      // carry a 60s timeout under a 30s lease, so a slow provider let a second
      // caller reclaim the lease and spend the same one-time refresh token —
      // the exact race the lease exists to stop.
      name: 'the-lease-outlives-the-refresh-call-it-protects',

      async run({ assert }) {
        assert.equal(LEASE_TTL_SECONDS * 1000 > REFRESH_TIMEOUT_MS, true, `the ${LEASE_TTL_SECONDS}s lease must outlast the ${REFRESH_TIMEOUT_MS}ms refresh timeout`);
        assert.equal(REFRESH_TIMEOUT_MS, 20000, 'the refresh step is the shorter call (the exchange keeps its 60s — it holds no lease)');

        // The relationship is enforced at LOAD, not just here: the module refuses
        // to boot rather than run with a lease that can expire under a refresh
        const source = jetpack.read(path.join(__dirname, '../../../dist/manager/routes/user/connections/_lease.js'));

        assert.match(source, /LEASE_TTL_SECONDS \* 1000 <= REFRESH_TIMEOUT_MS/, 'the guard reads the one home of the timeout, so the two cannot drift');
        assert.match(source, /throw new Error/, 'and it throws — a programmer error, not a warning');
      },
    },

    {
      name: 'a-record-with-no-lease-is-won-and-the-note-is-written',

      async run({ assert }) {
        const { admin, docs, writes } = leaseFirestore({
          [`users/${USER_UID}`]: storedRecord({ updated: { timestamp: 'then', timestampUNIX: 1700000000 } }),
        });

        const lease = await acquireRefreshLease({ admin, uid: USER_UID, provider: PROVIDER_ID });

        assert.equal(lease.won, true, 'nobody holds the record, so this caller refreshes');
        assert.equal(lease.updatedUNIX, 1700000000, 'and it carries the updated stamp seen at entry, for a loser to watch');
        assert.equal(lease.token.refresh_token, 'refresh-783', 'plus the stored token AS THE TRANSACTION SAW IT — the one the winner spends');

        assert.equal(writes.length, 1, 'one write, and it is the transaction\'s');
        assert.equal(writes[0].verb, 'transaction.set', 'taken IN the transaction — two instances reading the same absent lease cannot both write one');
        assert.equal(writes[0].path, `users/${USER_UID}`, 'on the user document');

        const note = recordIn(docs).refreshing;

        assert.ok(note, 'the note is on the record');
        assert.equal(note.instance, INSTANCE_ID, 'naming this process');
        assert.equal(note.instance, lease.lease.instance, 'the same id the caller was handed');
        assert.equal(typeof note.timestampUNIX, 'number', 'with the seconds stamp the expiry is measured on');
        assert.equal(Math.floor(new Date(note.timestamp).getTime() / 1000), note.timestampUNIX, 'and the ISO twin every stamp in this codebase carries, of the same instant');
        assert.equal(recordIn(docs).token.access_token, 'access-old', 'and nothing else on the record moved');
      },
    },

    {
      name: 'a-lease-older-than-the-expiry-is-taken-over',

      async run({ assert }) {
        const stale = heldLease(LEASE_TTL_SECONDS + 5);

        const { admin, docs } = leaseFirestore({
          [`users/${USER_UID}`]: storedRecord({ refreshing: stale }),
        });

        const lease = await acquireRefreshLease({ admin, uid: USER_UID, provider: PROVIDER_ID });

        assert.equal(lease.won, true, `a lease older than ${LEASE_TTL_SECONDS}s is stale — the instance holding it died, and the record cannot stay locked forever`);
        assert.equal(recordIn(docs).refreshing.instance, INSTANCE_ID, 'and the note is now this process\'s');
        assert.notEqual(recordIn(docs).refreshing.timestampUNIX, stale.timestampUNIX, 'stamped now, so the next caller measures against THIS refresh');
      },
    },

    {
      name: 'a-fresh-lease-is-lost-and-nothing-is-written',

      async run({ assert }) {
        const held = heldLease(5);

        const { admin, docs, writes } = leaseFirestore({
          [`users/${USER_UID}`]: storedRecord({ refreshing: held, updated: { timestamp: 'then', timestampUNIX: 1700000000 } }),
        });

        const lease = await acquireRefreshLease({ admin, uid: USER_UID, provider: PROVIDER_ID });

        assert.equal(lease.won, false, 'another instance is spending the refresh token right now');
        assert.equal(lease.lease.instance, held.instance, 'and the loser is told which one');
        assert.equal(lease.updatedUNIX, 1700000000, 'plus the stamp to watch for movement past');
        assert.equal(writes.length, 0, 'a loser writes nothing — not even its own note');
        assert.equal(recordIn(docs).refreshing.instance, held.instance, "the holder's note is untouched");
      },
    },

    {
      name: 'clearing-the-lease-removes-the-note-and-nothing-else',

      async run({ assert }) {
        const { admin, docs } = leaseFirestore({
          [`users/${USER_UID}`]: storedRecord({ refreshing: heldLease(1, INSTANCE_ID) }),
        });

        await clearRefreshLease({ admin, uid: USER_UID, provider: PROVIDER_ID });

        assert.equal('refreshing' in recordIn(docs), false, 'the note is gone, so the next caller wins immediately');
        assert.equal(recordIn(docs).token.refresh_token, 'refresh-783', 'and the token it was taken over is still stored');
        assert.equal(recordIn(docs).type, 'oauth2', 'as is the kind of connection this is');
      },
    },

    {
      name: 'a-waiting-loser-gives-up-when-the-refresh-never-settles',

      async run({ assert }) {
        const { admin, reads } = leaseFirestore({
          [`users/${USER_UID}`]: storedRecord({ refreshing: heldLease(1), updated: { timestamp: 'then', timestampUNIX: 1700000000 } }),
        });

        // The window is the contract (500ms polls, 10s); the case drives a short
        // one so the give-up path costs the suite milliseconds, not ten seconds
        const waited = await awaitRefreshedToken({
          admin,
          uid: USER_UID,
          provider: PROVIDER_ID,
          since: 1700000000,
          pollMs: 10,
          timeoutMs: 50,
        });

        assert.equal(waited.outcome, 'timeout', 'the lease never cleared and the stamp never moved, so the wait gives up');
        assert.equal(waited.token, null, 'with no token to answer');
        assert.equal(reads.length > 1, true, `and it re-read the record rather than deciding once: ${reads.length} reads`);
      },
    },

    {
      name: 'the-winner-stores-the-token-clears-the-lease-and-answers-it',

      async run({ assert }) {
        resetRefreshCalls();

        const { ctx, docs, writes, responses } = lane({ docs: { [`users/${USER_UID}`]: storedRecord() } });

        await postRoute({
          ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        const response = answered(responses);

        assert.equal(response.options.code, undefined, `the refresh succeeded: ${JSON.stringify(response.message)}`);
        assert.equal(response.message.success, true, 'reporting success');
        assert.equal(response.message.token.access_token, 'refreshed-783', 'and the answer CARRIES the token, so a trusted service refreshes and reads in one call');
        assert.equal(response.message.token.refresh_token, 'rotated-783', 'the rotated refresh token included');
        assert.equal(refreshCalls(), 1, 'the provider ran once');

        const record = recordIn(docs);

        assert.equal(record.token.access_token, 'refreshed-783', 'the stored token is the new one');
        assert.equal(record.updated.timestampUNIX, ctx.meta.startTime.timestampUNIX, 'stamped with the request');
        assert.equal('refreshing' in record, false, 'and the lease is gone');

        const storeWrite = writes.find((entry) => entry.verb === 'set');

        assert.ok(storeWrite, 'the token landed in a plain merge write');
        assert.equal(storeWrite.payload.connections[PROVIDER_ID].refreshing, DELETE, 'which removes the lease in the SAME write — the record is never one write away from consistent');
        assert.equal(writes.filter((entry) => entry.verb === 'set').length, 1, 'and there is no second write to clear it');
      },
    },

    {
      // The pre-lease read can be one rotation old: it happens before the
      // transaction, and another instance may have finished a refresh in
      // between. Spending a SUPERSEDED refresh token is the bug this issue is
      // about, so the winner uses what the transaction saw.
      name: 'the-winner-spends-the-token-the-transaction-saw',

      async run({ assert }) {
        resetRefreshCalls();

        // Firestore holds a rotated token; the caller's own (pre-lease) record
        // still carries the superseded one
        const rotated = storedRecord();

        rotated.connections[PROVIDER_ID].token = { access_token: 'access-newer', refresh_token: 'rotated-elsewhere-783' };

        const { ctx, docs, responses } = lane({ docs: { [`users/${USER_UID}`]: rotated } });

        await postRoute({
          ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        assert.equal(answered(responses).options.code, undefined, 'the refresh succeeded');
        assert.deepEqual(refreshTokensSpent(), ['rotated-elsewhere-783'], "the provider was handed the record's CURRENT refresh token, never the pre-lease one");
        assert.equal(recordIn(docs).token.access_token, 'refreshed-783', 'and the new token landed');
      },
    },

    {
      // The record was disconnected between the pre-lease read and the
      // transaction. There is nothing to spend, and the pre-lease token is not a
      // fallback: refreshing a connection the user just removed is worse than a
      // 400.
      name: 'a-record-that-vanished-under-the-lease-is-the-same-400',

      async run({ assert }) {
        resetRefreshCalls();

        const { ctx, docs, responses } = lane({ docs: {} });

        await postRoute({
          ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        const response = answered(responses);

        assert.equal(response.options.code, 400, `the same 400 the pre-lease check answers: ${response.message}`);
        assert.equal(response.message, 'No refresh token found', 'with the same message');
        assert.equal(refreshCalls(), 0, 'the provider was never called');
        assert.equal('refreshing' in recordIn(docs), false, 'and the lease it took on the way in is gone');
      },
    },

    {
      name: 'a-winner-whose-provider-fails-still-clears-the-lease',

      async run({ assert }) {
        resetRefreshCalls();

        const { ctx, docs, writes, responses } = lane({
          docs: { [`users/${USER_UID}`]: storedRecord() },
          provider: providerSource({ fail: true }),
        });

        await postRoute({
          ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        const response = answered(responses);

        assert.equal(response.options.code, 500, `the provider failure is still reported: ${response.message}`);
        assert.match(response.message, /Token refresh failed/, 'with its own message');

        const record = recordIn(docs);

        assert.equal(writes.some((entry) => entry.verb === 'transaction.set'), true, 'the lease WAS taken — this caller ran the provider');
        assert.equal('refreshing' in record, false, 'and it is gone, so a crash never wedges the record for the whole expiry');
        assert.equal(writes.some((entry) => entry.verb === 'set'), true, 'the clear is its own write on the failure path (the success path folds it into the token write)');
        assert.equal(record.token.access_token, 'access-old', 'the stored token is untouched — there was no new one');
      },
    },

    {
      name: 'a-loser-answers-the-stored-token-once-the-record-moves',

      async run({ assert }) {
        resetRefreshCalls();

        const held = heldLease(1);
        const since = Math.floor(Date.now() / 1000) - 60;

        // The winner is another INSTANCE: it holds the lease, and its write
        // lands under this caller while it waits (read 2 moves the stamp, and
        // the note stays — a loser settles on either).
        const { ctx, writes, responses } = lane({
          docs: {
            [`users/${USER_UID}`]: storedRecord({ refreshing: held, updated: { timestamp: 'then', timestampUNIX: since } }),
          },
          onRead: (count, docs) => {
            if (count === 2) {
              docs[`users/${USER_UID}`].connections[PROVIDER_ID].token = { access_token: 'refreshed-elsewhere-783', refresh_token: 'rotated-783' };
              docs[`users/${USER_UID}`].connections[PROVIDER_ID].updated = { timestamp: 'now', timestampUNIX: since + 30 };
            }
          },
        });

        await postRoute({
          ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        const response = answered(responses);

        assert.equal(response.options.code, undefined, `the loser answers success, not an error: ${JSON.stringify(response.message)}`);
        assert.equal(response.message.token.access_token, 'refreshed-elsewhere-783', "and the token is the WINNER's, read back from the record");
        assert.equal(refreshCalls(), 0, 'the loser never touched the provider — the refresh token is one-time and the winner is spending it');
        assert.equal(writes.length, 0, 'and it wrote nothing at all');
      },
    },

    {
      // The winner's own provider call failed, so it cleared the note without
      // writing a token. The record still holds the PRE-refresh token — which the
      // provider may already have invalidated — so answering it as a success
      // would hand back a dead credential.
      name: 'a-loser-answers-409-when-the-winners-refresh-never-completed',

      async run({ assert }) {
        resetRefreshCalls();

        const since = Math.floor(Date.now() / 1000) - 60;

        const { ctx, writes, responses } = lane({
          docs: {
            [`users/${USER_UID}`]: storedRecord({ refreshing: heldLease(1), updated: { timestamp: 'then', timestampUNIX: since } }),
          },
          onRead: (count, docs) => {
            // The winner's failure path: the note goes, the stamp does not move
            if (count === 2) {
              delete docs[`users/${USER_UID}`].connections[PROVIDER_ID].refreshing;
            }
          },
        });

        await postRoute({
          ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        const response = answered(responses);

        assert.equal(response.options.code, 409, `an abandoned refresh is a conflict, not a token: ${response.message}`);
        assert.equal(response.message, `The refresh of ${PROVIDER_ID} started by another instance did not complete. Try again.`, 'and the message says the refresh never completed, not that it stalled');
        assert.equal(refreshCalls(), 0, 'this caller still never touched the provider');
        assert.equal(writes.length, 0, 'and wrote nothing — a retry wins the lease outright');
      },
    },

    {
      name: 'a-winner-and-a-loser-at-once-spend-the-refresh-token-once',

      async run({ assert }) {
        resetRefreshCalls();

        const docs = { [`users/${USER_UID}`]: storedRecord() };
        const cwd = jetpack.tmpDir({ prefix: 'omega-connections-783-pair' }).path();

        jetpack.write(path.join(cwd, 'connections', `${PROVIDER_ID}.js`), providerSource({ delayMs: 300 }));

        // ONE store, two callers — the shape two Cloud Functions instances have
        const store = leaseFirestore(docs);

        const callers = [0, 1].map(() => {
          const responses = [];

          return {
            responses,
            ctx: {
              Manager: {
                cwd,
                libraries: { admin: store.admin },
                project: { websiteUrl: 'https://brand.test' },
                config: {},
                Metadata: () => ({ set: () => ({}) }),
              },
              log() {},
              respond: (message, options) => {
                responses.push({ message, options: options || {} });
                return { message, options: options || {} };
              },
              meta: { startTime: { timestamp: 'now', timestampUNIX: Math.floor(Date.now() / 1000) } },
            },
          };
        });

        const call = (caller) => postRoute({
          ctx: caller.ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        const first = call(callers[0]);

        // The second caller arrives while the first is at the provider
        await new Promise((resolve) => setTimeout(resolve, 50));

        const second = call(callers[1]);

        await Promise.all([first, second]);

        assert.equal(refreshCalls(), 1, 'the provider was called ONCE across the pair — the whole point: a rotating refresh token spent twice leaves a dead token stored');

        const answers = callers.map((caller) => answered(caller.responses));

        for (const answer of answers) {
          assert.equal(answer.options.code, undefined, `both callers get a token, not an error: ${JSON.stringify(answer.message)}`);
          assert.equal(answer.message.success, true, 'both report success');
          assert.equal(answer.message.token.access_token, 'refreshed-783', 'and both answer the same stored token');
        }

        assert.equal('refreshing' in recordIn(docs), false, 'the lease is gone when the pair is done');
        assert.equal(store.writes.filter((entry) => entry.verb === 'transaction.set').length, 1, 'only one caller ever wrote a lease note');
      },
    },

    {
      // The one case that costs its own SLA: the loser polls the real 500ms for
      // the real 10 seconds, because the 409 IS that window expiring.
      name: 'a-loser-times-out-with-a-409-naming-the-stalled-refresh',
      timeout: 30000,

      async run({ assert }) {
        resetRefreshCalls();

        const held = heldLease(1);

        const { ctx, writes, responses } = lane({
          docs: {
            [`users/${USER_UID}`]: storedRecord({ refreshing: held, updated: { timestamp: 'then', timestampUNIX: 1700000000 } }),
          },
        });

        await postRoute({
          ctx,
          user: userWithConnection(),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        const response = answered(responses);

        assert.equal(response.options.code, 409, `a refresh that never settles is a conflict, not a success: ${response.message}`);
        assert.match(response.message, new RegExp(held.instance), `and the message names the stalled refresh: ${response.message}`);
        assert.match(response.message, new RegExp(PROVIDER_ID), 'and the provider it is stuck on');
        assert.equal(refreshCalls(), 0, 'the provider was never called');
        assert.equal(writes.length, 0, 'and nothing was written — no token, no lease, no stamp');
      },
    },
  ],
});
