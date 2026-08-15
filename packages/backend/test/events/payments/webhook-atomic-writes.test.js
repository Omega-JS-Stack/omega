/**
 * Test: the webhook pipeline's three writes land together or not at all
 *
 * Processing a subscription event writes users/{uid}.subscription, then
 * payments-orders/{orderId}, then payments-intents/{orderId}. As three separate
 * awaits, a throw between them left the user PAID with no order behind it — the
 * order page, the cancel endpoint and the refund lane all read the order, so the
 * split state is invisible until a support ticket ([#219]).
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against a minimal in-memory Firestore stand-in whose payments-orders write
 * rejects. The emulator cannot produce this fault at all — the admin SDK bypasses
 * rules, and all three writes are legal — so the split is only reachable by making
 * one write fail, which is exactly what the stand-in does. The emulator suites stay
 * the integration surface for the happy paths.
 */
const assert = require('node:assert');
const onWrite = require('../../../src/manager/events/firestore/payments-webhooks/on-write.js');

const UID = '_test-atomic-uid';
const ORDER_ID = '4242-4242-4242';
const RESOURCE_ID = '_test-atomic-sub';
const EVENT_ID = '_test-atomic-evt';

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
 */
function buildAdmin({ seed = {}, failPath = null } = {}) {
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

/** A Stripe-shaped active subscription — the test processor's payload shape */
function subscriptionPayload() {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    id: RESOURCE_ID,
    object: 'subscription',
    status: 'active',
    metadata: { uid: UID, orderId: ORDER_ID },
    cancel_at_period_end: false,
    current_period_start: nowUNIX,
    current_period_end: nowUNIX + 86400,
    start_date: nowUNIX,
    plan: { product: '_test_premium', interval: 'month' },
  };
}

/** Run the real trigger over a pending webhook doc against the stand-in */
async function runTrigger({ failPath } = {}) {
  const raw = { id: EVENT_ID, type: 'customer.subscription.updated', data: { object: subscriptionPayload() } };
  const webhookDoc = {
    id: EVENT_ID,
    processor: 'test',
    status: 'pending',
    raw: raw,
    owner: UID,
    event: { type: raw.type, category: 'subscription', resourceType: 'subscription', resourceId: RESOURCE_ID },
    metadata: { created: { timestampUNIX: Math.floor(Date.now() / 1000) } },
  };

  const { admin, store } = buildAdmin({
    seed: { [`payments-webhooks/${EVENT_ID}`]: webhookDoc },
    failPath: failPath,
  });

  const logs = [];
  const Manager = { config: CONFIG, libraries: { admin } };
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
    context: { params: { eventId: EVENT_ID } },
  });

  return { store, logs };
}

module.exports = {
  description: 'Webhook pipeline writes are atomic (no split payment state)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a healthy event writes the subscription, the order and the intent',

      async run() {
        const { store } = await runTrigger();

        assert.equal(store.get(`users/${UID}`)?.subscription?.status, 'active', 'the subscription lands');
        assert.equal(store.get(`payments-orders/${ORDER_ID}`)?.owner, UID, 'the order lands');
        assert.equal(store.get(`payments-intents/${ORDER_ID}`)?.status, 'completed', 'the intent is closed out');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'completed', 'the webhook completes');
      },
    },

    {
      name: 'a failed order write leaves NO subscription behind it',

      async run() {
        const { store } = await runTrigger({ failPath: `payments-orders/${ORDER_ID}` });

        assert.ok(!store.get(`users/${UID}`)?.subscription, 'the user must not be left paid with no order');
        assert.ok(!store.get(`payments-orders/${ORDER_ID}`), 'the order write is the one that failed');
        assert.equal(store.get(`payments-intents/${ORDER_ID}`)?.status, 'failed', 'the failure path still closes the intent');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'failed', 'the webhook is marked failed');
      },
    },
  ],
};
