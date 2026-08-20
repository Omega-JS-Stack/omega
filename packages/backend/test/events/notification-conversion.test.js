/**
 * Test: the notification subscribe/unsubscribe events are CANONICAL conversions
 * ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)).
 *
 * The handler used to reach `Manager.Analytics(...).event()` directly with
 * hyphenated names of its own invention — `notification-subscribe` and
 * `notification-unsubscribe`, which appear in no catalog and therefore in no
 * other surface's vocabulary. Both now go through `deliverConversion`, which is
 * what gives them the three things the raw call had none of: the catalog's
 * name, the consent gate, and the per-provider walk (GA4 only, by catalog
 * design — no ad platform maps a push subscription).
 *
 * THE DEDUPE ID IS `<event>.<token>`. The doc id IS the push token, and it is
 * the only stable key this doc has: `owner` is null on an anonymous subscribe,
 * so a uid-derived id would collapse every anonymous device onto one id.
 *
 * Real handler, real Manager, real ctx, real Firestore counter write. The
 * `change` pair is built by hand — the trigger's own shape — so no notification
 * doc has to exist for the branch under test.
 *
 * Run: npx omega test framework:events/notification-conversion
 */
const onWrite = require('../../src/manager/events/firestore/notifications/on-write.js');

const TOKEN = '_test-notification-conversion-token';

const EVENT_CONTEXT = {
  resource: { service: 'firestore.googleapis.com' },
  params: { token: TOKEN },
};

// A subscription doc in the shape the client writes it.
function subscriptionDoc({ owner = null, attribution } = {}) {
  return {
    token: TOKEN,
    owner: owner,
    tags: ['general'],
    attribution: attribution,
    context: { client: {} },
  };
}

/** The Change pair the Firestore trigger hands the handler. */
function change({ before, after }) {
  return {
    before: { data: () => before },
    after: { data: () => after },
  };
}

// Record every console call the handler makes, restoring console afterward.
async function withConsoleRecorder(fn) {
  const calls = { log: [], debug: [], error: [] };
  const original = { log: console.log, debug: console.debug, error: console.error };

  console.log = (...args) => calls.log.push(args);
  console.debug = (...args) => calls.debug.push(args);
  console.error = (...args) => calls.error.push(args);

  try {
    await fn();
    return calls;
  } finally {
    console.log = original.log;
    console.debug = original.debug;
    console.error = original.error;
  }
}

/** Run the real handler for one change pair; hand back its delivery lines. */
async function runHandler({ Manager, before, after }) {
  const ctx = Manager.RouteContext({}, { functionName: 'omega_notificationsOnWrite' });
  const admin = Manager.libraries.admin;

  const calls = await withConsoleRecorder(async () => {
    await onWrite({
      Manager: Manager,
      ctx: ctx,
      change: change({ before: before, after: after }),
      context: EVENT_CONTEXT,
      libraries: { admin: admin },
    });
  });

  const delivery = calls.log
    .map((args) => String(args[1]))
    .filter((line) => line.startsWith('deliverConversion: '));

  return { calls: calls, delivery: delivery };
}

module.exports = {
  description: 'notifications:on-write fires canonical notification conversions',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-new-subscription-fires-the-canonical-notification-subscribe',
      async run({ assert, Manager }) {
        const { delivery } = await runHandler({
          Manager: Manager,
          before: undefined,
          after: subscriptionDoc({ owner: '_test-notification-owner' }),
        });

        assert.equal(delivery.length, 1, `expected one conversion delivery, got ${delivery.length}: ${delivery.join(' | ')}`);
        assert.equal(delivery[0].startsWith('deliverConversion: notification_subscribe →'), true, `the canonical catalog name, not the hyphenated invention: ${delivery[0]}`);
        assert.equal(delivery[0].includes(`(event_id=notification_subscribe.${TOKEN})`), true, `the token is the stable per-doc key: ${delivery[0]}`);

        // GA4 only — no ad platform maps a push subscription, and an unmapped
        // provider is a decision the catalog makes, not an event to invent.
        for (const provider of ['meta', 'tiktok']) {
          assert.equal(delivery[0].includes(`${provider} skipped (no mapping)`), true, `${provider} has no mapping for this event: ${delivery[0]}`);
        }
      },
    },

    {
      name: 'a-deleted-subscription-fires-the-canonical-notification-unsubscribe',
      async run({ assert, Manager }) {
        const { delivery } = await runHandler({
          Manager: Manager,
          before: subscriptionDoc({ owner: '_test-notification-owner' }),
          after: undefined,
        });

        assert.equal(delivery.length, 1, `expected one conversion delivery, got ${delivery.length}: ${delivery.join(' | ')}`);
        assert.equal(delivery[0].startsWith('deliverConversion: notification_unsubscribe →'), true, `the canonical catalog name: ${delivery[0]}`);
        assert.equal(delivery[0].includes(`(event_id=notification_unsubscribe.${TOKEN})`), true, `the token keys the unsubscribe too: ${delivery[0]}`);
      },
    },

    {
      name: 'an-update-fires-nothing',
      async run({ assert, Manager }) {
        // Re-tagging a device is not a subscription event. The handler returns
        // at its update branch, before any tracking.
        const { delivery } = await runHandler({
          Manager: Manager,
          before: subscriptionDoc(),
          after: subscriptionDoc({ owner: '_test-notification-owner' }),
        });

        assert.equal(delivery.length, 0, `an update must fire no conversion: ${delivery.join(' | ')}`);
      },
    },

    {
      name: 'an-anonymous-subscribe-still-fires-and-still-keys-on-the-token',
      async run({ assert, Manager }) {
        // `owner: null` is the anonymous-subscribe shape the rules explicitly
        // allow. There is no uid to key on and no identity to match — which is
        // exactly why the doc id is the id.
        const { delivery } = await runHandler({
          Manager: Manager,
          before: undefined,
          after: subscriptionDoc({ owner: null }),
        });

        assert.equal(delivery.length, 1, `an anonymous device is still a subscription: ${delivery.join(' | ')}`);
        assert.equal(delivery[0].includes(`(event_id=notification_subscribe.${TOKEN})`), true, delivery[0]);
      },
    },

    {
      name: 'a-declined-analytics-snapshot-blocks-the-fire',
      async run({ assert, Manager }) {
        // The gate is the whole point of routing through deliverConversion: a
        // raw Manager.Analytics call asked nobody anything.
        const doc = subscriptionDoc({ owner: '_test-notification-owner' });
        doc.trackingConsent = { analytics: false, marketing: false, region: 'opt-in', version: 1 };

        const { delivery } = await runHandler({ Manager: Manager, before: undefined, after: doc });

        assert.equal(delivery.length, 1, delivery.join(' | '));
        assert.equal(delivery[0].includes('ga4 skipped (consent: analytics)'), true, `an opted-out device reaches no platform: ${delivery[0]}`);
      },
    },
  ],
};
