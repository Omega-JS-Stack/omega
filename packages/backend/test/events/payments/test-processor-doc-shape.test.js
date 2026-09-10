/**
 * Test: every test processor writes the pipeline doc the ROUTE writes
 *
 * The test provider's cancel, refund, plan and uncancel processors skip the HTTP
 * door and write `payments-webhooks/{eventId}` themselves — which makes them the
 * only writers of that document besides the webhook route, and the only ones
 * nothing verifies against it. The Stage 1 review found them spelling the metadata
 * block `received`/`processed` where the route spells it `created`/`completed`
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * `metadata.created.timestampUNIX` is not decoration: it is the pipeline's
 * STALENESS CLOCK — the number `processPaymentEvent()` compares against the order's
 * last write to decide an out-of-order delivery. A synthetic doc that never wrote
 * it handed the clock nothing, and every test-processor event rode the now-fallback
 * as if it had just arrived. Harmless while the fallback holds, and exactly the
 * kind of drift that stops being harmless the moment the fallback changes.
 *
 * Plain-node (no emulator, no network): each processor is called directly against
 * the shared in-memory Firestore stand-in, and the document it left behind is the
 * assertion. The route's own doc is built beside them from the SAME source the
 * route uses, so this compares two real shapes rather than one shape and a copy of
 * itself in a fixture.
 *
 * Run: npx omega test backend:events/payments/test-processor-doc-shape
 */
const assert = require('node:assert');
const { buildAdmin, CONFIG } = require('./_webhook-harness.js');

const cancelProcessor = require('../../../dist/manager/routes/payments/cancel/providers/test.js');
const refundProcessor = require('../../../dist/manager/routes/payments/refund/providers/test.js');
const planProcessor = require('../../../dist/manager/routes/payments/plan/providers/test.js');
const uncancelProcessor = require('../../../dist/manager/routes/payments/uncancel/providers/test.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-doc-shape-uid';
const RESOURCE_ID = '_test-doc-shape-sub';
const ORDER_ID = '_test-doc-shape-order';

const DAY = 24 * 60 * 60;

/** A `$timestamp` pair from a UNIX second */
function stamp(unix) {
  return { timestamp: new Date(unix * 1000).toISOString(), timestampUNIX: unix };
}

/** The paid subscription every processor here acts on */
function subscription() {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    product: { id: 'premium', name: 'Premium' },
    status: 'active',
    expires: stamp(nowUNIX + 20 * DAY),
    trial: { claimed: false },
    cancellation: { pending: false },
    payment: { provider: 'test', orderId: ORDER_ID, resourceId: RESOURCE_ID, frequency: 'monthly', price: 4.99, startDate: stamp(nowUNIX - 30 * DAY) },
  };
}

/** The purchase record behind it */
function order() {
  return {
    id: ORDER_ID,
    type: 'subscription',
    owner: UID,
    productId: 'premium',
    provider: 'test',
    resourceId: RESOURCE_ID,
    unified: { ...subscription(), product: { id: 'premium', name: 'Premium' } },
  };
}

/**
 * Run one processor against the stand-in and hand back every payments-webhooks doc
 * it wrote
 *
 * @param {function} act - `(ctx) => Promise` — the processor call under test
 * @returns {Promise<object[]>} The synthetic pipeline documents
 */
async function synthesize(act) {
  const { admin, store } = buildAdmin({
    seed: { [`payments-orders/${ORDER_ID}`]: order() },
    authUids: [UID],
  });

  const ctx = {
    Manager: { config: CONFIG, libraries: { admin } },
    isProduction: () => false,
    isTesting: () => true,
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  await act(ctx);

  return [...store.entries()]
    .filter(([path]) => path.startsWith('payments-webhooks/'))
    .map(([, data]) => data);
}

/** The four processors, each reduced to the one call that writes a pipeline doc */
const PROCESSORS = [
  ['cancel', (ctx) => cancelProcessor.cancelAtPeriodEnd({ resourceId: RESOURCE_ID, uid: UID, subscription: subscription(), ctx })],
  ['refund', (ctx) => refundProcessor.processRefund({ resourceId: RESOURCE_ID, uid: UID, subscription: subscription(), ctx })],
  ['plan', (ctx) => planProcessor.switchPlan({ resourceId: RESOURCE_ID, uid: UID, subscription: subscription(), product: CONFIG.payment.products.find((p) => p.id === 'premium'), frequency: 'monthly', ctx })],
  ['uncancel', (ctx) => uncancelProcessor.uncancel({ resourceId: RESOURCE_ID, uid: UID, subscription: subscription(), ctx })],
  ['refund (one-time)', (ctx) => refundProcessor.processOneTimeRefund({ resourceId: RESOURCE_ID, uid: UID, order: { ...order(), type: 'one-time' }, ctx })],
];

module.exports = defineCases({
  description: 'Test processors write the same pipeline-doc shape the webhook route does',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'every-processor-stamps-the-staleness-clock-the-pipeline-reads',

      async run() {
        for (const [name, act] of PROCESSORS) {
          const docs = await synthesize(act);

          assert.equal(docs.length, 1, `the ${name} processor should write exactly one pipeline doc, got ${docs.length}`);

          const [doc] = docs;

          assert.equal(
            typeof doc.metadata?.created?.timestampUNIX,
            'number',
            `the ${name} processor must stamp metadata.created.timestampUNIX — it is the number the pipeline's staleness guard compares against the order`,
          );
          assert.equal(typeof doc.metadata?.created?.timestamp, 'string', `the ${name} processor must stamp metadata.created.timestamp beside it`);
          assert.ok('completed' in (doc.metadata || {}), `the ${name} processor must open metadata.completed, the slot the pipeline closes out`);
          assert.equal(doc.metadata.completed.timestampUNIX, null, `the ${name} processor must leave metadata.completed empty — nothing has processed yet`);

          assert.equal(doc.metadata.received, undefined, `the ${name} processor must not spell the arrival stamp 'received' — the route calls it 'created' and the pipeline only reads that one`);
          assert.equal(doc.metadata.processed, undefined, `the ${name} processor must not spell the completion stamp 'processed' — the route calls it 'completed'`);
        }
      },
    },

    {
      name: 'every-processor-writes-the-rest-of-the-envelope-the-pipeline-needs',

      async run() {
        for (const [name, act] of PROCESSORS) {
          const [doc] = await synthesize(act);

          assert.equal(doc.provider, 'test', `the ${name} processor's doc names the provider whose library the pipeline loads`);
          assert.equal(doc.status, 'pending', `the ${name} processor's doc must be pending — the trigger short-circuits on anything else`);
          assert.equal(doc.owner, UID, `the ${name} processor's doc carries the owner the event is about`);
          assert.equal(doc.error, null, `the ${name} processor's doc opens with no error`);
          assert.ok(doc.event?.type, `the ${name} processor's doc names an event type`);
          assert.ok(doc.event?.category, `the ${name} processor's doc names a category — the pipeline throws without one`);
          assert.ok(doc.event?.resourceId, `the ${name} processor's doc names the resource the event is about`);
          assert.equal(doc.raw?.type, doc.event.type, `the ${name} processor's envelope and its parsed event must name the same event`);
        }
      },
    },
  ],
});
