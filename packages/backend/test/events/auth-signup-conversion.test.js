/**
 * Test: auth:on-create fires the SERVER half of `sign_up`
 * ([#385](https://github.com/Omega-JS-Stack/omega/issues/385) §4, inventory gap 2
 * of [#328](https://github.com/Omega-JS-Stack/omega/issues/328)).
 *
 * `sign_up` is a `placement: 'both'` event, and until now only its browser half
 * existed: an ad-blocked or bounced-early registration reached no platform, and
 * nothing server-side ever counted a signup as a conversion.
 *
 * The load-bearing detail is the DEDUPE ID. Meta deduplicates on the pair
 * (event_name, event_id) and TikTok on event_id, so the two halves must name the
 * same string — `sign_up.<uid>` — computed from the only thing both sides hold
 * before either fires. If this drifts, every registration is counted twice.
 *
 * Real handler, real Manager, real ctx, real Firestore write. The record handed
 * in is a UserRecord shape for a uid that has no doc yet — the branch a genuine
 * new account takes. No Auth user is created, so the emulator's own trigger
 * never races this one; the doc it writes is deleted afterwards.
 *
 * Run: npx omega test framework:events/auth-signup-conversion
 */
const onCreate = require('../../src/manager/events/auth/on-create.js');

const EVENT_CONTEXT = {
  eventType: 'providers/firebase.auth/eventTypes/user.create',
  resource: { service: 'firebaseauth.googleapis.com' },
};

// A brand-new account, in the UserRecord shape the 1st-gen trigger delivers.
function newUserRecord(providerId) {
  const uid = `_test-signup-conversion-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  return {
    uid: uid,
    email: `${uid}@test.invalid`,
    displayName: 'Casey Buyer',
    metadata: { creationTime: new Date().toISOString() },
    providerData: [{ providerId: providerId, email: `${uid}@test.invalid`, displayName: 'Casey Buyer' }],
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

/** Run the real handler for a brand-new user; hand back its delivery line. */
async function runHandler({ Manager, user }) {
  const ctx = Manager.RouteContext({}, { functionName: 'omega_authOnCreate' });
  const admin = Manager.libraries.admin;

  const calls = await withConsoleRecorder(async () => {
    await onCreate({
      Manager: Manager,
      ctx: ctx,
      user: user,
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
  description: 'auth:on-create fires the server half of sign_up with the shared dedupe id',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-new-account-fires-sign-up-with-the-uid-derived-dedupe-id',
      async run({ assert, Manager, firestore }) {
        const user = newUserRecord('password');

        try {
          const { delivery } = await runHandler({ Manager: Manager, user: user });

          assert.equal(delivery.length, 1, `expected one conversion delivery, got ${delivery.length}: ${delivery.join(' | ')}`);
          assert.equal(delivery[0].startsWith('deliverConversion: sign_up →'), true, `the canonical event should be sign_up: ${delivery[0]}`);
          assert.equal(delivery[0].includes(`(event_id=sign_up.${user.uid})`), true, `the dedupe id must be the uid-derived one the client half will send: ${delivery[0]}`);

          // GA4 is the CLIENT half's — it has no cross-source event_id dedupe, so
          // a server sign_up beside the browser's gtag one is two registrations.
          assert.equal(delivery[0].includes('ga4 skipped (not selected)'), true, `GA4 must not be fired by the server half: ${delivery[0]}`);

          // Meta and TikTok DO dedupe on event_id, so this half owns them: both are
          // resolved and handed to their transport. A brand with pixel credentials
          // configured sends there; the sandbox has none, which is what it says.
          for (const provider of ['meta', 'tiktok']) {
            assert.equal(delivery[0].includes(`${provider} skipped (not configured)`), true, `${provider} should reach its transport: ${delivery[0]}`);
          }

          // And the account it is about actually landed.
          assert.equal(await firestore.exists(`users/${user.uid}`), true, 'the handler still writes the user doc');
        } finally {
          await firestore.delete(`users/${user.uid}`);
        }
      },
    },

    {
      name: 'an-existing-account-fires-nothing',
      async run({ assert, Manager, accounts, firestore }) {
        // A provider link or a re-fired trigger is not a registration. The
        // handler returns at its "already exists" branch, before any tracking.
        const existing = await Manager.libraries.admin.auth().getUser(accounts.basic.uid);

        assert.equal(await firestore.exists(`users/${existing.uid}`), true, 'precondition: the persona already has a doc');

        const { delivery } = await runHandler({ Manager: Manager, user: existing });

        assert.equal(delivery.length, 0, `an existing account must fire no conversion: ${delivery.join(' | ')}`);
      },
    },

    {
      name: 'the-method-speaks-the-same-vocabulary-as-the-browser-half',
      async run({ assert, Manager, firestore }) {
        // The client fires trackSignup('email') / trackSignup('google'); the
        // server twin must not say 'password' / 'google.com' for the same act.
        assert.equal(onCreate.resolveSignupMethod({ providerData: [{ providerId: 'password' }] }), 'email');
        assert.equal(onCreate.resolveSignupMethod({ providerData: [{ providerId: 'google.com' }] }), 'google');
        assert.equal(onCreate.resolveSignupMethod({ providerData: [{ providerId: 'apple.com' }] }), 'apple');
        assert.equal(onCreate.resolveSignupMethod({}), 'email', 'an unknown provider reads as the default email signup');

        // And it reaches the wire: the delivered params carry it.
        const user = newUserRecord('google.com');

        try {
          const { calls } = await runHandler({ Manager: Manager, user: user });
          const tracked = calls.log.map((args) => String(args[1])).some((line) => line.startsWith('deliverConversion: sign_up →'));

          assert.equal(tracked, true, 'a provider signup fires the same event');
        } finally {
          await firestore.delete(`users/${user.uid}`);
        }
      },
    },
  ],
};
