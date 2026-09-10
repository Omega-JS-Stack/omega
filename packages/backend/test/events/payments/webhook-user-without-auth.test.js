/**
 * Test: a webhook for a uid with no auth user never creates a user doc
 *
 * A local QA checkout runs against the emulator with real test-mode keys, and the
 * provider delivers the resulting webhooks to the DEPLOYED backend (the emulator
 * has no webhook path). `customer.subscription.created` then resolved an
 * emulator-only uid and minted a LIVE users/{uid} carrying nothing but a
 * subscription block — an orphan the users migration later had to clean up
 * ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)).
 *
 * The pipeline now refuses to CREATE a user doc for a uid this project has no auth
 * user for, and stamps the refusal on the event's own doc. A uid that HAS an auth
 * user is untouched by the guard, which the last case pins.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js), whose
 * auth store is exactly the list of uids that exist.
 *
 * Run: npm test -- backend:events/payments/webhook-user-without-auth
 */
const assert = require('node:assert');
const { runTrigger } = require('./_webhook-harness.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-journey-flows-upgrade';
const ORDER_ID = '2403-2403-2403';
const RESOURCE_ID = '_test-orphan-subscription';
const EVENT_ID = '_test-orphan-uid-evt';

/** The subscription event this suite is about, with only the starting state left to choose */
function runSubscriptionCreated({ authUids, seed = {}, reporting = true }) {
  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    eventType: 'customer.subscription.created',
    authUids: authUids,
    seed: seed,
    reporting: reporting,
  });
}

/** The user doc of a subscriber who already exists — what an UPDATE lands on */
function existingUser() {
  return {
    auth: { uid: UID, email: `${UID}@example.com` },
    roles: {},
    subscription: { product: { id: 'basic', name: 'Basic' }, status: 'cancelled' },
  };
}

module.exports = defineCases({
  description: 'A payment webhook never creates a user doc for a uid with no auth user',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a uid with no auth user gets NO user doc, and no order or intent behind it',

      async run() {
        const { store } = await runSubscriptionCreated({ authUids: [] });

        assert.ok(!store.get(`users/${UID}`), 'a payment event must never mint a user doc');
        assert.ok(!store.get(`payments-orders/${ORDER_ID}`), 'the event was refused, so nothing else is written either');
        assert.ok(!store.get(`payments-intents/${ORDER_ID}`), 'no intent is closed out for a refused event');
      },
    },

    {
      name: 'the refusal is stamped on the event doc and the event is not retryable',

      async run() {
        const { store } = await runSubscriptionCreated({ authUids: [] });
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        assert.equal(event.refusal?.reason, 'user-without-auth', 'the stamp names what is wrong');
        assert.equal(event.status, 'completed', 'the event reached a decision — the provider must not redeliver it forever');
        assert.equal(event.transition, null, 'nothing happened to a subscription, so the trail must not say it did');
        assert.equal(event.owner, UID, 'the uid it resolved to stays on the record');
      },
    },

    {
      name: 'the refusal is loud and names the uid and the event',

      async run() {
        const { logs } = await runSubscriptionCreated({ authUids: [] });
        const output = logs.join('\n');

        assert.match(output, /USER WITHOUT AUTH/, 'the refusal is loud');
        assert.match(output, new RegExp(`uid=${UID}`), 'the warning names the uid');
        assert.match(output, new RegExp(`event=${EVENT_ID}`), 'the warning names the event');
      },
    },

    {
      name: 'the refusal reports a warning carrying the uid, the event and the reason',

      async run() {
        const { captures } = await runSubscriptionCreated({ authUids: [] });

        assert.equal(captures.length, 1, 'the refusal reports exactly once');

        const capture = captures[0];

        assert.equal(capture.level, 'warning', 'a refusal is a warning, not a server fault');
        assert.match(capture.message, /user without auth/i, 'the message says what happened');
        assert.equal(capture.extra.uid, UID, 'the uid is the join key back to the account');
        assert.equal(capture.extra.eventId, EVENT_ID, 'the event is nameable in the provider dashboard');
        assert.equal(capture.extra.reason, 'user-without-auth', 'the refusal reason matches the stamp on the doc');
        assert.equal(capture.user?.id, UID, 'the uid rides as the user id');
        assert.ok(!JSON.stringify(capture).includes('@'), 'no email is ever assembled into the report');
      },
    },

    {
      name: 'with no DSN configured the refusal still lands, reporting nothing',

      async run() {
        // `libraries.sentry` is null whenever no DSN is set — the capture must be a
        // clean no-op, never a second failure on top of the refusal
        const { store, captures } = await runSubscriptionCreated({ authUids: [], reporting: false });

        assert.equal(captures.length, 0, 'nothing is reported when reporting is off');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.refusal?.reason, 'user-without-auth', 'the stamp still lands');
        assert.ok(!store.get(`users/${UID}`), 'and the guard still refuses the write');
      },
    },

    {
      name: 'an EXISTING user doc updates even with no auth user behind it',

      async run() {
        // The guard is about CREATION only. A customer whose auth record was
        // deleted still has a live subscription to keep in step, and refusing here
        // would strand it — so an existing doc is never even looked up in Auth.
        const { store, captures } = await runSubscriptionCreated({ authUids: [], seed: { [`users/${UID}`]: existingUser() } });

        assert.equal(captures.length, 0, 'an ordinary update reports nothing — only the refusal does');
        assert.equal(store.get(`users/${UID}`)?.subscription?.status, 'active', 'the subscription updates exactly as before');
        assert.equal(store.get(`users/${UID}`)?.auth?.email, `${UID}@example.com`, 'the rest of the doc is untouched');
        assert.ok(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'an update is refused nothing');
        assert.equal(store.get(`payments-orders/${ORDER_ID}`)?.owner, UID, 'the order is written as before');
      },
    },

    {
      name: 'a uid WITH an auth user still gets its subscription written',

      async run() {
        const { store } = await runSubscriptionCreated({ authUids: [UID] });

        assert.ok(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'a real customer is refused nothing');
        assert.equal(store.get(`users/${UID}`)?.subscription?.status, 'active', 'the subscription lands on the user doc as before');
        assert.equal(store.get(`payments-orders/${ORDER_ID}`)?.owner, UID, 'the order is written as before');
      },
    },
  ],
});
