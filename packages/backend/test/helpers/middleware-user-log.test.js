/**
 * Test: the user projection the request pipeline logs
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
const redaction = require('../../dist/omega/helpers/log-redaction.js');
const { USER_SCHEMA } = require('../../dist/vendor/account/index.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { projectUserForLog } = redaction;

// The secret the leak was about, plus its sibling under api/.
const PRIVATE_KEY = 'sk_live_275_private_key_value';
const CLIENT_ID = 'e3f1c0de-0000-4000-8000-000000000275';

// A user doc in the shape the middleware reads off ctx.user — the fields
// the projection keeps, the credential it must drop, and enough neighbors to
// prove the allow-list is not just an `api` blocklist.
function userDoc(overrides) {
  return Object.assign({
    auth: { uid: 'uid-275', email: 'user-275@example.com', temporary: false },
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'active',
      payment: { provider: 'stripe', orderId: 'sub_275', resourceId: 'cus_275' },
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

module.exports = defineCases({
  description: 'Pipeline user log projection — no credential reaches a log line',
  type: 'group',

  tests: [
    {
      name: 'the-private-key-never-reaches-the-projection',
      async run({ expect }) {
        const projected = serialize(projectUserForLog(userDoc()));

        expect(projected.includes(PRIVATE_KEY), `api.privateKey leaked into the log line: ${projected}`).toBe(false);
        expect(projected.includes(CLIENT_ID), `api.clientId leaked into the log line: ${projected}`).toBe(false);
        expect(projected.includes('privateKey'), `the api key field survived: ${projected}`).toBe(false);
      },
    },

    {
      name: 'the-projection-is-id-plan-and-roles',
      async run({ expect }) {
        const projection = projectUserForLog(userDoc());

        expect(Object.keys(projection).sort(), serialize(projection)).toEqual(['id', 'plan', 'roles']);
        expect(projection.id).toBe('uid-275');
        expect(projection.plan).toEqual({ id: 'premium', status: 'active' });
        expect(projection.roles).toEqual(['betaTester']);
      },
    },

    {
      name: 'roles-carry-names-only-never-values',
      async run({ expect }) {
        // `roles` is a $passthrough group, so a consumer can hang anything off
        // it — including something secret-shaped. Only the names of enabled
        // roles are emitted, so a value can never ride along.
        const projection = projectUserForLog(userDoc({
          roles: { admin: true, betaTester: false, internalToken: 'tok_275_secret' },
        }));

        expect(projection.roles, serialize(projection.roles)).toEqual(['admin']);
        expect(serialize(projection).includes('tok_275_secret'), serialize(projection)).toBe(false);
      },
    },

    {
      name: 'a-new-secret-shaped-schema-field-cannot-opt-itself-in',
      async run({ expect }) {
        // The allow-list is the guarantee: a field added to the account schema
        // tomorrow is absent from the log line until somebody adds it here on
        // purpose. Proven against the REAL schema's top-level groups.
        const doc = userDoc({ secrets: { webhookSigningKey: 'whsec_275_future_field' } });
        const projected = serialize(projectUserForLog(doc));

        expect(projected.includes('whsec_275_future_field'), projected).toBe(false);

        for (const group of Object.keys(USER_SCHEMA)) {
          if (group === 'auth' || group === 'subscription' || group === 'roles') continue;

          expect(projected.includes(`"${group}"`), `schema group "${group}" reached the log line: ${projected}`).toBe(false);
        }
      },
    },

    {
      name: 'an-incomplete-doc-projects-without-throwing',
      async run({ expect }) {
        // The line logs before any route runs, so it must survive a user the
        // resolver never filled in (an unauthenticated or partial doc).
        expect(projectUserForLog({})).toEqual({ id: null, plan: { id: null, status: null }, roles: [] });
        expect(projectUserForLog(undefined)).toEqual({ id: null, plan: { id: null, status: null }, roles: [] });
      },
    },
  ],
});
