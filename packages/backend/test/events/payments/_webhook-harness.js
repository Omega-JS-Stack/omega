/**
 * Shared harness for the PLAIN-NODE webhook-pipeline suites (no emulator, no
 * network): the real payments-webhooks trigger run against a minimal in-memory
 * Firestore stand-in.
 *
 * The stand-in is the honest layer for these cases. The emulator cannot produce
 * a mid-batch write fault at all (the admin SDK bypasses rules, every write is
 * legal), and it cannot hand one test a user doc seeded into an exact prior
 * state without minting a persona and a payment history per permutation. The
 * emulator suites stay the integration surface for the happy paths.
 *
 * `_`-prefixed, so the runner never discovers it as a suite.
 */
const onWrite = require('../../../src/manager/events/firestore/payments-webhooks/on-write.js');

// The brand config the transformers read products out of
const CONFIG = {
  payment: {
    products: [
      { id: 'basic', name: 'Basic', type: 'subscription' },
      { id: 'premium', name: 'Premium', type: 'subscription', prices: { monthly: 4.99 }, stripe: { productId: '_test_premium' } },
    ],
  },
};

/**
 * Minimal in-memory Firestore stand-in: the doc reads/writes, the collection query
 * the test processor's fetchResource() makes, and the write batch. `failPath` is the
 * document path whose write rejects — mid-batch in the real world, before anything
 * lands once the writes are batched.
 *
 * `authUids` is the project's auth store: the pipeline asks it whether a uid is one
 * of ours before it will create a user doc ([#399]).
 *
 * @param {object} options
 * @param {object} options.seed - Document path → data, the state the run starts from
 * @param {string|null} options.failPath - The document path whose write rejects
 * @param {string[]} options.authUids - The uids that have a Firebase auth user
 * @returns {{ admin: object, store: Map }}
 */
function buildAdmin({ seed = {}, failPath = null, authUids = [] } = {}) {
  const store = new Map(Object.entries(seed));

  const write = (path, data, options) => {
    if (path === failPath) {
      throw new Error(`Firestore write to ${path} failed`);
    }

    store.set(path, options?.merge ? merge(store.get(path) || {}, data) : data);
  };

  const doc = (path) => ({
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (data, options) => write(path, data, options),
  });

  const query = (collection, filters) => ({
    where: (field, op, value) => query(collection, [...filters, { field, value }]),
    limit: () => query(collection, filters),
    get: async () => {
      const paths = [...store.keys()]
        .filter(path => path.startsWith(`${collection}/`))
        .filter(path => filters.every(f => store.get(path)[f.field] === f.value));

      return { empty: paths.length === 0, docs: paths.map(path => ({ id: path.split('/').pop(), data: () => store.get(path) })) };
    },
  });

  const admin = {
    auth: () => ({
      getUser: async (uid) => {
        if (!authUids.includes(uid)) {
          // The admin SDK's own not-found shape — the code branches on the code
          const error = new Error(`There is no user record corresponding to the provided identifier.`);
          error.code = 'auth/user-not-found';
          throw error;
        }

        return { uid: uid };
      },
    }),
    firestore: () => ({
      doc,
      collection: (name) => query(name, []),
      batch: () => {
        const staged = [];

        return {
          set: (ref, data, options) => staged.push([ref.path, data, options]),
          commit: async () => {
            // A real batch is atomic: one rejected write means none of them landed
            for (const [path] of staged) {
              if (path === failPath) {
                throw new Error(`Firestore batch write to ${path} failed`);
              }
            }

            staged.forEach(args => write(...args));
          },
        };
      },
    }),
  };

  return { admin, store };
}

/** Deep-merge for the stand-in's `{ merge: true }` writes (metadata nests one level) */
function merge(existing, data) {
  const result = { ...existing };

  for (const [key, value] of Object.entries(data)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(existing[key] || {}, value)
      : value;
  }

  return result;
}

/**
 * A Stripe-shaped active subscription — the test processor's payload shape
 *
 * @param {object} options - uid, orderId, resourceId
 * @returns {object}
 */
function subscriptionPayload({ uid, orderId, resourceId }) {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    id: resourceId,
    object: 'subscription',
    status: 'active',
    metadata: { uid: uid, orderId: orderId },
    cancel_at_period_end: false,
    current_period_start: nowUNIX,
    current_period_end: nowUNIX + 86400,
    start_date: nowUNIX,
    plan: { product: '_test_premium', interval: 'month' },
  };
}

/**
 * Run the real trigger over a pending webhook doc against the stand-in
 *
 * @param {object} options
 * @param {string} options.uid - The subscriber the event belongs to
 * @param {string} options.orderId - The order the event writes
 * @param {string} options.resourceId - The subscription the event is about
 * @param {string} options.eventId - The webhook doc id
 * @param {string} options.eventType - The processor's event name
 * @param {string} options.resourceType - The parsed event's resource type (a subscription-category event can ride an invoice or sale resource)
 * @param {string} options.category - The parsed event's category ('subscription' | 'one-time')
 * @param {object|null} options.payload - The resource the webhook envelope carries (defaults to an active subscription)
 * @param {object} options.seed - Extra documents the run starts from
 * @param {string|null} options.failPath - The document path whose write rejects
 * @param {string[]} [options.authUids] - The uids that have a Firebase auth user (default: the subscriber, as every real one does)
 * @param {boolean} [options.reporting] - Whether a Sentry handle is configured at all (false = no DSN, `libraries.sentry` is null)
 * @returns {Promise<{ store: Map, logs: string[], captures: object[] }>}
 */
async function runTrigger({ uid, orderId, resourceId, eventId, eventType = 'customer.subscription.updated', resourceType = 'subscription', category = 'subscription', payload = null, seed = {}, failPath = null, authUids = null, reporting = true } = {}) {
  const resource = payload || subscriptionPayload({ uid, orderId, resourceId });
  const raw = { id: eventId, type: eventType, data: { object: resource } };
  const webhookDoc = {
    id: eventId,
    processor: 'test',
    status: 'pending',
    raw: raw,
    owner: uid,
    event: { type: raw.type, category: category, resourceType: resourceType, resourceId: resourceId },
    metadata: { created: { timestampUNIX: Math.floor(Date.now() / 1000) } },
  };

  const { admin, store } = buildAdmin({
    seed: { [`payments-webhooks/${eventId}`]: webhookDoc, ...seed },
    failPath: failPath,
    authUids: authUids || [uid],
  });

  const logs = [];

  // The error reporter is an external SINK, recorded rather than run — the same
  // treatment the route harness gives `res`. `libraries.sentry` IS the backend's
  // one capture handle (helpers/context/respond.js reads exactly this), and it is
  // null whenever no DSN is configured, which `reporting: false` reproduces.
  const captures = [];
  const sentry = reporting
    ? { captureMessage: (message, context) => captures.push({ message, ...context }) }
    : null;

  const Manager = { config: CONFIG, libraries: { admin, sentry } };
  const ctx = {
    Manager,
    isTesting: () => true,
    log: (...args) => logs.push(args.join(' ')),
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' ')),
  };

  await onWrite({
    ctx,
    change: { before: { data: () => webhookDoc }, after: { data: () => webhookDoc } },
    context: { params: { eventId: eventId } },
  });

  return { store, logs, captures };
}

module.exports = { CONFIG, buildAdmin, merge, subscriptionPayload, runTrigger };
