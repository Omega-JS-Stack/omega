const {
  createTestAccounts,
  _deleteAccountsIndividually,
  getAccountDefinitions,
  GOOGLE_ACCOUNTS,
  SEED_CONCURRENCY,
} = require('../../dist/test/test-accounts.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/**
 * Test: the persona seed bounds its auth writes ([#1117](https://github.com/Omega-JS-Stack/omega/issues/1117))
 * The emulator spawns one runtime worker per in-flight auth trigger, uncapped,
 * so creates and deletes go through a pool of SEED_CONCURRENCY, every persona
 * still lands, and a dead auth:on-create trigger aborts the whole seed loudly.
 *
 * Why a fake admin, not the emulator: a real seed would wipe the personas every
 * other suite signs in as, and the emulator can neither show the in-flight peak
 * nor kill one trigger. The fake's auth calls settle on the next tick.
 *
 * Run: npx omega test helpers/seed-concurrency
 */

const DOMAIN = 'example.com';
const CONFIG = { brand: { url: `https://${DOMAIN}` } };

// The doc auth:on-create leaves behind: complete the moment the user exists,
// so the seed's readiness poll answers on its first read.
const ON_CREATE_DOC = () => ({ metadata: { tag: 'auth:on-create' }, api: { clientId: 'c', privateKey: 'k' } });

/**
 * An admin whose auth methods settle on the next tick, counting each one's in-flight peak.
 * `onCreateDead` stands in a dead auth:on-create trigger: a created user gets no user doc.
 */
function fakeAdmin({ onCreateDead = false } = {}) {
  const inFlight = {};
  const peaks = {};
  const users = new Set();
  const docs = new Map();

  const tracked = (method, fn) => async (...args) => {
    inFlight[method] = (inFlight[method] || 0) + 1;
    peaks[method] = Math.max(peaks[method] || 0, inFlight[method]);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight[method]--;
    return fn(...args);
  };

  const auth = {
    createUser: tracked('createUser', ({ uid }) => {
      users.add(uid);
      if (!onCreateDead) docs.set(`users/${uid}`, ON_CREATE_DOC());
      return { uid };
    }),
    deleteUser: tracked('deleteUser', (uid) => {
      if (!users.delete(uid)) {
        throw Object.assign(new Error(`no user ${uid}`), { code: 'auth/user-not-found' });
      }
      docs.delete(`users/${uid}`);
    }),
    importUsers: tracked('importUsers', (records) => {
      for (const record of records) users.add(record.uid);
      return { failureCount: 0, errors: [] };
    }),
  };

  const firestore = {
    doc: (path) => ({
      get: async () => {
        const data = docs.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      set: async (value, options) => {
        docs.set(path, options && options.merge ? { ...(docs.get(path) || {}), ...value } : value);
      },
      delete: async () => {
        docs.delete(path);
      },
    }),
  };

  return {
    admin: { auth: () => auth, firestore: () => firestore },
    peaks,
    users,
    docs,
  };
}

module.exports = defineCases({
  description: 'The persona seed keeps its auth writes under SEED_CONCURRENCY',
  type: 'group',
  auth: 'none',

  tests: [
    {
      name: 'create-holds-the-pool-and-still-creates-every-persona',
      async run({ expect }) {
        const { admin, peaks } = fakeAdmin();
        const expected = Object.keys(getAccountDefinitions(DOMAIN, CONFIG)).length
          + Object.keys(GOOGLE_ACCOUNTS).length;

        const result = await createTestAccounts(admin, DOMAIN, CONFIG, undefined);

        expect(peaks.createUser, `createUser peaked at ${peaks.createUser} in flight against SEED_CONCURRENCY ${SEED_CONCURRENCY}`).toBeLessThanOrEqual(SEED_CONCURRENCY);
        expect(result.errors, 'No persona failed to seed').toEqual([]);
        expect(result.created, 'Every persona and every Google persona is reported created').toBe(expected);
      },
    },

    {
      name: 'individual-delete-holds-the-pool-and-deletes-every-account',
      async run({ expect }) {
        const { admin, peaks, users, docs } = fakeAdmin();
        const accounts = getAccountDefinitions(DOMAIN, CONFIG);

        for (const account of Object.values(accounts)) {
          users.add(account.uid);
          docs.set(`users/${account.uid}`, ON_CREATE_DOC());
        }

        const results = { deleted: [], skipped: [], failed: [] };
        await _deleteAccountsIndividually(admin, accounts, results);

        expect(peaks.deleteUser, `deleteUser peaked at ${peaks.deleteUser} in flight against SEED_CONCURRENCY ${SEED_CONCURRENCY}`).toBeLessThanOrEqual(SEED_CONCURRENCY);
        expect(results.failed, 'No delete failed').toEqual([]);
        expect(results.deleted.length, 'Every account is counted deleted').toBe(Object.keys(accounts).length);
      },
    },

    {
      name: 'a-dead-on-create-trigger-aborts-the-seed-loudly',
      async run({ expect }) {
        const { admin } = fakeAdmin({ onCreateDead: true });

        // The seed's readiness polls (500 ms and 200 ms) are real timers; the case needs their
        // logic, not their length, and longer timers (the runner's own) keep theirs.
        const real = global.setTimeout;
        global.setTimeout = (fn, ms, ...args) => real(fn, ms <= 500 ? 0 : ms, ...args);
        try {
          const pending = createTestAccounts(admin, DOMAIN, CONFIG, undefined);
          await expect(pending, 'The seed rejects instead of reporting a dead persona created')
            .rejects.toThrow(/^auth:on-create never completed for \S+@example\.com/);
        } finally {
          global.setTimeout = real;
        }
      },
    },
  ],
});
