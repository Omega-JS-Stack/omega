/**
 * Test: routes/user/connections — which actions honor an admin's `uid`
 * ([#782](https://github.com/Omega-JS-Stack/omega/issues/782)).
 *
 * Run (from the framework repo): npm test routes/user/connections-uid
 *
 * Every action used to take `uid`. Two of them cannot mean anything for somebody
 * else: `authorize` hands back a URL the CONNECTING user's own browser has to
 * open, and `tokenize` spends a code that browser came back with. A `uid` on
 * those two is a stale caller acting on the wrong user, so the route answers 400
 * NAMING the argument instead of quietly using the caller's own record.
 * `status`, `refresh` and `delete` keep it: each acts AT THE PROVIDER on a
 * user's behalf — checking a connection (and dropping a dead one), refreshing,
 * revoking — which a trusted server does with no browser in the loop.
 *
 * The doc case belongs here too: the section that told a trusted service to read
 * a stored token with `GET /user` + `uid` described a parameter that route never
 * had (the bug this issue opened on), and the read it names now is the admin
 * firestore route.
 *
 * Everything is offline: the routes are called directly with a hand-rolled ctx,
 * a recording Firestore stand-in, and a brand-directory fixture provider whose
 * grant steps are overrides — no emulator, no network, no provider.
 */

const path = require('path');
const jetpack = require('fs-jetpack');

const getRoute = require('../../../dist/manager/routes/user/connections/get.js');
const postRoute = require('../../../dist/manager/routes/user/connections/post.js');
const deleteRoute = require('../../../dist/manager/routes/user/connections/delete.js');
const { encryptState } = require('../../../dist/manager/routes/user/connections/_state.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const PROVIDER_ID = 'uid-fixture-782';
const PROVIDER_ENV_KEY = 'UID_FIXTURE_782';
const CALLER_UID = 'caller-782';
const OTHER_UID = 'other-782';
const DOC_PATH = path.join(__dirname, '../../../docs/connections.md');

// The credentials the lane resolves for the fixture provider. Restored in
// cleanup() — a run that leaves them behind changes what the next file reads.
const originalEnv = {
  [`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_ID`]: process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_ID`],
  [`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_SECRET`]: process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_SECRET`],
};

process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_ID`] = 'client-id-782';
process.env[`CONNECTIONS_${PROVIDER_ENV_KEY}_CLIENT_SECRET`] = 'client-secret-782';

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// A provider that overrides every network step, so the whole lane runs with no
// authorization server behind it.
const PROVIDER_SOURCE = [
  'module.exports = {',
  `  provider: '${PROVIDER_ID}',`,
  "  name: 'Uid Fixture',",
  "  urls: { authorize: 'https://provider.test/a', token: 'https://provider.test/t' },",
  "  async exchange() { return { access_token: 'access-782', refresh_token: 'refresh-782', token_type: 'Bearer', expires_in: 3600, scope: 'identify' }; },",
  "  async refresh() { return { access_token: 'refreshed-782', refresh_token: 'refresh-782', token_type: 'Bearer', expires_in: 3600, scope: 'identify' }; },",
  "  async identity() { return { id: 'fixture-user' }; },",
  '};',
].join('\n');

/** The stored connection record a refresh or a delete acts on. */
function storedUser(uid) {
  return {
    id: uid,
    connections: {
      [PROVIDER_ID]: {
        type: 'oauth2',
        token: { access_token: 'access-old', refresh_token: 'refresh-782' },
      },
    },
  };
}

/**
 * A Firestore stand-in that answers per PATH and records every write — a case
 * about acting on ANOTHER user's document has to see which document was written.
 */
function recordingFirestore(docs) {
  const writes = [];

  const snapshot = (docPath) => ({ exists: !!docs[docPath], data: () => docs[docPath] });

  const firestore = {
    doc: (docPath) => ({
      path: docPath,
      get: async () => snapshot(docPath),
      update: async (payload) => writes.push({ verb: 'update', path: docPath, payload }),
      set: async (payload) => writes.push({ verb: 'set', path: docPath, payload }),
    }),

    // A refresh takes its lease in a TRANSACTION on the user document
    // ([#783](https://github.com/Omega-JS-Stack/omega/issues/783)); these cases
    // are about WHICH document is acted on, so the transaction's write records
    // like every other one. The lease itself is pinned in
    // connections-refresh-lease.test.js.
    runTransaction: (fn) => fn({
      get: async (ref) => snapshot(ref.path),
      set: (ref, payload) => writes.push({ verb: 'transaction.set', path: ref.path, payload }),
    }),

    // The uniqueness query tokenize runs on the identity
    // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)); nobody else
    // holds this fixture's identity, so it matches nothing
    collection: () => ({ where: () => ({ get: async () => ({ docs: [], size: 0 }) }) }),
  };

  return { admin: { firestore: () => firestore }, writes };
}

/** The lane, wired: a brand provider dir, a recording Firestore, and a ctx. */
function lane(docs) {
  const cwd = jetpack.tmpDir({ prefix: 'omega-connections-782' }).path();

  jetpack.write(path.join(cwd, 'connections', `${PROVIDER_ID}.js`), PROVIDER_SOURCE);

  const { admin, writes } = recordingFirestore(docs || {});

  const Manager = {
    cwd,
    libraries: { admin },
    project: { websiteUrl: 'https://brand.test' },
    config: {},
    Metadata: () => ({ set: () => ({}) }),
  };

  const responses = [];
  const redirects = [];

  const ctx = {
    Manager,
    log() {},
    respond: (message, options) => {
      responses.push({ message, options: options || {} });
      return { message, options: options || {} };
    },
    redirect: (url) => {
      redirects.push(url);
      return { url };
    },
    meta: { startTime: { timestamp: 'now', timestampUNIX: 1 } },
  };

  return { ctx, Manager, writes, responses, redirects };
}

/**
 * The caller, as authenticate() resolved them — the resolved user IS the record
 * the lane reads on the self path (it only goes to Firestore for another uid),
 * so a self case that needs a stored connection carries it here.
 */
function userFor(uid, isAdmin, connected) {
  return {
    authenticated: true,
    auth: { uid },
    roles: { admin: !!isAdmin },
    ...(connected ? { connections: storedUser(uid).connections } : {}),
  };
}

/** The last thing the route answered. */
function answered(responses) {
  return responses[responses.length - 1] || {};
}

module.exports = defineCases({
  description: 'Connections: which actions honor an admin uid, and which refuse it',
  type: 'group',

  cleanup() {
    restoreEnv();
  },

  tests: [
    {
      name: 'authorize-with-a-passed-uid-answers-400-naming-it',

      async run({ assert }) {
        const { ctx, writes, responses } = lane();

        await getRoute({
          ctx,
          user: userFor(CALLER_UID, true),
          settings: { provider: PROVIDER_ID, action: 'authorize', redirect: false, uid: OTHER_UID },
        });

        const response = answered(responses);

        assert.equal(response.options.code, 400, `even an ADMIN gets the 400: ${response.message}`);
        assert.match(response.message, /uid/, `and the message names the dropped argument: ${response.message}`);
        assert.match(response.message, /`status`, `refresh` or `delete`/, `and names every action that DOES take one, so the 400 is a redirection: ${response.message}`);
        assert.equal(response.message.includes(OTHER_UID), false, "the caller's value is not echoed back");
        assert.equal(writes.length, 0, 'nothing was written — no session was minted for anybody');
      },
    },

    {
      name: 'status-with-a-uid-as-an-admin-reads-that-users-record',

      async run({ assert }) {
        const { ctx, responses } = lane({ [`users/${OTHER_UID}`]: storedUser(OTHER_UID) });

        // The admin has no connection of their OWN — a status that answered for
        // the caller would say disconnected, so 'connected' can only have come
        // from the passed user's document.
        await getRoute({
          ctx,
          user: userFor(CALLER_UID, true),
          settings: { provider: PROVIDER_ID, action: 'status', uid: OTHER_UID },
        });

        const response = answered(responses);

        assert.equal(response.options.code, undefined, `status checks a connection AT THE PROVIDER, so a trusted server may run it: ${response.message}`);
        assert.equal(response.message.status, 'connected', "and the record it read is the PASSED user's");
      },
    },

    {
      name: 'tokenize-with-a-passed-uid-answers-400-naming-it',

      async run({ assert }) {
        const { ctx, writes, responses } = lane();

        await postRoute({
          ctx,
          user: userFor(CALLER_UID, true),
          settings: {
            action: 'tokenize',
            code: 'auth-code-782',
            encryptedState: encryptState({ provider: PROVIDER_ID, uid: CALLER_UID, csrf: 'csrf-782', ts: Date.now() }),
            uid: OTHER_UID,
          },
        });

        const response = answered(responses);

        assert.equal(response.options.code, 400, `the code belongs to the browser that carried it: ${response.message}`);
        assert.match(response.message, /uid/, `and the message names the dropped argument: ${response.message}`);
        assert.equal(writes.length, 0, 'the exchange never ran, so no record was written for either user');
      },
    },

    {
      name: 'refresh-with-a-uid-as-an-admin-acts-on-that-user',

      async run({ assert }) {
        const { ctx, writes, responses } = lane({ [`users/${OTHER_UID}`]: storedUser(OTHER_UID) });

        await postRoute({
          ctx,
          user: userFor(CALLER_UID, true),
          settings: { provider: PROVIDER_ID, action: 'refresh', uid: OTHER_UID },
        });

        const response = answered(responses);

        assert.equal(response.options.code, undefined, `a trusted server may refresh on a user's behalf: ${response.message}`);
        assert.equal(response.message.success, true, 'and the refresh reports success');
        assert.equal(response.message.token.access_token, 'refreshed-782', 'carrying the token it stored ([#783](https://github.com/Omega-JS-Stack/omega/issues/783))');

        const write = writes.find((entry) => entry.path === `users/${OTHER_UID}` && entry.verb === 'set');

        assert.ok(write, "the new token landed on the PASSED user's document");
        assert.equal(write.payload.connections[PROVIDER_ID].token.access_token, 'refreshed-782', 'and it is the refreshed token');
        assert.equal(writes.some((entry) => entry.path === `users/${CALLER_UID}`), false, "and nothing landed on the admin's own — not even the lease");
      },
    },

    {
      name: 'delete-with-a-uid-as-an-admin-acts-on-that-user',

      async run({ assert }) {
        const { ctx, writes, responses } = lane({ [`users/${OTHER_UID}`]: storedUser(OTHER_UID) });

        await deleteRoute({
          ctx,
          user: userFor(CALLER_UID, true),
          settings: { provider: PROVIDER_ID, uid: OTHER_UID },
        });

        const response = answered(responses);

        assert.equal(response.options.code, undefined, `a trusted server may revoke on a user's behalf: ${response.message}`);

        const write = writes.find((entry) => entry.path === `users/${OTHER_UID}`);

        assert.ok(write, "the deletion hit the PASSED user's document");
        assert.equal(`connections.${PROVIDER_ID}` in write.payload, true, 'and it is the provider entry that went');
        assert.equal(writes.some((entry) => entry.path === `users/${CALLER_UID}`), false, "and nothing touched the admin's own");
      },
    },

    {
      name: 'status-refresh-and-delete-with-a-uid-as-a-non-admin-answer-403',

      async run({ assert }) {
        const docs = { [`users/${OTHER_UID}`]: storedUser(OTHER_UID) };

        const statusLane = lane(docs);

        await getRoute({
          ctx: statusLane.ctx,
          user: userFor(CALLER_UID, false),
          settings: { provider: PROVIDER_ID, action: 'status', uid: OTHER_UID },
        });

        assert.equal(answered(statusLane.responses).options.code, 403, "only an admin reads somebody else's connection status");
        assert.equal(statusLane.writes.length, 0, 'and nothing was removed from their record');

        const refreshLane = lane(docs);

        await postRoute({
          ctx: refreshLane.ctx,
          user: userFor(CALLER_UID, false),
          settings: { provider: PROVIDER_ID, action: 'refresh', uid: OTHER_UID },
        });

        assert.equal(answered(refreshLane.responses).options.code, 403, 'only an admin refreshes for somebody else');
        assert.equal(refreshLane.writes.length, 0, 'and nothing was written');

        const deleteLane = lane(docs);

        await deleteRoute({
          ctx: deleteLane.ctx,
          user: userFor(CALLER_UID, false),
          settings: { provider: PROVIDER_ID, uid: OTHER_UID },
        });

        assert.equal(answered(deleteLane.responses).options.code, 403, 'only an admin revokes for somebody else');
        assert.equal(deleteLane.writes.length, 0, 'and nothing was deleted');
      },
    },

    {
      name: 'the-self-path-of-authorize-and-status-is-unchanged',

      async run({ assert }) {
        const authorizeLane = lane();

        await getRoute({
          ctx: authorizeLane.ctx,
          user: userFor(CALLER_UID, false),
          settings: { provider: PROVIDER_ID, action: 'authorize', redirect: false },
        });

        const authorized = answered(authorizeLane.responses);

        assert.equal(authorized.options.code, undefined, `no uid, no 400: ${authorized.message}`);
        assert.match(authorized.message.url, /^https:\/\/provider\.test\/a\?/, "the provider's authorize url comes back");

        const session = authorizeLane.writes.find((entry) => entry.path === `usage/${CALLER_UID}`);

        assert.ok(session, "the one-time session was minted on the CALLER's usage document");
        assert.ok(session.payload.connections[PROVIDER_ID].csrf, 'with its CSRF token');

        const statusLane = lane();

        await getRoute({
          ctx: statusLane.ctx,
          user: userFor(CALLER_UID, false, true),
          settings: { provider: PROVIDER_ID, action: 'status' },
        });

        const status = answered(statusLane.responses);

        assert.equal(status.options.code, undefined, `status still answers the caller: ${status.message}`);
        assert.equal(status.message.status, 'connected', 'and the stored record reads connected');
      },
    },

    {
      name: 'the-self-path-of-tokenize-refresh-and-delete-is-unchanged',

      async run({ assert }) {
        const tokenizeLane = lane({
          [`usage/${CALLER_UID}`]: { connections: { [PROVIDER_ID]: { csrf: 'csrf-782', verifier: null, createdAt: Date.now() } } },
        });

        await postRoute({
          ctx: tokenizeLane.ctx,
          user: userFor(CALLER_UID, false),
          settings: {
            action: 'tokenize',
            code: 'auth-code-782',
            encryptedState: encryptState({ provider: PROVIDER_ID, uid: CALLER_UID, csrf: 'csrf-782', ts: Date.now() }),
          },
        });

        const tokenized = answered(tokenizeLane.responses);

        assert.equal(tokenized.options.code, undefined, `the callback page's call still completes: ${tokenized.message}`);
        assert.equal(tokenized.message.success, true, 'reporting success');

        const record = tokenizeLane.writes.find((entry) => entry.path === `users/${CALLER_UID}` && entry.verb === 'set');

        assert.ok(record, "and the record landed on the state's user");
        assert.equal(record.payload.connections[PROVIDER_ID].token.access_token, 'access-782', 'carrying the exchanged token');

        // The refresh reads the record in its lease TRANSACTION
        // ([#783](https://github.com/Omega-JS-Stack/omega/issues/783)), so the
        // caller's own document is what it spends — seeded here like any other
        const refreshLane = lane({ [`users/${CALLER_UID}`]: storedUser(CALLER_UID) });

        await postRoute({
          ctx: refreshLane.ctx,
          user: userFor(CALLER_UID, false, true),
          settings: { provider: PROVIDER_ID, action: 'refresh' },
        });

        assert.equal(answered(refreshLane.responses).options.code, undefined, 'a user still refreshes their own token');
        assert.equal(answered(refreshLane.responses).message.token.access_token, 'refreshed-782', 'and gets it back in the answer');
        assert.ok(refreshLane.writes.find((entry) => entry.path === `users/${CALLER_UID}` && entry.verb === 'set'), 'on their own document');

        const deleteLane = lane();

        await deleteRoute({
          ctx: deleteLane.ctx,
          user: userFor(CALLER_UID, false, true),
          settings: { provider: PROVIDER_ID },
        });

        assert.equal(answered(deleteLane.responses).options.code, undefined, 'and still disconnects their own');
        assert.ok(deleteLane.writes.find((entry) => entry.path === `users/${CALLER_UID}`), 'on their own document');
      },
    },

    {
      // The 400 above can only ever fire because `uid` carries NO default: a
      // default (the caller's own uid) would make `settings.uid` set on every
      // request, and droppedUidError() fires on any value — every self
      // `authorize` and every callback-page `tokenize` would answer 400.
      // Restoring one is the regression this case exists to catch.
      name: 'the-schemas-declare-uid-with-no-default',

      async run({ assert }) {
        // Resolved the way settings.js loadSchema() does: the module is a
        // function taking the request context and answering the schema.
        const context = { ctx: null, user: null, data: {}, method: 'POST', headers: {}, geolocation: null, client: null };

        const getSchema = require('../../../dist/manager/schemas/user/connections/get.js')(context);
        const postSchema = require('../../../dist/manager/schemas/user/connections/post.js')(context);

        // An absent optional string resolves to the empty value (the powertools
        // parity the field pipeline keeps), which is what droppedUidError() reads
        // as "no uid was passed". A DEFAULT here would be a real uid instead.
        for (const [label, resolved] of [
          ['GET', getSchema.parse({})],
          ['GET authorize', getSchema.parse({ action: 'authorize' })],
          ['POST', postSchema.parse({})],
          ['POST tokenize', postSchema.parse({ action: 'tokenize' })],
        ]) {
          assert.equal(resolved.uid, '', `${label} resolves uid to the empty value, never a uid of its own`);
          assert.equal(!!resolved.uid, false, `${label} reads as "no uid was passed", so the self path is not the 400`);
        }

        // The field stays DECLARED, or a stale caller's value would be stripped
        // as an unknown key and never reach the 400 that names it
        assert.equal(postSchema.parse({ uid: OTHER_UID }).uid, OTHER_UID, 'a passed uid still reaches the handler');
        assert.equal(getSchema.parse({ uid: OTHER_UID }).uid, OTHER_UID, 'on both methods');

        // The defaults that DO exist are untouched
        assert.equal(getSchema.parse({}).action, 'authorize', "GET's default action");
        assert.equal(postSchema.parse({}).action, 'tokenize', "and POST's");
      },
    },

    {
      // The bug this issue opened on: the doc sent a trusted service to a
      // parameter `GET /user` never had.
      name: 'the-doc-sends-a-trusted-read-to-the-admin-firestore-route',

      async run({ assert }) {
        const doc = jetpack.read(DOC_PATH);

        assert.ok(doc, `the doc is where the test expects it: ${DOC_PATH}`);
        assert.match(doc, /admin\/firestore/, 'the trusted read is the admin firestore route');
        assert.match(doc, /plain text/, 'and the doc says plainly how the token is stored');

        const readSection = doc.slice(doc.indexOf('## Reading the token from another target'));

        assert.ok(readSection.startsWith('## Reading the token from another target'), 'the section is still there to be read');
        assert.match(readSection, /admin\/firestore\?path=users\//, 'and it is the admin firestore read a trusted service is sent to');

        // Every line of the section that names `GET /omega/user` (the route
        // itself, not `/omega/user/connections`) either says nothing about a
        // uid or says it takes none — never that it accepts one.
        const userLines = readSection.split('\n').filter((line) => /\/omega\/user\b(?!\/)/.test(line));

        assert.equal(userLines.length > 0, true, 'the read as the user is still documented');

        for (const line of userLines) {
          const claimsUid = /uid/.test(line) && !/\bno `?uid`?/i.test(line);

          assert.equal(claimsUid, false, `GET /user is never described as taking a uid: ${line}`);
        }

        // The exact claim that opened the issue: "As an admin — the same call
        // with `uid`", where "the same call" was the GET /user above it.
        assert.equal(/same call[^\n]*uid/i.test(readSection), false, 'no bullet sends an admin back to that call with a uid');
      },
    },
  ],
});
