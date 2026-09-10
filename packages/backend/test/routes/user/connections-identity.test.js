/**
 * Test: routes/user/connections — the ROUTE owns identity uniqueness
 * ([#793](https://github.com/Omega-JS-Stack/omega/issues/793),
 * [#791](https://github.com/Omega-JS-Stack/omega/issues/791)).
 *
 * Run (from the framework repo): npm test routes/user/connections-identity
 *
 * The "this account is already connected" guard used to be copied into every
 * provider, and every copy matched the CONNECTING user's own document too: a
 * user reconnecting — to widen a scope, or after a failed refresh left the
 * record behind — was told their own account belonged to somebody else. The
 * check lives in `tokenize` now, it runs ONE query, and it refuses only a
 * document that is not the connecting user's.
 *
 * What it also pins: an `identity()` that answers no string `id` is a
 * PROGRAMMER error (it throws naming the file, never a 400 the user could act
 * on), Google matches on `sub` rather than the email an account can change,
 * and every packaged provider satisfies the shape the lane asserts at load.
 *
 * Everything is offline: the routes are called directly with a hand-rolled ctx
 * and a recording Firestore stand-in, and the fixture provider overrides every
 * step that would leave the machine.
 */

const path = require('path');
const jetpack = require('fs-jetpack');

const postRoute = require('../../../dist/manager/routes/user/connections/post.js');
const { encryptState } = require('../../../dist/manager/routes/user/connections/_state.js');
const { assertProviderShape } = require('../../../dist/manager/routes/user/connections/_providers.js');
const google = require('../../../dist/manager/routes/user/connections/providers/google.js');
const discord = require('../../../dist/manager/routes/user/connections/providers/discord.js');
const spotify = require('../../../dist/manager/routes/user/connections/providers/spotify.js');
const twitch = require('../../../dist/manager/routes/user/connections/providers/twitch.js');
const kick = require('../../../dist/manager/routes/user/connections/providers/kick.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const PROVIDER_ID = 'identity-fixture-793';
const OWNER_UID = 'owner-793';
const OTHER_UID = 'stranger-793';
const IDENTITY_ID = 'provider-account-793';

/** The fixture provider: every network step is an override, `identity` included. */
function providerSource({ identity = `{ id: '${IDENTITY_ID}', name: 'Fixture User' }` } = {}) {
  return [
    'module.exports = {',
    `  provider: '${PROVIDER_ID}',`,
    "  name: 'Identity Fixture',",
    "  urls: { authorize: 'https://provider.test/a', token: 'https://provider.test/t' },",
    "  async exchange() { return { access_token: 'access-793', refresh_token: 'refresh-793', token_type: 'Bearer', expires_in: 3600, scope: 'identify' }; },",
    `  async identity() { return ${identity}; },`,
    '};',
  ].join('\n');
}

/**
 * A Firestore stand-in: documents by path, a recorded `where` query over
 * `users`, and every write kept.
 */
function recordingFirestore({ docs = {}, matches = [] } = {}) {
  const writes = [];
  const queries = [];

  const firestore = {
    doc: (docPath) => ({
      path: docPath,
      get: async () => ({ exists: !!docs[docPath], data: () => docs[docPath] }),
      update: async (payload) => writes.push({ verb: 'update', path: docPath, payload }),
      set: async (payload) => writes.push({ verb: 'set', path: docPath, payload }),
    }),
    collection: (name) => ({
      where: (field, operator, value) => {
        queries.push({ collection: name, field, operator, value });

        return { get: async () => ({ docs: matches, size: matches.length }) };
      },
    }),
  };

  return { admin: { firestore: () => firestore }, writes, queries };
}

/** The lane, wired: a brand provider dir, a recording Firestore, and a ctx. */
function lane({ source = providerSource(), matches = [] } = {}) {
  const cwd = jetpack.tmpDir({ prefix: 'omega-connections-793' }).path();

  jetpack.write(path.join(cwd, 'connections', `${PROVIDER_ID}.js`), source);

  const { admin, writes, queries } = recordingFirestore({
    docs: { [`usage/${OWNER_UID}`]: { connections: { [PROVIDER_ID]: { csrf: 'csrf-793', verifier: null, createdAt: Date.now() } } } },
    matches,
  });

  const Manager = {
    cwd,
    libraries: { admin },
    project: { websiteUrl: 'https://brand.test' },
    config: { brand: { name: 'Test Brand' } },
    Metadata: () => ({ set: () => ({}) }),
  };

  const responses = [];

  const ctx = {
    Manager,
    log() {},
    respond: (message, options) => {
      responses.push({ message, options: options || {} });
      return { message, options: options || {} };
    },
    meta: { startTime: { timestamp: 'now', timestampUNIX: 1 } },
  };

  return { ctx, writes, queries, responses };
}

/** One tokenize leg against the fixture provider. */
async function tokenize(options) {
  const wired = lane(options);

  const encryptedState = encryptState({ provider: PROVIDER_ID, uid: OWNER_UID, csrf: 'csrf-793', ts: Date.now() });

  const thrown = await postRoute({
    ctx: wired.ctx,
    user: {},
    settings: { action: 'tokenize', code: 'auth-code-793', encryptedState },
  }).catch((e) => e);

  return { ...wired, thrown, answer: wired.responses[wired.responses.length - 1] || {} };
}

/** A matched user document, as a query snapshot carries it. */
function matchedDoc(uid) {
  return { id: uid, data: () => ({ connections: { [PROVIDER_ID]: { identity: { id: IDENTITY_ID } } } }) };
}

/** A JWT with the given payload — Google's id_token, as jwt-decode reads it. */
function idToken(payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

  return `${part({ alg: 'RS256' })}.${part(payload)}.signature`;
}

module.exports = defineCases({
  description: 'Connections: the route owns identity uniqueness',
  type: 'group',

  tests: [
    {
      // #791: the copies in the providers matched the caller's OWN document, so
      // this — the ordinary "connect again" — was refused as somebody else's
      name: 'reconnecting-your-own-account-passes',

      async run({ assert }) {
        const run = await tokenize({ matches: [matchedDoc(OWNER_UID)] });

        assert.equal(run.answer.options.code, undefined, `a user reconnecting is not a conflict: ${run.answer.message}`);
        assert.equal(run.answer.message.success, true, 'the exchange completes');

        const stored = run.writes.find((write) => write.path === `users/${OWNER_UID}` && write.verb === 'set');

        assert.ok(stored, 'and the record is written');
        assert.equal(stored.payload.connections[PROVIDER_ID].identity.id, IDENTITY_ID, 'with the identity the provider answered');
      },
    },

    {
      name: 'the-query-is-one-lookup-on-the-identity-id',

      async run({ assert }) {
        const run = await tokenize({ matches: [] });

        assert.equal(run.queries.length, 1, `ONE query, whatever the answer: ${JSON.stringify(run.queries)}`);
        assert.deepEqual(run.queries[0], {
          collection: 'users',
          field: `connections.${PROVIDER_ID}.identity.id`,
          operator: '==',
          value: IDENTITY_ID,
        }, 'on the stored identity id, per provider');
      },
    },

    {
      name: 'another-users-account-is-refused-with-400',

      async run({ assert }) {
        const run = await tokenize({ matches: [matchedDoc(OTHER_UID)] });

        assert.equal(run.answer.options.code, 400, `a connection somebody else holds is refused: ${run.answer.message}`);
        assert.match(run.answer.message, /Identity Fixture/, "naming the provider by its human name");
        assert.match(run.answer.message, /Test Brand/, 'and the brand it is already connected to');
        assert.equal(run.writes.some((write) => write.path.startsWith('users/')), false, 'and nothing is written to any user');
      },
    },

    {
      // Not a 400: a caller cannot fix this, and a connection the lane cannot
      // match would silently let two accounts hold one identity
      name: 'an-identity-with-no-string-id-throws-naming-the-provider-file',

      async run({ assert }) {
        const run = await tokenize({ source: providerSource({ identity: "{ name: 'No Id' }" }) });

        assert.ok(run.thrown instanceof Error, 'a provider that answers no id is a programmer error, not a refusal');
        assert.match(run.thrown.message, new RegExp(`${PROVIDER_ID}\\.js`), `the message names the file: ${run.thrown.message}`);
        assert.match(run.thrown.message, /id/, 'and the field it is missing');
        assert.equal(run.writes.some((write) => write.path.startsWith('users/')), false, 'nothing was stored');

        const numeric = await tokenize({ source: providerSource({ identity: '{ id: 12345 }' }) });

        assert.ok(numeric.thrown instanceof Error, 'a number is not an id either — the query would never match one');
      },
    },

    {
      // #793: an email changes hands, a `sub` does not
      name: 'google-answers-its-id-from-sub',

      async run({ assert }) {
        const identity = await google.identity({
          ctx: { log() {} },
          uid: OWNER_UID,
          token: { access_token: 'access-793', id_token: idToken({ sub: '110000000000000000001', email: 'buyer@example.com', name: 'Ian' }) },
        });

        assert.equal(identity.id, '110000000000000000001', 'the id the route matches on is the sub');
        assert.equal(identity.sub, '110000000000000000001', 'and the decoded profile is stored whole');
        assert.equal(identity.email, 'buyer@example.com', 'email included — it is just no longer the key');
      },
    },

    {
      name: 'every-packaged-provider-satisfies-the-shape',

      async run({ assert }) {
        for (const provider of [google, discord, spotify, twitch, kick]) {
          const file = `${provider.provider}.js`;

          assert.equal(assertProviderShape(provider, file), provider, `${file} loads`);
          assert.equal(typeof provider.identity, 'function', `${file} declares identity()`);
          assert.ok(provider.urls.authorize, `${file} says where the user is sent`);
          assert.ok(provider.urls.token, `${file} says how the code becomes a token`);
          assert.equal(provider.urls.status, undefined, `${file} declares no dead urls.status`);
          assert.equal(provider.urls.tokenize, undefined, `${file} has no urls.tokenize any more`);
          assert.equal(provider.urls.refresh, undefined, `${file} has no urls.refresh any more`);
          assert.equal(provider.authParams, undefined, `${file} names its extra params \`params\``);
          assert.equal(provider.verifyIdentity, undefined, `${file} carries no verifyIdentity()`);
          assert.equal(provider.revokeToken, undefined, `${file} carries no revokeToken()`);
          assert.equal(provider.verifyConnection, undefined, `${file} carries no verifyConnection()`);
        }

        assert.equal(typeof google.revoke, 'function', 'Google keeps its own revoke (the endpoint takes the token alone)');
        assert.equal(typeof kick.revoke, 'function', 'and Kick (it wants a token hint)');
        assert.equal(discord.revoke, undefined, 'Discord uses the RFC 7009 default');
        assert.equal(twitch.revoke, undefined, 'and Twitch');
        assert.equal(spotify.urls.revoke, undefined, 'Spotify declares no revoke url at all');
      },
    },
  ],
});
