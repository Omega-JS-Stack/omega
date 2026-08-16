/**
 * Test: the user projection Middleware.process() logs
 * ([#275](https://github.com/Omega-JS-Stack/omega/issues/275)).
 *
 * The middleware used to hand its "User (...)" line the ENTIRE user document,
 * which carries `api.privateKey` — a live credential. That put a copy of every
 * caller's key into Cloud Logging on every authenticated request, and log
 * retention keeps it there long after the request is gone. The line now carries
 * a projection built by allow-list: id, plan id/status, roles.
 *
 * Run: npx omega test backend:helpers/middleware-user-log
 *
 * The projection is pure (a doc in, a small object out), so it runs here
 * directly against the REAL account schema's shape — nothing is hand-rolled
 * beyond the document itself. The wiring half is proven by the emulator: every
 * authenticated route suite still round-trips green through this same line.
 */
const Middleware = require('../../src/manager/helpers/middleware.js');
const { USER_SCHEMA } = require('@omega.js/account');

const { projectUserForLog } = Middleware;

// The secret the leak was about, plus its sibling under api/.
const PRIVATE_KEY = 'sk_live_275_private_key_value';
const CLIENT_ID = 'e3f1c0de-0000-4000-8000-000000000275';

// A user doc in the shape the middleware reads off ctx.getUser() — the fields
// the projection keeps, the credential it must drop, and enough neighbors to
// prove the allow-list is not just an `api` blocklist.
function userDoc(overrides) {
  return Object.assign({
    auth: { uid: 'uid-275', email: 'user-275@example.com', temporary: false },
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { processor: 'stripe', orderId: 'sub_275', resourceId: 'cus_275' },
    },
    roles: { admin: false, betaTester: true, developer: false },
    affiliate: { code: 'aff275', referrals: [] },
    api: { clientId: CLIENT_ID, privateKey: PRIVATE_KEY },
  }, overrides);
}

// Everything the projection could possibly emit, as one string — the leak test
// is "does the credential appear anywhere in what gets logged", not "is it on
// the key I remembered to check".
function serialize(value) {
  return JSON.stringify(value);
}

module.exports = {
  description: 'Middleware user log projection — no credential reaches a log line',
  type: 'group',

  tests: [
    {
      name: 'the-private-key-never-reaches-the-projection',
      async run({ assert }) {
        const projected = serialize(projectUserForLog(userDoc()));

        assert.equal(projected.includes(PRIVATE_KEY), false, `api.privateKey leaked into the log line: ${projected}`);
        assert.equal(projected.includes(CLIENT_ID), false, `api.clientId leaked into the log line: ${projected}`);
        assert.equal(projected.includes('privateKey'), false, `the api key field survived: ${projected}`);
      },
    },

    {
      name: 'the-projection-is-id-plan-and-roles',
      async run({ assert }) {
        const projection = projectUserForLog(userDoc());

        assert.deepEqual(Object.keys(projection).sort(), ['id', 'plan', 'roles'], serialize(projection));
        assert.equal(projection.id, 'uid-275');
        assert.deepEqual(projection.plan, { id: 'premium', status: 'active' });
        assert.deepEqual(projection.roles, ['betaTester']);
      },
    },

    {
      name: 'roles-carry-names-only-never-values',
      async run({ assert }) {
        // `roles` is a $passthrough group, so a consumer can hang anything off
        // it — including something secret-shaped. Only the names of enabled
        // roles are emitted, so a value can never ride along.
        const projection = projectUserForLog(userDoc({
          roles: { admin: true, betaTester: false, internalToken: 'tok_275_secret' },
        }));

        assert.deepEqual(projection.roles, ['admin'], serialize(projection.roles));
        assert.equal(serialize(projection).includes('tok_275_secret'), false, serialize(projection));
      },
    },

    {
      name: 'a-new-secret-shaped-schema-field-cannot-opt-itself-in',
      async run({ assert }) {
        // The allow-list is the guarantee: a field added to the account schema
        // tomorrow is absent from the log line until somebody adds it here on
        // purpose. Proven against the REAL schema's top-level groups.
        const doc = userDoc({ secrets: { webhookSigningKey: 'whsec_275_future_field' } });
        const projected = serialize(projectUserForLog(doc));

        assert.equal(projected.includes('whsec_275_future_field'), false, projected);

        for (const group of Object.keys(USER_SCHEMA)) {
          if (group === 'auth' || group === 'subscription' || group === 'roles') continue;

          assert.equal(projected.includes(`"${group}"`), false, `schema group "${group}" reached the log line: ${projected}`);
        }
      },
    },

    {
      name: 'an-incomplete-doc-projects-without-throwing',
      async run({ assert }) {
        // The line logs before any route runs, so it must survive a user the
        // resolver never filled in (an unauthenticated or partial doc).
        assert.deepEqual(projectUserForLog({}), { id: null, plan: { id: null, status: null }, roles: [] });
        assert.deepEqual(projectUserForLog(undefined), { id: null, plan: { id: null, status: null }, roles: [] });
      },
    },
  ],
};
