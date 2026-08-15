/**
 * Test: the daily trial-lapse sweep
 *
 * A trial that ends without converting should leave the user on basic. The processors
 * say so with a webhook, and when that webhook is missed the user keeps a paid product
 * they never paid for — invisibly, because `trial.claimed` means "this subscription HAD
 * a trial", never "it converted" ([#212]).
 *
 * The sweep is a BACKSTOP, so what it must NOT do matters as much as what it does: it
 * never infers a lapse from dates alone (every candidate is confirmed against live
 * processor state), it leaves the 24h grace window and everything older than 30 days
 * alone, and a second run changes nothing.
 *
 * The test processor answers `fetchResource` from `payments-orders`, so "the processor
 * says X" is seeded as an order doc — or, for "the subscription is gone", as no order
 * doc at all.
 */
const DAY = 24 * 60 * 60;

const GONE_UID = '_test-trial-lapse-gone';
const CANCELLED_UID = '_test-trial-lapse-cancelled';
const CONVERTED_UID = '_test-trial-lapse-converted';
const GRACE_UID = '_test-trial-lapse-grace';
const AGED_UID = '_test-trial-lapse-aged';

const CANCELLED_ORDER = '_test-order-trial-lapse-cancelled';
const CONVERTED_ORDER = '_test-order-trial-lapse-converted';

module.exports = {
  description: 'Trial-lapse sweep: confirms with the processor, then corrects state',
  type: 'suite',
  timeout: 180000,

  tests: [
    {
      name: 'seed-expired-trials',
      async run({ firestore, assert, state, config, skip }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.type === 'subscription' && p.prices);

        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        state.paidProductId = paidProduct.id;

        // Five candidates, one per branch the sweep has to get right
        state.seeds = {
          // Trial ended 5 days ago; NO order doc → the processor has no such subscription
          [GONE_UID]: { expiredAgo: 5 * DAY, resourceId: 'sub_test_trial_gone', orderId: null },
          // Trial ended 5 days ago; the order says the processor cancelled it
          [CANCELLED_UID]: { expiredAgo: 5 * DAY, resourceId: 'sub_test_trial_cancelled', orderId: CANCELLED_ORDER },
          // Trial ended 5 days ago; the order says the subscription is live — it converted
          [CONVERTED_UID]: { expiredAgo: 5 * DAY, resourceId: 'sub_test_trial_converted', orderId: CONVERTED_ORDER },
          // Trial ended 2 hours ago — inside the grace window that absorbs webhook lag
          [GRACE_UID]: { expiredAgo: 2 * 60 * 60, resourceId: 'sub_test_trial_grace', orderId: null },
          // Trial ended 40 days ago — aged out below the sweep's floor
          [AGED_UID]: { expiredAgo: 40 * DAY, resourceId: 'sub_test_trial_aged', orderId: null },
        };

        const nowUNIX = Math.floor(Date.now() / 1000);

        for (const [uid, seed] of Object.entries(state.seeds)) {
          const expiredUNIX = nowUNIX - seed.expiredAgo;

          await firestore.delete(`users/${uid}`);
          await firestore.set(`users/${uid}`, {
            subscription: {
              product: { id: paidProduct.id, name: paidProduct.name || paidProduct.id },
              status: 'active',
              expires: stamp(expiredUNIX),
              trial: { claimed: true, expires: stamp(expiredUNIX) },
              cancellation: { pending: false, date: stamp(0) },
              payment: { processor: 'test', orderId: seed.orderId, resourceId: seed.resourceId, frequency: 'monthly' },
            },
          });
        }

        // The processor's answers for the two candidates that have a subscription:
        // an order whose `unified` the test library reconstructs a resource from
        await firestore.delete(`payments-orders/${CANCELLED_ORDER}`);
        await firestore.set(`payments-orders/${CANCELLED_ORDER}`, order({
          id: CANCELLED_ORDER,
          owner: CANCELLED_UID,
          productId: paidProduct.id,
          resourceId: 'sub_test_trial_cancelled',
          status: 'cancelled',
        }));

        await firestore.delete(`payments-orders/${CONVERTED_ORDER}`);
        await firestore.set(`payments-orders/${CONVERTED_ORDER}`, order({
          id: CONVERTED_ORDER,
          owner: CONVERTED_UID,
          productId: paidProduct.id,
          resourceId: 'sub_test_trial_converted',
          status: 'active',
        }));

        const seeded = await firestore.get(`users/${GONE_UID}`);
        assert.equal(seeded.subscription.status, 'active', 'Every candidate starts active on a paid product');
      },
    },

    {
      name: 'the-sweep-lapses-what-the-processor-no-longer-has',
      timeout: 150000,
      async run({ firestore, assert, waitFor, pubsub, state }) {
        await pubsub.trigger('omega_cronDaily');

        await waitFor(async () => {
          const doc = await firestore.get(`users/${GONE_UID}`);
          return !!doc?.subscription?.trial?.outcome;
        }, 120000, 1000);

        const gone = await firestore.get(`users/${GONE_UID}`);

        assert.equal(gone.subscription.trial.outcome, 'lapsed', 'The processor has no such subscription — the trial lapsed');
        assert.equal(gone.subscription.status, 'cancelled', 'A lapsed trial ends cancelled');
        assert.equal(gone.subscription.product.id, 'basic', 'A lapsed trial ends on basic');
        assert.equal(gone.subscription.cancellation.pending, false, 'Nothing is left pending');
        assert.equal(gone.subscription.trial.claimed, true, 'claimed still means "a trial happened" — the sweep never repurposes it');

        state.lapsedCancelledAtUNIX = gone.subscription.cancellation.date.timestampUNIX;
      },
    },

    {
      name: 'a-cancelled-subscription-lapses-the-same-way',
      timeout: 60000,
      async run({ firestore, assert, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`users/${CANCELLED_UID}`);
          return !!doc?.subscription?.trial?.outcome;
        }, 30000, 500);

        const cancelled = await firestore.get(`users/${CANCELLED_UID}`);

        assert.equal(cancelled.subscription.trial.outcome, 'lapsed', 'The processor says cancelled — the trial lapsed');
        assert.equal(cancelled.subscription.status, 'cancelled', 'A lapsed trial ends cancelled');
        assert.equal(cancelled.subscription.product.id, 'basic', 'A lapsed trial ends on basic');
      },
    },

    {
      name: 'a-converted-trial-is-stamped-and-otherwise-untouched',
      async run({ firestore, assert, state }) {
        const converted = await firestore.get(`users/${CONVERTED_UID}`);

        assert.equal(converted.subscription.trial.outcome, 'converted', 'The processor says active — the trial converted');
        assert.equal(converted.subscription.status, 'active', 'A converted trial keeps its active subscription');
        assert.equal(converted.subscription.product.id, state.paidProductId, 'A converted trial keeps its paid product');
        assert.equal(converted.subscription.cancellation.pending, false, 'Nothing was cancelled');
      },
    },

    {
      name: 'the-window-edges-are-left-alone',
      async run({ firestore, assert, state }) {
        const grace = await firestore.get(`users/${GRACE_UID}`);
        const aged = await firestore.get(`users/${AGED_UID}`);

        assert.equal(grace.subscription.trial.outcome, undefined, 'A trial that ended 2h ago is inside the grace window — webhook lag gets its chance first');
        assert.equal(grace.subscription.status, 'active', 'The grace candidate is untouched');
        assert.equal(grace.subscription.product.id, state.paidProductId, 'The grace candidate keeps its product');

        assert.equal(aged.subscription.trial.outcome, undefined, 'A trial that ended 40 days ago is below the floor — history is not the sweep\'s job');
        assert.equal(aged.subscription.status, 'active', 'The aged candidate is untouched');
      },
    },

    {
      name: 'a-second-run-changes-nothing',
      timeout: 150000,
      async run({ firestore, assert, waitFor, pubsub, state }) {
        // A run that skips every stamped candidate produces no signal of its own, so
        // the grace candidate becomes the marker: aged past the grace window, the
        // SECOND run must lapse it — and its stamp is proof the sweep ran to the end.
        const expiredUNIX = Math.floor(Date.now() / 1000) - 5 * DAY;
        await firestore.set(`users/${GRACE_UID}`, {
          subscription: { trial: { expires: stamp(expiredUNIX) } },
        }, { merge: true });

        await pubsub.trigger('omega_cronDaily');

        await waitFor(async () => {
          const doc = await firestore.get(`users/${GRACE_UID}`);
          return !!doc?.subscription?.trial?.outcome;
        }, 120000, 1000);

        const grace = await firestore.get(`users/${GRACE_UID}`);
        const gone = await firestore.get(`users/${GONE_UID}`);
        const converted = await firestore.get(`users/${CONVERTED_UID}`);

        assert.equal(grace.subscription.trial.outcome, 'lapsed', 'The second run reached the sweep and lapsed the newly-eligible candidate');
        assert.equal(gone.subscription.trial.outcome, 'lapsed', 'The already-lapsed candidate is still lapsed');
        assert.equal(
          gone.subscription.cancellation.date.timestampUNIX,
          state.lapsedCancelledAtUNIX,
          'The cancellation date is the FIRST run\'s — the second run skipped it instead of writing again',
        );
        assert.equal(converted.subscription.trial.outcome, 'converted', 'The converted candidate is still converted');
        assert.equal(converted.subscription.status, 'active', 'The converted candidate is still active');
      },
    },
  ],
};

/**
 * A `$timestamp` pair from a UNIX second
 */
function stamp(unix) {
  return { timestamp: new Date(unix * 1000).toISOString(), timestampUNIX: unix };
}

/**
 * The purchase record the test processor answers `fetchResource` from — its `unified`
 * status IS what the processor reports for the subscription
 */
function order({ id, owner, productId, resourceId, status }) {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    id: id,
    type: 'subscription',
    owner: owner,
    productId: productId,
    processor: 'test',
    resourceId: resourceId,
    unified: {
      product: { id: productId },
      status: status,
      expires: stamp(nowUNIX + 30 * DAY),
      trial: { claimed: true, expires: stamp(nowUNIX - 5 * DAY) },
      cancellation: { pending: false },
      payment: { processor: 'test', orderId: id, resourceId: resourceId, frequency: 'monthly' },
    },
    metadata: {
      created: stamp(nowUNIX - 20 * DAY),
      updated: stamp(nowUNIX - 20 * DAY),
    },
  };
}
