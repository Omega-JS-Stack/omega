/**
 * Test: routes/user/connections, several accounts of one provider.
 *
 * Accounts sit at `connections.<provider>.<identityId>`, capped by
 * `connections.<provider>.max` (default 1); `refresh`, `status` and
 * `disconnect` take `provider` plus `id`, and `id` may be left out when the
 * user holds exactly one account of that provider.
 *
 * Offline: a hand-rolled ctx, an in-memory Firestore that APPLIES every write
 * (a case reads the stored document, whatever write form the route used), and
 * a brand-directory fixture named `google` whose steps record their calls.
 */

const path = require('path');
const jetpack = require('fs-jetpack');

const getRoute = require('../../../dist/omega/routes/user/connections/get.js');
const postRoute = require('../../../dist/omega/routes/user/connections/post.js');
const deleteRoute = require('../../../dist/omega/routes/user/connections/delete.js');
const { encryptState } = require('../../../dist/omega/routes/user/connections/_state.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const { recordingFirestore } = require('../../helpers/_recording-firestore.js');

// The brand's own provider dir is searched first, so this fixture stands in for
// the packaged Google module and every message names `google`
const PROVIDER_ID = 'google';
const USER_UID = 'user-max-owner';
const OTHER_UID = 'user-max-other';

const CALL_STATE = '__omegaConnectionsMax';

const record = (step) => `(global['${CALL_STATE}'] = global['${CALL_STATE}'] || []).push(${step});`;

// The code a tokenize carries names the identity it grants (`sub-alpha`, or
// `sub-alpha#again` for a second grant of the same account), so one fixture
// serves every identity a case needs
const PROVIDER_SOURCE = [
  "const NAMES = { 'sub-alpha': 'Alpha Channel', 'sub-beta': 'Beta Channel' };",
  'module.exports = {',
  `  provider: '${PROVIDER_ID}',`,
  "  name: 'Google',",
  "  urls: { authorize: 'https://provider.test/a', token: 'https://provider.test/t' },",
  "  authorize() { return 'https://provider.test/a?state=x'; },",
  "  async exchange(context) { return { access_token: `access-${context.code}`, refresh_token: `refresh-${context.code}`, token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }; },",
  `  async refresh(context) { ${record('`refresh:${context.token.refresh_token}`')} return { access_token: \`refreshed-\${context.token.refresh_token}\`, refresh_token: context.token.refresh_token, token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }; },`,
  `  async revoke(context) { ${record('`revoke:${context.token.access_token}`')} },`,
  "  async identity(context) { const id = context.token.access_token.slice('access-'.length).split('#')[0]; return { id, name: NAMES[id] }; },",
  '};',
].join('\n');

/** The steps the provider ran since the last reset, in order. */
function stepsRun() {
  return global[CALL_STATE] || [];
}

// ============================================================================
// The lane
// ============================================================================

/** One stored account, as tokenize writes it. */
function linkedAccount(id, name) {
  return {
    type: 'oauth2',
    token: { access_token: `access-old-${id}`, refresh_token: `refresh-old-${id}`, token_type: 'Bearer', expires_in: 3600, scope: 'openid email' },
    identity: { id, name },
    updated: { timestamp: '2026-01-01T00:00:00.000Z', timestampUNIX: 100 },
  };
}

const ALPHA = () => linkedAccount('sub-alpha', 'Alpha Channel');
const BETA = () => linkedAccount('sub-beta', 'Beta Channel');

// The birth stamp a user document carries; no connections write may touch it
const CREATED = { timestamp: '2025-01-01T00:00:00.000Z', timestampUNIX: 50 };

// What ctx.metadata() stamps, as the Metadata service does: `updated` and the tag
const STAMP = { updated: { timestamp: '2026-02-02T00:00:00.000Z', timestampUNIX: 200 }, tag: 'user/connections' };

/** The lane: a brand dir holding the fixture, the store, and a ctx. With `noDoc`, the user has no document yet. */
function lane({ max, accounts = [], docs = {}, noDoc = false } = {}) {
  const cwd = jetpack.tmpDir({ prefix: 'omega-connections-max' }).path();

  jetpack.write(path.join(cwd, 'connections', `${PROVIDER_ID}.js`), PROVIDER_SOURCE);

  const providerConnections = Object.fromEntries(accounts.map((account) => [account.identity.id, account]));
  const store = recordingFirestore({
    apply: true,
    docs: {
      ...(noDoc ? {} : {
        [`users/${USER_UID}`]: {
          auth: { uid: USER_UID },
          metadata: { created: CREATED },
          ...(accounts.length ? { connections: { [PROVIDER_ID]: providerConnections } } : {}),
        },
      }),
      ...docs,
    },
  });

  const omega = {
    cwd,
    firebase: { admin: store.admin },
    project: { websiteUrl: 'https://brand.test' },
    config: {
      brand: { name: 'Test Brand' },
      connections: { [PROVIDER_ID]: { enabled: true, ...(max === undefined ? {} : { max }) } },
    },
  };

  const responses = [];

  const ctx = {
    omega,
    metadata: (options) => ({ ...structuredClone(STAMP), tag: options.tag }),
    log() {},
    respond: (message, options) => {
      responses.push({ message, options: options || {} });
      return { message, options: options || {} };
    },
    redirect: (url) => ({ url }),
    meta: { startTime: { timestamp: '2026-02-02T00:00:00.000Z', timestampUNIX: 200 } },
  };

  global[CALL_STATE] = [];

  return { ctx, store, responses };
}

/** The signed-in owner, carrying what the store holds for them right now. */
function owner(store) {
  return {
    authenticated: true,
    auth: { uid: USER_UID },
    roles: { admin: false },
    ...store.read(`users/${USER_UID}`),
  };
}

/** The owner's stored accounts of the provider, keyed by identity id. */
function storedAccounts(store) {
  return ((store.read(`users/${USER_UID}`) || {}).connections || {})[PROVIDER_ID] || {};
}

/** The last thing the route answered. */
function answered(responses) {
  return responses[responses.length - 1] || {};
}

/** One tokenize leg, its session minted first exactly as authorize would. */
async function tokenize(wired, code) {
  await wired.store.admin.firestore().doc(`usage/${USER_UID}`).set({
    connections: { [PROVIDER_ID]: { csrf: 'csrf-max', verifier: null, createdAt: Date.now() } },
  }, { merge: true });

  await postRoute({
    ctx: wired.ctx,
    user: {},
    data: {
      action: 'tokenize',
      code,
      encryptedState: encryptState({ provider: PROVIDER_ID, uid: USER_UID, csrf: 'csrf-max', ts: Date.now() }),
    },
  });

  return answered(wired.responses);
}

function messageOf(response) {
  return typeof response.message === 'string' ? response.message : JSON.stringify(response.message);
}

function assertServed(assert, response, what) {
  assert.equal(response.options.code, undefined, `${what} is served: ${messageOf(response)}`);
}

module.exports = defineCases({
  description: 'Connections: several accounts of one provider',
  type: 'group',

  cleanup() {
    delete global[CALL_STATE];
  },

  tests: [
    {
      name: 'a-new-identity-past-the-default-max-of-1-is-refused-and-nothing-changes',

      async run({ assert }) {
        const wired = lane({ accounts: [ALPHA()] });
        const before = storedAccounts(wired.store);

        const response = await tokenize(wired, 'sub-beta');

        assert.equal(response.options.code, 400, `the refusal is a 400: ${messageOf(response)}`);
        assert.equal(response.message, 'Connection limit reached for google: connections.google.max is 1.', 'it names the key that raises the cap, and its value');
        assert.deepEqual(storedAccounts(wired.store), before, 'the stored account is exactly as it was');
      },
    },

    {
      name: 'with-max-2-two-identities-are-stored-under-their-ids-with-their-own-tokens',

      async run({ assert }) {
        const wired = lane({ max: 2 });

        assertServed(assert, await tokenize(wired, 'sub-alpha'), 'the first tokenize');
        assertServed(assert, await tokenize(wired, 'sub-beta'), 'the second tokenize');

        const accounts = storedAccounts(wired.store);

        assert.deepEqual(Object.keys(accounts).sort(), ['sub-alpha', 'sub-beta'], 'each account sits under its identity id, and nothing else sits beside them');
        assert.equal(accounts['sub-alpha'].token.access_token, 'access-sub-alpha', 'the first keeps its own token');
        assert.equal(accounts['sub-beta'].token.access_token, 'access-sub-beta', 'the second has its own');
        assert.equal(accounts['sub-alpha'].identity.id, 'sub-alpha', 'each record carries its identity');
        assert.equal(accounts['sub-beta'].identity.id, 'sub-beta');
        assert.equal(accounts['sub-beta'].type, 'oauth2', 'and the record shape is unchanged one level down');
        assert.deepEqual(wired.store.read(`users/${USER_UID}`).metadata.created, CREATED, "the document's birth stamp survives both writes");
      },
    },

    {
      name: 'the-same-identity-reconnecting-replaces-its-own-record-and-the-count-stays',

      async run({ assert }) {
        const wired = lane({ accounts: [{ ...ALPHA(), stale: 'from-the-older-grant' }] });

        assertServed(assert, await tokenize(wired, 'sub-alpha#again'), 'a reconnect of a linked account at max 1');

        const accounts = storedAccounts(wired.store);

        assert.deepEqual(Object.keys(accounts), ['sub-alpha'], 'still one account');
        assert.equal(accounts['sub-alpha'].token.access_token, 'access-sub-alpha#again', 'its record holds the new grant');
        assert.equal(accounts['sub-alpha'].token.refresh_token, 'refresh-sub-alpha#again', 'and the old token is gone');
        assert.equal('stale' in accounts['sub-alpha'], false, 'the record is replaced whole: no field of the older grant is left');
        assert.deepEqual(wired.store.read(`users/${USER_UID}`).metadata.created, CREATED, "and the document's birth stamp survives the reconnect");
      },
    },

    {
      name: 'a-user-with-no-document-yet-gets-one-holding-the-account',

      async run({ assert }) {
        const wired = lane({ noDoc: true });

        assertServed(assert, await tokenize(wired, 'sub-alpha'), 'a tokenize for a user with no document');
        assert.deepEqual(wired.store.read(`users/${USER_UID}`), {
          connections: {
            [PROVIDER_ID]: {
              'sub-alpha': {
                type: 'oauth2',
                token: { access_token: 'access-sub-alpha', refresh_token: 'refresh-sub-alpha', token_type: 'Bearer', expires_in: 3600, scope: 'openid email' },
                identity: { id: 'sub-alpha', name: 'Alpha Channel' },
                updated: { timestamp: '2026-02-02T00:00:00.000Z', timestampUNIX: 200 },
              },
            },
          },
          metadata: STAMP,
        }, 'the document is created holding the account under its id, and the metadata stamp');
      },
    },

    {
      name: 'refresh-with-only-provider-serves-the-one-account-a-user-holds',

      async run({ assert }) {
        const wired = lane({ accounts: [ALPHA()] });

        await postRoute({ ctx: wired.ctx, user: owner(wired.store), data: { provider: PROVIDER_ID, action: 'refresh' } });

        assertServed(assert, answered(wired.responses), 'a refresh naming no id');
        assert.deepEqual(stepsRun(), ['refresh:refresh-old-sub-alpha'], 'the one account refreshed');

        const accounts = storedAccounts(wired.store);

        assert.deepEqual(Object.keys(accounts), ['sub-alpha'], 'no lease or token was written beside the account');
        assert.equal(accounts['sub-alpha'].token.access_token, 'refreshed-refresh-old-sub-alpha', 'the new token is stored on it');
        assert.equal(accounts['sub-alpha'].refreshing, undefined, 'and its lease is released');
      },
    },

    {
      name: 'refresh-with-only-provider-is-refused-naming-id-when-two-accounts-exist',

      async run({ assert }) {
        const wired = lane({ max: 2, accounts: [ALPHA(), BETA()] });
        const before = storedAccounts(wired.store);

        await postRoute({ ctx: wired.ctx, user: owner(wired.store), data: { provider: PROVIDER_ID, action: 'refresh' } });

        const response = answered(wired.responses);

        assert.equal(response.options.code, 400, `the refusal is a 400: ${messageOf(response)}`);
        assert.equal(response.message, 'Several google connections exist: pass id.', 'it names the missing argument');
        assert.deepEqual(stepsRun(), [], 'no refresh reached the provider');
        assert.deepEqual(storedAccounts(wired.store), before, 'and nothing was written');
      },
    },

    {
      name: 'refresh-with-id-refreshes-only-that-account',

      async run({ assert }) {
        const wired = lane({ max: 2, accounts: [ALPHA(), BETA()] });

        await postRoute({ ctx: wired.ctx, user: owner(wired.store), data: { provider: PROVIDER_ID, id: 'sub-beta', action: 'refresh' } });

        assertServed(assert, answered(wired.responses), 'a refresh naming its id');
        assert.deepEqual(stepsRun(), ['refresh:refresh-old-sub-beta'], 'the named account, and only it, refreshed');

        const accounts = storedAccounts(wired.store);

        assert.deepEqual(Object.keys(accounts).sort(), ['sub-alpha', 'sub-beta'], 'no lease or token was written beside the accounts');
        assert.equal(accounts['sub-beta'].token.access_token, 'refreshed-refresh-old-sub-beta', 'its new token is stored');
        assert.equal(accounts['sub-beta'].refreshing, undefined, 'and its lease is released');
        assert.deepEqual(accounts['sub-alpha'], ALPHA(), 'the other account is untouched');
      },
    },

    {
      name: 'disconnect-with-id-removes-only-that-record',

      async run({ assert }) {
        const wired = lane({ max: 2, accounts: [ALPHA(), BETA()] });

        await deleteRoute({ ctx: wired.ctx, user: owner(wired.store), data: { provider: PROVIDER_ID, id: 'sub-alpha' } });

        const response = answered(wired.responses);

        assertServed(assert, response, 'a disconnect naming its id');
        assert.equal(response.message.success, true, 'the disconnect succeeds');
        assert.deepEqual(stepsRun(), ['revoke:access-old-sub-alpha'], "only the named account's token was revoked");
        assert.deepEqual(storedAccounts(wired.store), { 'sub-beta': BETA() }, "the other account and its token stay");
      },
    },

    {
      name: 'status-with-only-provider-lists-every-account-with-its-display-name',

      async run({ assert }) {
        const wired = lane({ max: 2, accounts: [ALPHA(), BETA()] });

        await getRoute({ ctx: wired.ctx, user: owner(wired.store), data: { provider: PROVIDER_ID, action: 'status' } });

        const response = answered(wired.responses);

        assertServed(assert, response, 'a status naming no id');
        assert.deepEqual({ ...response.message, connections: [...(response.message.connections || [])].sort((a, b) => a.id.localeCompare(b.id)) }, {
          connections: [
            { id: 'sub-alpha', identity: { id: 'sub-alpha', name: 'Alpha Channel' }, status: 'connected' },
            { id: 'sub-beta', identity: { id: 'sub-beta', name: 'Beta Channel' }, status: 'connected' },
          ],
        }, `every account is listed, each with its identity and its own status: ${messageOf(response)}`);
      },
    },

    {
      name: 'a-document-still-in-the-old-one-level-shape-holds-no-accounts',

      async run({ assert }) {
        // Until the users migration runs, the record sits at `connections.google`
        // itself: its keys (`type`, `token`, `identity`, `updated`) are not accounts
        const wired = lane({ docs: { [`users/${USER_UID}`]: { auth: { uid: USER_UID }, metadata: { created: CREATED }, connections: { [PROVIDER_ID]: ALPHA() } } } });

        await getRoute({ ctx: wired.ctx, user: owner(wired.store), data: { provider: PROVIDER_ID, action: 'status' } });

        const status = answered(wired.responses);

        assertServed(assert, status, 'a status on an old-shape document');
        assert.deepEqual(status.message, { status: 'disconnected' }, `no account is listed: ${messageOf(status)}`);

        assertServed(assert, await tokenize(wired, 'sub-beta'), 'a tokenize at the default max of 1');
        assert.equal(storedAccounts(wired.store)['sub-beta'].token.access_token, 'access-sub-beta', 'the new account is stored under its id');
      },
    },

    {
      name: 'an-entry-holding-only-a-lease-is-not-an-account',

      async run({ assert }) {
        const ghost = { refreshing: { instance: 'gone-instance', timestampUNIX: 1 } };
        const wired = lane({ docs: { [`users/${USER_UID}`]: { auth: { uid: USER_UID }, metadata: { created: CREATED }, connections: { [PROVIDER_ID]: { 'sub-ghost': ghost } } } } });

        assertServed(assert, await tokenize(wired, 'sub-alpha'), 'a tokenize at the default max of 1 beside a ghost');

        await getRoute({ ctx: wired.ctx, user: owner(wired.store), data: { provider: PROVIDER_ID, action: 'status' } });

        const status = answered(wired.responses);

        assertServed(assert, status, 'a status naming no id');
        assert.deepEqual(status.message, { status: 'connected' }, `the one real account answers alone, the ghost unlisted: ${messageOf(status)}`);
      },
    },

    {
      name: 'an-identity-another-user-holds-is-refused-as-before',

      async run({ assert }) {
        const theirs = { auth: { uid: OTHER_UID }, connections: { [PROVIDER_ID]: { 'sub-alpha': ALPHA() } } };
        const wired = lane({ max: 2, docs: { [`users/${OTHER_UID}`]: theirs } });

        const response = await tokenize(wired, 'sub-alpha');

        assert.equal(response.options.code, 400, `the refusal is a 400: ${messageOf(response)}`);
        assert.equal(response.message, 'This Google account is already connected to a Test Brand account', 'the uniqueness message is unchanged');
        assert.deepEqual(storedAccounts(wired.store), {}, 'nothing was linked to the connecting user');
        assert.deepEqual(wired.store.read(`users/${OTHER_UID}`), theirs, 'and the holder keeps the account');
      },
    },
  ],
});
