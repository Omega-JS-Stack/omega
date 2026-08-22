/**
 * Test: POST /payments/cancel — a TRIAL cancel ends access immediately
 * ([#267](https://github.com/Omega-JS-Stack/omega/issues/267)).
 *
 * Ian's ruling (2026-08-15): we do not keep serving a trial we know will not
 * convert. Two things follow, and this file proves both:
 *
 *  - the 24-hour young-subscription guard does not apply to a trial. That guard
 *    exists to stop a cancellation racing a PAID checkout that is still
 *    settling; a trial has no payment to settle, and cancelling the same day you
 *    started is the most common trial behavior there is. It used to answer
 *    "your subscription is still being set up" — the journey suite only got past
 *    it by sending `skipGuards`, which is a privileged request, not something a
 *    real trialer can send.
 *  - `_is-trialing.js` is the ONE definition of "still inside the trial", shared
 *    by the route and all four cancel providers. It was three copies before,
 *    which is how the route came to disagree with the providers it calls.
 *
 * Three layers, each proving what it can:
 *  - the classifier as a pure function (zero I/O — the framework's one exception
 *    to running everything for real), over the subscription shapes the pipeline
 *    actually writes;
 *  - the route against the real emulator: a trialing subscription minutes old
 *    gets PAST the guard, and a paid one exactly as young still does not;
 *  - every cancel PROVIDER, one case per provider: the branch has to reach the
 *    provider's own immediate-cancel verb, not merely log that it meant to. The
 *    provider SDK/HTTP seam is the one thing stood in for (creating and
 *    cancelling a live subscription needs a real account), exactly as
 *    intent-discount-coupons.test.js does it; the test provider writes to the
 *    real emulator instead, since its "provider" IS Firestore.
 *
 * The route cases carry a deliberately unknown provider, so getting past the
 * guard lands on "Unknown provider" and nothing external is ever reached — the
 * technique cancel-skip-guards.test.js established. Both verdicts are a 400 with
 * DIFFERENT text, which is what separates "the guard ran" from "the guard did
 * not".
 *
 * PayPal has no immediate-cancel verb to reach — one endpoint cancels, and the
 * immediacy is enforced in the unified transform instead (a subscription inside
 * its trial window gets no remaining period). The transform half is pinned in
 * helpers/payment/paypal/to-unified-subscription.test.js; what belongs here is
 * that the provider calls the cancel endpoint and says which cancel it was.
 *
 * Run: npx omega test backend:routes/payments/cancel-trialing
 */
const { buildUser, callHandler, withEnvironment, PRODUCTION_ENVIRONMENT } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/cancel/post.js');
const isTrialing = require('../../../src/manager/routes/payments/cancel/_is-trialing.js');

const StripeLib = require('../../../src/manager/libraries/payment/providers/stripe.js');
const ChargebeeLib = require('../../../src/manager/libraries/payment/providers/chargebee.js');
const PayPalLib = require('../../../src/manager/libraries/payment/providers/paypal.js');

const stripeCancel = require('../../../src/manager/routes/payments/cancel/providers/stripe.js');
const chargebeeCancel = require('../../../src/manager/routes/payments/cancel/providers/chargebee.js');
const paypalCancel = require('../../../src/manager/routes/payments/cancel/providers/paypal.js');
const testCancel = require('../../../src/manager/routes/payments/cancel/providers/test.js');

const DAY = 24 * 60 * 60;

/**
 * A subscriber whose subscription started minutes ago — the age the guard
 * exists for. A trialing one expires exactly when its trial does; a paid one
 * carries no trial at all.
 */
function youngSubscriber(Manager, { uid, trialing }) {
  const nowUNIX = Math.floor(Date.now() / 1000);
  const trialEndUNIX = nowUNIX + (14 * DAY);
  const stamp = (unix) => ({ timestamp: new Date(unix * 1000).toISOString(), timestampUNIX: unix });

  return buildUser(Manager, {
    auth: { uid: uid, email: `${uid}@example.com` },
    roles: {},
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      cancellation: { pending: false },
      // A live trial expires WITH its trial; a paid subscription runs to the end
      // of the period it paid for.
      expires: stamp(trialing ? trialEndUNIX : nowUNIX + (30 * DAY)),
      trial: trialing
        ? { claimed: true, expires: stamp(trialEndUNIX) }
        : { claimed: false },
      payment: {
        // Deliberately unknown: getting PAST the age guard must not reach a real provider
        provider: 'unknown-provider',
        resourceId: 'sub_test_trial_cancel',
        startDate: stamp(nowUNIX),
      },
    },
  });
}

// Cancel the way a real customer does — no privileged `skipGuards` anywhere.
function cancel(Manager, user) {
  return callHandler({
    Manager,
    handler,
    functionName: 'payments-cancel',
    user,
    settings: { confirmed: true, skipGuards: false, reason: 'Not for me', feedback: null },
  });
}

// The guards have to be driven in a PRODUCTION environment: in a testing run
// every caller may bypass them by design, so a testing-run assertion would
// prove nothing (the reasoning cancel-skip-guards.test.js sets out in full).
function cancelInProduction(Manager, user) {
  return withEnvironment(PRODUCTION_ENVIRONMENT, () => cancel(Manager, user));
}

// The subscription shapes the pipeline writes, as the classifier sees them.
const nowUNIX = Math.floor(Date.now() / 1000);
const at = (unix) => ({ timestamp: new Date(unix * 1000).toISOString(), timestampUNIX: unix });

// ─── the providers ──────────────────────────────────────────────────────────

/**
 * The subscription each provider is handed, in the two states that decide its
 * branch. A live trial expires WITH its trial; a paid one runs to its period end.
 */
function subscriptionInState(trialing) {
  const trialEndUNIX = nowUNIX + (7 * DAY);

  return {
    product: { id: 'premium', name: 'Premium' },
    status: 'active',
    cancellation: { pending: false },
    expires: at(trialing ? trialEndUNIX : nowUNIX + (30 * DAY)),
    trial: trialing
      ? { claimed: true, expires: at(trialEndUNIX) }
      : { claimed: false },
    payment: { resourceId: 'sub_test_immediacy', startDate: at(nowUNIX - (60 * DAY)) },
  };
}

// A ctx that records the log line, which is how each provider names the cancel
// it performed. Everything else the providers touch is the REAL ctx — the
// recorder delegates to it (rather than copying it, which would drop every
// method the providers call, `isProduction()` and `Manager` among them).
function recordingCtx(ctx) {
  const logs = [];
  const recorder = Object.create(ctx);

  recorder.log = (message) => logs.push(message);

  return { ctx: recorder, logs };
}

/** Run fn with a library method replaced by a stand-in, restored afterwards. */
async function withStub(library, method, replacement, fn) {
  const real = library[method];

  library[method] = replacement;

  try {
    return await fn();
  } finally {
    library[method] = real;
  }
}

/** Cancel through a provider, in the trialing or the paid state. */
async function cancelVia(provider, { trialing, ctx }) {
  const recorder = recordingCtx(ctx);

  await provider.cancelAtPeriodEnd({
    resourceId: 'sub_test_immediacy',
    uid: '_test-cancel-immediacy',
    subscription: subscriptionInState(trialing),
    ctx: recorder.ctx,
  });

  return recorder.logs;
}

module.exports = {
  description: 'Payment cancel endpoint: a trial cancels immediately',
  type: 'group',
  timeout: 15000,

  tests: [
    // ─── the route ───

    {
      name: 'a-trial-cancel-is-not-blocked-by-the-24-hour-guard',
      auth: 'none',
      async run({ assert, Manager }) {
        const user = youngSubscriber(Manager, { uid: '_test-cancel-trialing-young', trialing: true });

        const sent = await cancelInProduction(Manager, user);

        assert.equal(sent.code, 400, `Expected the request to reach the provider lookup, got ${sent.code}: ${sent.body}`);
        assert.ok(
          !/still being set up/i.test(`${sent.body}`),
          `A trial must never be told it is still being set up, got: ${sent.body}`,
        );
        assert.match(`${sent.body}`, /Unknown provider/i, 'The trial cancel should get PAST the age guard');
      },
    },

    {
      name: 'a-paid-cancel-that-young-is-still-guarded',
      auth: 'none',
      async run({ assert, Manager }) {
        // The other half of the ruling: paid cancels keep today's behavior
        // exactly. Same age, same everything — only the trial differs.
        const user = youngSubscriber(Manager, { uid: '_test-cancel-paid-young', trialing: false });

        const sent = await cancelInProduction(Manager, user);

        assert.equal(sent.code, 400, `A young PAID subscription must still be guarded, got ${sent.code}: ${sent.body}`);
        assert.match(`${sent.body}`, /still being set up/i, 'The age guard should be the rejection for a paid subscription');
      },
    },

    // ─── the classifier ───

    {
      name: 'classifies-a-live-trial-as-trialing',
      auth: 'none',
      async run({ assert }) {
        const trialEnd = nowUNIX + (14 * DAY);

        assert.equal(isTrialing({
          status: 'active',
          trial: { claimed: true, expires: at(trialEnd) },
          expires: at(trialEnd),
        }), true, 'A live trial expires exactly when its trial does');
      },
    },

    {
      name: 'classifies-a-converted-trial-as-paid',
      auth: 'none',
      async run({ assert }) {
        // Conversion moves `expires` out to the end of the first paid period
        // while `trial.expires` stays put — that gap IS the conversion.
        assert.equal(isTrialing({
          status: 'active',
          trial: { claimed: true, expires: at(nowUNIX - DAY) },
          expires: at(nowUNIX + (30 * DAY)),
        }), false, 'A converted trial is a paid subscription and cancels at period end');
      },
    },

    {
      name: 'classifies-a-subscription-that-never-trialed-as-paid',
      auth: 'none',
      async run({ assert }) {
        assert.equal(isTrialing({
          status: 'active',
          trial: { claimed: false },
          expires: at(nowUNIX + (30 * DAY)),
        }), false, 'No trial claimed, no immediate cancel');
      },
    },

    {
      name: 'classifies-a-suspended-trial-as-not-trialing',
      auth: 'none',
      async run({ assert }) {
        // A suspended subscription is already out of the live path; the route
        // handles it through the force-cancel branch instead.
        const trialEnd = nowUNIX + (14 * DAY);

        assert.equal(isTrialing({
          status: 'suspended',
          trial: { claimed: true, expires: at(trialEnd) },
          expires: at(trialEnd),
        }), false, 'Only a live subscription can be in its trial');
      },
    },

    {
      name: 'classifies-an-expired-but-unswept-trial-as-trialing',
      auth: 'none',
      async run({ assert }) {
        // The lapse sweep has not run yet. Nothing was ever paid, so there is
        // no period to let ride — this still cancels now.
        const trialEnd = nowUNIX - DAY;

        assert.equal(isTrialing({
          status: 'active',
          trial: { claimed: true, expires: at(trialEnd) },
          expires: at(trialEnd),
        }), true, 'An unswept expired trial has no paid period to serve out');
      },
    },

    {
      name: 'a-missing-expiry-never-reads-as-trialing',
      auth: 'none',
      async run({ assert }) {
        // The three copies this was folded out of compared the two timestamps
        // directly, so a subscription carrying NEITHER matched itself on
        // `undefined`. That answer now waives a guard, and a guard must never
        // be waived by absent data.
        assert.equal(isTrialing({
          status: 'active',
          trial: { claimed: true },
        }), false, 'No expiry on either side is not a trial');

        assert.equal(isTrialing({}), false, 'An empty subscription is not a trial');
        assert.equal(isTrialing(null), false, 'No subscription at all is not a trial');
      },
    },

    // ─── the providers ───

    {
      name: 'stripe-cancels-a-trial-now-and-a-paid-subscription-at-period-end',
      auth: 'none',
      async run({ assert, ctx }) {
        const calls = [];
        const sdk = {
          subscriptions: {
            cancel: async (id) => { calls.push({ verb: 'cancel', id }); return {}; },
            update: async (id, params) => { calls.push({ verb: 'update', id, params }); return {}; },
          },
        };

        const trialLogs = await withStub(StripeLib, 'init', () => sdk, () => cancelVia(stripeCancel, { trialing: true, ctx }));

        assert.deepEqual(
          calls,
          [{ verb: 'cancel', id: 'sub_test_immediacy' }],
          'A trial must reach subscriptions.cancel — cancel_at_period_end would serve the trial out',
        );
        assert.match(trialLogs.join('\n'), /immediate \(trialing\)/, 'and the log names the cancel it performed');

        calls.length = 0;
        const paidLogs = await withStub(StripeLib, 'init', () => sdk, () => cancelVia(stripeCancel, { trialing: false, ctx }));

        assert.equal(calls.length, 1, 'A paid cancel is one call too');
        assert.equal(calls[0].verb, 'update', 'A paid subscription is scheduled, never cancelled outright');
        assert.deepEqual(calls[0].params, { cancel_at_period_end: true }, 'with the period-end flag');
        assert.match(paidLogs.join('\n'), /at period end/, 'and the log says so');
      },
    },

    {
      name: 'chargebee-cancels-a-trial-immediately-and-a-paid-subscription-at-end-of-term',
      auth: 'none',
      async run({ assert, ctx }) {
        const calls = [];
        const request = async (path, options) => { calls.push({ path, options }); return {}; };

        const trialLogs = await withStub(ChargebeeLib, 'init', () => ({}), () => (
          withStub(ChargebeeLib, 'request', request, () => cancelVia(chargebeeCancel, { trialing: true, ctx }))
        ));

        assert.equal(calls.length, 1, 'One cancel call');
        assert.equal(calls[0].path, '/subscriptions/sub_test_immediacy/cancel_for_items', 'Chargebee\'s cancel endpoint');
        assert.equal(calls[0].options.body.cancel_option, 'immediately', 'A trial takes the immediate path');
        assert.match(trialLogs.join('\n'), /immediate \(trialing\)/, 'and the log names it');

        calls.length = 0;
        const paidLogs = await withStub(ChargebeeLib, 'init', () => ({}), () => (
          withStub(ChargebeeLib, 'request', request, () => cancelVia(chargebeeCancel, { trialing: false, ctx }))
        ));

        assert.equal(calls[0].options.body.cancel_option, 'end_of_term', 'A paid subscription runs to the end of its term');
        assert.match(paidLogs.join('\n'), /at period end/, 'and the log says so');
      },
    },

    {
      name: 'paypal-cancels-through-the-one-endpoint-and-names-the-trial',
      auth: 'none',
      async run({ assert, ctx }) {
        // PayPal exposes no second cancel mode, so the CALL is the same one in
        // both states — what differs is the reason it carries and the log it
        // writes. The immediacy itself lives in the unified transform, pinned in
        // helpers/payment/paypal/to-unified-subscription.test.js.
        const calls = [];
        const request = async (path, options) => { calls.push({ path, body: JSON.parse(options.body) }); return {}; };

        const trialLogs = await withStub(PayPalLib, 'request', request, () => cancelVia(paypalCancel, { trialing: true, ctx }));

        assert.equal(calls.length, 1, 'One cancel call');
        assert.equal(calls[0].path, '/v1/billing/subscriptions/sub_test_immediacy/cancel', 'PayPal\'s cancel endpoint');
        assert.match(calls[0].body.reason, /free trial/i, 'The reason PayPal records says this was a trial cancel');
        assert.match(trialLogs.join('\n'), /immediate \(trialing\)/, 'and our log names it');

        calls.length = 0;
        const paidLogs = await withStub(PayPalLib, 'request', request, () => cancelVia(paypalCancel, { trialing: false, ctx }));

        assert.equal(calls[0].path, '/v1/billing/subscriptions/sub_test_immediacy/cancel', 'The same endpoint — PayPal has only the one');
        assert.match(calls[0].body.reason, /requested cancellation/i, 'with the ordinary reason');
        assert.match(paidLogs.join('\n'), /at period end/, 'and the log says which cancel this was');
      },
    },

    {
      name: 'the-test-provider-fabricates-the-immediate-cancel-event',
      auth: 'none',
      async run({ assert, ctx, firestore }) {
        // The test provider's "provider" is Firestore, so this one runs for
        // real: the webhook doc it writes IS the cancel, and the pipeline folds
        // it exactly as a Stripe delivery.
        const trialLogs = await cancelVia(testCancel, { trialing: true, ctx });
        const trialEventId = trialLogs.join('\n').match(/payments-webhooks\/([\w-]+)/)?.[1];

        assert.ok(trialEventId, `The provider should name the event it wrote, got: ${trialLogs.join('\n')}`);

        const trialEvent = await firestore.get(`payments-webhooks/${trialEventId}`);
        const trialSubscription = trialEvent.raw.data.object;

        assert.equal(trialEvent.raw.type, 'customer.subscription.deleted', 'A trial cancel is the DELETED event — the subscription ends now');
        assert.equal(trialSubscription.status, 'canceled', 'with the subscription already cancelled');
        assert.equal(trialSubscription.cancel_at_period_end, false, 'and nothing scheduled for later');
        assert.ok(trialSubscription.current_period_end <= Math.floor(Date.now() / 1000), 'the period ends now, not in a month');

        const paidLogs = await cancelVia(testCancel, { trialing: false, ctx });
        const paidEventId = paidLogs.join('\n').match(/payments-webhooks\/([\w-]+)/)?.[1];
        const paidEvent = await firestore.get(`payments-webhooks/${paidEventId}`);
        const paidSubscription = paidEvent.raw.data.object;

        assert.equal(paidEvent.raw.type, 'customer.subscription.updated', 'A paid cancel is the UPDATED event');
        assert.equal(paidSubscription.status, 'active', 'the subscription is still live');
        assert.equal(paidSubscription.cancel_at_period_end, true, 'with the cancellation scheduled at its period end');
      },
    },
  ],
};
