/**
 * Test: routes/user/connections — brand providers, PKCE, and the overridable
 * steps ([#771](https://github.com/Omega-JS-Stack/omega/issues/771),
 * [#793](https://github.com/Omega-JS-Stack/omega/issues/793)).
 *
 * Run (from the framework repo): npm test routes/user/connections-grant
 *
 * The lane used to be closed to every provider it did not ship: providers were
 * package files, the authorize URL and the token exchange were one hardcoded
 * shape, and a provider needing PKCE (Kick's OAuth 2.1) could not be connected
 * at all. What this pins is the extension points:
 *
 *   1. a BRAND file (`${Manager.cwd}/connections/<name>.js`) wins over the package's
 *      own, and an unknown name is still the same 400;
 *   2. `pkce: 'S256'` is a DECLARATION — the verifier/challenge pair is the
 *      RFC 7636 one, the authorize URL carries the challenge and the exchange
 *      the verifier, and neither appears for a provider that declares nothing;
 *   3. `authorize` / `exchange` / `refresh` / `revoke` override the defaults and
 *      run as METHODS on the module, so `this.urls.*` keeps working;
 *   4. the default `revoke` is the RFC 7009 POST, and a provider with no
 *      `urls.revoke` answers "unsupported" instead of pretending.
 *
 * Everything here is pure: the one seam is `context.fetch`, which the defaults
 * call and a case hands a recorder. The provider identity checks (Twitch, Kick)
 * stand `wonderful-fetch` in through the require cache the way
 * `connections-log-privacy.test.js` does — the identity APIs are real external
 * services and a normal run never calls one.
 */

const path = require('path');
const jetpack = require('fs-jetpack');

// Stand wonderful-fetch in BEFORE the lane is required — `_grant.js` and the
// packaged providers reach it at module load. Restored in cleanup(), or the
// stub leaks into every file that runs later in this process.
const originalFetchPath = require.resolve('wonderful-fetch');
const originalFetchCacheEntry = require.cache[originalFetchPath];

const identityCalls = [];
let identityResponse = {};

require.cache[originalFetchPath] = {
  id: originalFetchPath,
  filename: originalFetchPath,
  loaded: true,
  exports: async (url, options) => {
    identityCalls.push({ url, options });
    return identityResponse;
  },
};

const postRoute = require('../../../dist/manager/routes/user/connections/post.js');
const deleteRoute = require('../../../dist/manager/routes/user/connections/delete.js');
const twitch = require('../../../dist/manager/routes/user/connections/providers/twitch.js');
const kick = require('../../../dist/manager/routes/user/connections/providers/kick.js');
const spotify = require('../../../dist/manager/routes/user/connections/providers/spotify.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const {
  generatePkcePair,
  pkceChallenge,
  encryptState,
} = require('../../../dist/manager/routes/user/connections/_state.js');
const {
  defaultAuthorize,
  defaultExchange,
  defaultRefresh,
  defaultRevoke,
  runStep,
  REVOKE_UNSUPPORTED,
} = require('../../../dist/manager/routes/user/connections/_grant.js');
const { loadProvider } = require('../../../dist/manager/routes/user/connections/_providers.js');

function restoreFetch() {
  if (originalFetchCacheEntry) {
    require.cache[originalFetchPath] = originalFetchCacheEntry;
  } else {
    delete require.cache[originalFetchPath];
  }
}

// RFC 7636 appendix B — the one published verifier/challenge pair, so the S256
// math is checked against something other than itself.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const PLAIN_PROVIDER = {
  provider: 'plain-fixture',
  name: 'Plain Fixture',
  urls: {
    authorize: 'https://provider.test/authorize',
    token: 'https://provider.test/token',
    revoke: 'https://provider.test/revoke',
  },
  scope: ['identify'],
  params: { prompt: 'consent' },
  async identity() {
    return { id: 'plain-fixture-user' };
  },
};

const PKCE_PROVIDER = {
  ...PLAIN_PROVIDER,
  provider: 'pkce-fixture',
  name: 'PKCE Fixture',
  pkce: 'S256',
};

/** The context the routes hand a step, with a recording fetch seam. */
function stepContext(provider, extra) {
  const calls = [];

  const context = {
    provider,
    providerName: provider.provider,
    Manager: null,
    ctx: { log() {} },
    uid: 'user-793',
    clientId: 'client-id-771',
    clientSecret: 'client-secret-771',
    redirectUri: 'https://brand.test/connections/callback',
    scope: provider.scope || [],
    state: 'encrypted-state-771',
    pkce: null,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { access_token: 'access-771', refresh_token: 'refresh-771' };
    },
    ...extra,
  };

  return { context, calls };
}

/** A throwaway brand provider directory: `${cwd}/connections/<name>.js`. */
function brandDir(files) {
  const dir = jetpack.tmpDir({ prefix: 'omega-connections-771' }).path();

  for (const [name, source] of Object.entries(files)) {
    jetpack.write(path.join(dir, 'connections', `${name}.js`), source);
  }

  return { cwd: dir };
}

/**
 * A Firestore stand-in that records every write — the offline lane has no
 * emulator, and what these cases are about are writes on paths that fail.
 */
function recordingFirestore(usageData) {
  const writes = [];

  const admin = {
    firestore: () => ({
      doc: (docPath) => ({
        get: async () => ({ exists: !!usageData, data: () => usageData }),
        update: async (payload) => writes.push({ verb: 'update', path: docPath, payload }),
        set: async (payload) => writes.push({ verb: 'set', path: docPath, payload }),
      }),
      collection: () => ({ where: () => ({ get: async () => ({ docs: [], size: 0 }) }) }),
    }),
  };

  return { admin, writes };
}

/** The body a step posted, as a plain object. */
function postedBody(call) {
  return Object.fromEntries(new URLSearchParams(call.options.body));
}

module.exports = defineCases({
  description: 'Connections grant: brand providers, PKCE, and the overridable steps',
  type: 'group',

  cleanup() {
    restoreFetch();
  },

  tests: [
    {
      name: 'the-pkce-pair-is-the-rfc-7636-one',

      async run({ assert }) {
        assert.equal(pkceChallenge(RFC_VERIFIER), RFC_CHALLENGE, 'S256 of the published verifier is the published challenge');

        const pair = generatePkcePair();

        assert.equal(pair.verifier.length, 43, `32 random bytes base64url is 43 chars: ${pair.verifier.length}`);
        assert.match(pair.verifier, /^[A-Za-z0-9_-]+$/, 'the verifier is base64url — no +, / or = to be re-encoded in a query');
        assert.match(pair.challenge, /^[A-Za-z0-9_-]+$/, 'and so is the challenge');
        assert.equal(pair.challenge, pkceChallenge(pair.verifier), 'the pair is a real pair');
        assert.notEqual(pair.verifier, generatePkcePair().verifier, 'every authorize mints its own');
      },
    },

    {
      name: 'the-authorize-url-carries-the-challenge-only-for-a-pkce-provider',

      async run({ assert }) {
        const pkce = generatePkcePair();

        const withPkce = new URL(defaultAuthorize(stepContext(PKCE_PROVIDER, { pkce }).context));

        assert.equal(withPkce.searchParams.get('code_challenge'), pkce.challenge, 'the challenge rides the URL');
        assert.equal(withPkce.searchParams.get('code_challenge_method'), 'S256', 'and names its method');
        assert.equal(withPkce.searchParams.get('code_verifier'), null, 'the VERIFIER never leaves the server on this leg');

        // The rest of the URL is what it always was
        assert.equal(withPkce.searchParams.get('client_id'), 'client-id-771', 'the client id');
        assert.equal(withPkce.searchParams.get('redirect_uri'), 'https://brand.test/connections/callback', 'the redirect uri');
        assert.equal(withPkce.searchParams.get('response_type'), 'code', 'the response type');
        assert.equal(withPkce.searchParams.get('state'), 'encrypted-state-771', 'the encrypted state');
        assert.equal(withPkce.searchParams.get('scope'), 'identify', 'the resolved scope, space-joined');
        assert.equal(withPkce.searchParams.get('prompt'), 'consent', "the provider's own `params`");

        const withoutPkce = new URL(defaultAuthorize(stepContext(PLAIN_PROVIDER).context));

        assert.equal(withoutPkce.searchParams.get('code_challenge'), null, 'a provider that declares no PKCE sends none');
        assert.equal(withoutPkce.searchParams.get('code_challenge_method'), null, 'and no method either');
      },
    },

    {
      name: 'the-exchange-body-carries-the-code-verifier-only-for-a-pkce-provider',

      async run({ assert }) {
        const pkce = generatePkcePair();
        const withPkce = stepContext(PKCE_PROVIDER, { pkce, code: 'auth-code-771' });

        const response = await defaultExchange.call(PKCE_PROVIDER, withPkce.context);

        assert.equal(response.access_token, 'access-771', "the step answers the token endpoint's response");
        assert.equal(withPkce.calls.length, 1, 'one call to the token endpoint');
        assert.equal(withPkce.calls[0].url, 'https://provider.test/token', "the provider's ONE token url");
        assert.equal(withPkce.calls[0].options.timeout, 60000, 'the exchange keeps its 60s — it holds no lease');

        const body = postedBody(withPkce.calls[0]);

        assert.equal(body.code_verifier, pkce.verifier, 'the verifier proves the challenge');
        assert.equal(body.grant_type, 'authorization_code', 'the grant type');
        assert.equal(body.code, 'auth-code-771', 'the code');
        assert.equal(body.client_id, 'client-id-771', 'the client id');
        assert.equal(body.client_secret, 'client-secret-771', 'the client secret');
        assert.equal(body.redirect_uri, 'https://brand.test/connections/callback', 'the redirect uri');

        const withoutPkce = stepContext(PLAIN_PROVIDER, { code: 'auth-code-771' });

        await defaultExchange.call(PLAIN_PROVIDER, withoutPkce.context);

        assert.equal(postedBody(withoutPkce.calls[0]).code_verifier, undefined, 'a provider that declares no PKCE sends none');
      },
    },

    {
      name: 'the-default-refresh-posts-the-stored-refresh-token-to-the-same-url',

      async run({ assert }) {
        const { context, calls } = stepContext(PLAIN_PROVIDER, {
          token: { access_token: 'old-access', refresh_token: 'stored-refresh-771' },
        });

        await defaultRefresh.call(PLAIN_PROVIDER, context);

        const body = postedBody(calls[0]);

        assert.equal(calls[0].url, 'https://provider.test/token', 'the exchange and the refresh are ONE endpoint (#793)');
        assert.equal(calls[0].options.timeout, 20000, 'and 20s to answer in: a refresh runs while holding the 30s lease ([#783](https://github.com/Omega-JS-Stack/omega/issues/783)), so it may not outlive it');
        assert.equal(body.grant_type, 'refresh_token', 'the grant type');
        assert.equal(body.refresh_token, 'stored-refresh-771', 'the token the record holds');
        assert.equal(body.code_verifier, undefined, 'a refresh has no verifier to send');
      },
    },

    {
      // #793: revoking used to be a per-provider function with its own
      // signature; it is a step with a default now, and the default is the RFC
      name: 'the-default-revoke-is-the-rfc-7009-post',

      async run({ assert }) {
        const { context, calls } = stepContext(PLAIN_PROVIDER, {
          token: { access_token: 'access-793', refresh_token: 'refresh-793' },
        });

        const answer = await defaultRevoke.call(PLAIN_PROVIDER, context);

        assert.equal(answer, undefined, 'a revoke that worked answers nothing');
        assert.equal(calls[0].url, 'https://provider.test/revoke', "the provider's revoke url");
        assert.equal(calls[0].options.method, 'POST', 'as a POST');

        const body = postedBody(calls[0]);

        assert.equal(body.token, 'access-793', 'carrying the access token');
        assert.equal(body.client_id, 'client-id-771', 'and the client the provider knows this app by');
        assert.equal(body.client_secret, 'client-secret-771', 'with its secret when there is one');

        // A public client has none to send ([#785](https://github.com/Omega-JS-Stack/omega/issues/785))
        const publicClient = stepContext(PLAIN_PROVIDER, { clientSecret: '', token: { access_token: 'access-793' } });

        await defaultRevoke.call(PLAIN_PROVIDER, publicClient.context);

        assert.equal('client_secret' in postedBody(publicClient.calls[0]), false, 'an empty secret is no secret here either');
      },
    },

    {
      name: 'a-provider-with-no-revoke-url-answers-unsupported-and-calls-nothing',

      async run({ assert }) {
        const noRevoke = { ...PLAIN_PROVIDER, urls: { authorize: 'https://provider.test/authorize', token: 'https://provider.test/token' } };
        const { context, calls } = stepContext(noRevoke, { token: { access_token: 'access-793' } });

        const answer = await defaultRevoke.call(noRevoke, context);

        assert.equal(answer, REVOKE_UNSUPPORTED, 'the step says so rather than pretending it revoked');
        assert.equal(calls.length, 0, 'and no request went out');
        assert.equal(spotify.urls.revoke, undefined, 'Spotify is the packaged provider in exactly this position');
      },
    },

    {
      // The record goes whatever the provider says: the user asked to be
      // disconnected, and a provider that cannot revoke does not get a veto
      name: 'the-delete-removes-the-record-even-when-the-revoke-cannot-run',

      async run({ assert }) {
        const Manager = brandDir({
          'unrevokable-793': [
            'module.exports = {',
            "  provider: 'unrevokable-793',",
            "  name: 'Unrevokable',",
            "  urls: { authorize: 'https://brand.test/a', token: 'https://brand.test/t' },",
            "  async identity() { return { id: 'x' }; },",
            '};',
          ].join('\n'),
        });

        const { admin, writes } = recordingFirestore(null);

        Object.assign(Manager, {
          libraries: { admin },
          project: { websiteUrl: 'https://brand.test' },
          config: { brand: { name: 'Test Brand' } },
          Metadata: () => ({ set: () => ({}) }),
        });

        const logged = [];
        const responses = [];
        const ctx = {
          Manager,
          log: (...args) => logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
          respond: (message, options) => {
            responses.push({ message, options: options || {} });
            return { message, options: options || {} };
          },
        };

        await deleteRoute({
          ctx,
          user: {
            authenticated: true,
            auth: { uid: 'user-793' },
            roles: { admin: false },
            connections: { 'unrevokable-793': { token: { access_token: 'access-793' } } },
          },
          settings: { provider: 'unrevokable-793' },
        });

        assert.equal(responses[0].message.success, true, 'the disconnect succeeds');
        assert.ok(logged.some((line) => line.includes('unsupported')), `and the log says the provider could not be told: ${logged.join(' | ')}`);

        const deleted = writes.find((write) => write.path === 'users/user-793' && write.verb === 'update');

        assert.ok(deleted, 'the record is deleted');
        assert.equal('connections.unrevokable-793' in deleted.payload, true, 'and it is the provider entry that went');
      },
    },

    {
      // A PUBLIC client ([#785](https://github.com/Omega-JS-Stack/omega/issues/785)):
      // Twitch registers one, the brand holds a client id and no secret, and the
      // body used to carry `client_secret=` empty — which a token endpoint reads
      // as a WRONG secret, not as no secret, and refuses the grant with it.
      name: 'a-public-client-sends-no-client_secret-key-at-all',

      async run({ assert }) {
        const Manager = brandDir({
          'public-fixture-785': "module.exports = { provider: 'public-fixture-785', name: 'Public Fixture', urls: { authorize: 'https://brand.test/a', token: 'https://brand.test/t' }, async identity() { return { id: 'x' }; } };",
        });

        // The credentials as the LANE resolves them for a provider whose
        // CONNECTIONS_<PROVIDER>_CLIENT_SECRET is not in the brand's .env
        const resolved = loadProvider('public-fixture-785', Manager);

        assert.equal(resolved.clientSecret, undefined, 'an unset CONNECTIONS_<PROVIDER>_CLIENT_SECRET resolves to nothing');

        const exchange = stepContext(PLAIN_PROVIDER, { code: 'auth-code-785', clientSecret: resolved.clientSecret });

        await defaultExchange.call(PLAIN_PROVIDER, exchange.context);

        const exchangeBody = postedBody(exchange.calls[0]);

        assert.equal('client_secret' in exchangeBody, false, 'the KEY is absent from the exchange, not present and empty');
        assert.equal(exchangeBody.client_id, 'client-id-771', 'the client id still rides — that is what a public client identifies with');
        assert.equal(exchangeBody.code, 'auth-code-785', 'and the code');

        const refresh = stepContext(PLAIN_PROVIDER, { clientSecret: resolved.clientSecret, token: { refresh_token: 'stored-refresh-785' } });

        await defaultRefresh.call(PLAIN_PROVIDER, refresh.context);

        assert.equal('client_secret' in postedBody(refresh.calls[0]), false, 'and absent from the refresh too — the same client, the same registration');

        // A brand's `.env` writes an empty value as KEY="", which is the same
        // "no secret" as the key never being there
        const empty = stepContext(PLAIN_PROVIDER, { code: 'auth-code-785', clientSecret: '' });

        await defaultExchange.call(PLAIN_PROVIDER, empty.context);

        assert.equal('client_secret' in postedBody(empty.calls[0]), false, 'an empty secret is no secret');
      },
    },

    {
      // The public-client flow in full: no secret to send, and the PKCE verifier
      // is what proves the exchange in its place
      // ([#771](https://github.com/Omega-JS-Stack/omega/issues/771) +
      // [#785](https://github.com/Omega-JS-Stack/omega/issues/785)).
      name: 'a-public-pkce-client-proves-the-exchange-with-the-verifier',

      async run({ assert }) {
        const pkce = generatePkcePair();
        const { context, calls } = stepContext(PKCE_PROVIDER, { pkce, code: 'auth-code-785', clientSecret: undefined });

        await defaultExchange.call(PKCE_PROVIDER, context);

        const body = postedBody(calls[0]);

        assert.equal('client_secret' in body, false, 'no secret rides — the brand has none');
        assert.equal(body.code_verifier, pkce.verifier, 'and the verifier does, which is what stands in for it');
        assert.equal(body.client_id, 'client-id-771', 'beside the client id');
        assert.equal(body.grant_type, 'authorization_code', 'on the same grant as any other client');
      },
    },

    {
      // The other half of #785: a CONFIDENTIAL client's request may not change
      // by a byte — every provider the lane already serves posts these exact
      // bodies today.
      name: 'a-confidential-clients-bodies-are-unchanged',

      async run({ assert }) {
        const exchange = stepContext(PLAIN_PROVIDER, { code: 'auth-code-785' });

        await defaultExchange.call(PLAIN_PROVIDER, exchange.context);

        assert.equal(
          exchange.calls[0].options.body.toString(),
          'client_id=client-id-771&client_secret=client-secret-771&grant_type=authorization_code&redirect_uri=https%3A%2F%2Fbrand.test%2Fconnections%2Fcallback&code=auth-code-785',
          'the exchange body, field for field and in order',
        );

        const refresh = stepContext(PLAIN_PROVIDER, { token: { refresh_token: 'stored-refresh-785' } });

        await defaultRefresh.call(PLAIN_PROVIDER, refresh.context);

        assert.equal(
          refresh.calls[0].options.body.toString(),
          'client_id=client-id-771&client_secret=client-secret-771&grant_type=refresh_token&refresh_token=stored-refresh-785',
          'and the refresh body',
        );
      },
    },

    {
      name: 'an-override-runs-as-a-method-and-its-answer-is-the-one-used',

      async run({ assert }) {
        const seen = {};

        const provider = {
          ...PLAIN_PROVIDER,
          provider: 'override-fixture',
          authorize(context) {
            seen.authorizeThis = this;
            seen.authorizeContext = context;
            // `this.urls.*` is the shape every shipped provider already uses
            return `${this.urls.authorize}?custom=1`;
          },
          async exchange() {
            seen.exchangeThis = this;
            return { access_token: 'from-the-override' };
          },
          async refresh() {
            seen.refreshThis = this;
            return { access_token: 'refreshed-by-the-override' };
          },
          async revoke() {
            seen.revokeThis = this;
          },
        };

        const { context, calls } = stepContext(provider, { code: 'auth-code-771', token: { access_token: 'a', refresh_token: 'r' } });

        const url = await runStep(provider, 'authorize', context);
        const exchanged = await runStep(provider, 'exchange', context);
        const refreshed = await runStep(provider, 'refresh', context);

        await runStep(provider, 'revoke', context);

        assert.equal(url, 'https://provider.test/authorize?custom=1', "the override's URL is the one used");
        assert.equal(exchanged.access_token, 'from-the-override', "the override's token response is the one used");
        assert.equal(refreshed.access_token, 'refreshed-by-the-override', "the override's refresh is the one used");
        assert.equal(calls.length, 0, 'and no default ran behind it');

        assert.equal(seen.authorizeThis, provider, '`this` is the provider module, so this.urls.* works');
        assert.equal(seen.exchangeThis, provider, 'the exchange too');
        assert.equal(seen.refreshThis, provider, 'the refresh');
        assert.equal(seen.revokeThis, provider, 'and the revoke');
        assert.equal(seen.authorizeContext.provider, provider, 'the context carries the module, so an override never needs `this`');
        assert.equal(seen.authorizeContext.providerName, 'override-fixture', 'and the name it was loaded by');
        assert.equal(seen.authorizeContext.uid, 'user-793', 'and the user the connect is for (#793)');

        // A provider that overrides nothing runs the defaults through the SAME call
        const url2 = await runStep(PLAIN_PROVIDER, 'authorize', stepContext(PLAIN_PROVIDER).context);

        assert.match(url2, /^https:\/\/provider\.test\/authorize\?/, 'no override means the default step');
      },
    },

    {
      name: 'a-brand-provider-file-wins-over-the-package-one',

      async run({ assert }) {
        const shape = "urls: { authorize: 'https://brand.test/a', token: 'https://brand.test/t' }, async identity() { return { id: 'x' }; }";

        const Manager = brandDir({
          google: `module.exports = { provider: 'google', name: 'Brand Google', ${shape} };`,
          'house-provider': `module.exports = { provider: 'house-provider', name: 'House', ${shape} };`,
        });

        const shadowed = loadProvider('google', Manager);

        assert.equal(shadowed.connectionProvider.name, 'Brand Google', "the brand's own file wins for a name the package also ships");

        const brandOnly = loadProvider('house-provider', Manager);

        assert.equal(brandOnly.connectionProvider.name, 'House', 'a provider only the brand has loads');

        const packaged = loadProvider('google', { cwd: jetpack.tmpDir({ prefix: 'omega-connections-771-empty' }).path() });

        assert.equal(packaged.connectionProvider.name, 'Google', 'with no brand file, the package provider still loads');

        const noBrand = loadProvider('discord', null);

        assert.equal(noBrand.connectionProvider.provider, 'discord', 'and a caller with no Manager reads the package dir alone');
      },
    },

    {
      name: 'an-unknown-provider-is-still-the-same-400',

      async run({ assert }) {
        const Manager = brandDir({});

        const unknown = loadProvider('not-a-provider', Manager);

        assert.equal(unknown.error.code, 400, 'the code the route answers');
        assert.equal(unknown.error.message, 'Unknown connection provider: not-a-provider', 'and the message it has always answered');

        const traversal = loadProvider('../../../../etc/passwd', Manager);

        assert.equal(traversal.error.code, 400, 'a name that could escape the directory is just unknown');
      },
    },

    {
      name: 'a-provider-file-missing-its-shape-fails-loudly-at-load',

      async run({ assert }) {
        const identity = "async identity() { return { id: 'x' }; }";

        const Manager = brandDir({
          'no-authorize': `module.exports = { provider: 'no-authorize', urls: { token: 'https://brand.test/t' }, ${identity} };`,
          'no-token': `module.exports = { provider: 'no-token', urls: { authorize: 'https://brand.test/a' }, ${identity} };`,
          'no-identity': "module.exports = { provider: 'no-identity', urls: { authorize: 'https://brand.test/a', token: 'https://brand.test/t' } };",
          'bad-pkce': `module.exports = { provider: 'bad-pkce', pkce: 'plain', urls: { authorize: 'https://brand.test/a', token: 'https://brand.test/t' }, ${identity} };`,
        });

        const expected = [
          ['no-authorize', 'urls.authorize'],
          ['no-token', 'urls.token'],
          ['no-identity', 'identity()'],
          ['bad-pkce', 'pkce'],
        ];

        for (const [name, missing] of expected) {
          let thrown = null;

          try {
            loadProvider(name, Manager);
          } catch (e) {
            thrown = e;
          }

          assert.ok(thrown, `${name} is a broken provider, not an unknown one — it throws`);
          assert.equal(thrown.message.includes(`${name}.js`), true, `the message names the file: ${thrown.message}`);
          assert.equal(thrown.message.includes(missing), true, `and the missing field: ${thrown.message}`);
          assert.equal(thrown.message.includes(Manager.cwd), false, `never the deployed path, which is not a caller's to see: ${thrown.message}`);
        }
      },
    },

    {
      // The verifier is a ONE-TIME secret. It used to be deleted only on the
      // success path, so an exchange that failed (or an identity check that
      // threw, or a provider that answered no refresh_token) left it in
      // `usage/<uid>` to be replayed with the same code.
      name: 'a-failing-exchange-still-clears-the-one-time-session',

      async run({ assert }) {
        const uid = 'user-771';
        const providerName = 'failing-exchange';
        const Manager = brandDir({
          [providerName]: [
            'module.exports = {',
            `  provider: '${providerName}',`,
            "  name: 'Failing Exchange',",
            "  urls: { authorize: 'https://brand.test/a', token: 'https://brand.test/t' },",
            "  pkce: 'S256',",
            "  async exchange() { throw new Error('the provider said no'); },",
            "  async identity() { return { id: 'x' }; },",
            '};',
          ].join('\n'),
        });

        const { admin, writes } = recordingFirestore({
          connections: { [providerName]: { csrf: 'csrf-771', verifier: 'verifier-771', createdAt: Date.now() } },
        });

        Object.assign(Manager, {
          libraries: { admin },
          project: { websiteUrl: 'https://brand.test' },
          config: { brand: { name: 'Test Brand' } },
          Metadata: () => ({ set: () => ({}) }),
        });

        const responses = [];
        const ctx = {
          Manager,
          log() {},
          respond: (message, options) => {
            responses.push({ message, options });
            return { message, options };
          },
          meta: { startTime: { timestamp: 'now', timestampUNIX: 1 } },
        };

        const encryptedState = encryptState({ provider: providerName, uid, csrf: 'csrf-771', ts: Date.now() });

        await postRoute({ ctx, user: {}, settings: { action: 'tokenize', code: 'auth-code-771', encryptedState } });

        assert.equal(responses[0].options.code, 500, 'the exchange failure is still reported');
        assert.equal(responses[0].message.includes('Token exchange failed'), true, `with its own message: ${responses[0].message}`);

        const sessionDelete = writes.find((write) => write.path === `usage/${uid}` && write.verb === 'update');

        assert.ok(sessionDelete, 'the one-time session was cleared even though the exchange failed');
        assert.equal(`connections.${providerName}` in sessionDelete.payload, true, 'and it is the provider entry that was deleted');
        assert.equal(writes.some((write) => write.path.startsWith('users/')), false, 'nothing was recorded on the user — there was no token to record');
      },
    },

    {
      name: 'twitch-identifies-against-helix-with-the-client-id-from-the-context',

      async run({ assert }) {
        identityCalls.length = 0;
        identityResponse = { data: [{ id: 'twitch-1', login: 'ianwieds', email: 'buyer@example.com' }] };

        assert.equal(twitch.pkce, undefined, 'Twitch is a plain authorization-code provider');
        assert.equal(typeof twitch.urls.authorize, 'string', 'it declares an authorize url');

        // The env read is GONE ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)):
        // the credentials ride the context, resolved once by the lane. A stale
        // env value must not be able to reach the call.
        const originalClientId = process.env.CONNECTIONS_TWITCH_CLIENT_ID;
        process.env.CONNECTIONS_TWITCH_CLIENT_ID = 'never-read-793';

        let identity;

        try {
          identity = await twitch.identity({
            ctx: { log() {} },
            uid: 'user-771',
            clientId: 'twitch-client-771',
            token: { access_token: 'access-771', token_type: 'Bearer' },
            fetch: require('wonderful-fetch'),
          });
        } finally {
          if (originalClientId === undefined) {
            delete process.env.CONNECTIONS_TWITCH_CLIENT_ID;
          } else {
            process.env.CONNECTIONS_TWITCH_CLIENT_ID = originalClientId;
          }
        }

        assert.equal(identity.id, 'twitch-1', "the helix payload's user is the identity, not the envelope");
        assert.equal(identity.login, 'ianwieds', 'with its fields intact');
        assert.equal(identityCalls[0].url, 'https://api.twitch.tv/helix/users', 'the users endpoint');
        assert.equal(identityCalls[0].options.headers['Client-Id'], 'twitch-client-771', "Twitch requires the app id beside the token, and it is the CONTEXT's");
        assert.equal(identityCalls[0].options.headers.authorization, 'Bearer access-771', 'and the bearer token');
      },
    },

    {
      name: 'kick-revokes-at-its-own-endpoint-and-stringifies-its-user-id',

      async run({ assert }) {
        identityCalls.length = 0;
        identityResponse = {};

        assert.equal(kick.pkce, 'S256', 'Kick is OAuth 2.1 — PKCE is not optional there');

        await kick.revoke({
          ctx: { log() {} },
          clientId: 'kick-client-771',
          clientSecret: 'kick-secret-771',
          token: { access_token: 'access-771' },
          fetch: require('wonderful-fetch'),
        });

        assert.equal(identityCalls[0].url, kick.urls.revoke, "the provider's own revoke url");
        assert.equal(identityCalls[0].options.method, 'POST', 'as a POST');

        const body = Object.fromEntries(new URLSearchParams(identityCalls[0].options.body));

        assert.equal(body.token, 'access-771', 'carrying the token');
        assert.equal(body.token_hint_type, 'access_token', 'and the hint Kick wants beside it');

        // Kick's public API answers `user_id` as a NUMBER, and the route matches
        // on a string id
        identityCalls.length = 0;
        identityResponse = { data: [{ user_id: 8675309, name: 'ianwieds', email: 'buyer@example.com' }] };

        const identity = await kick.identity({
          ctx: { log() {} },
          uid: 'user-771',
          token: { access_token: 'access-771', token_type: 'Bearer' },
          fetch: require('wonderful-fetch'),
        });

        assert.equal(identity.id, '8675309', 'the id is the stringified user_id');
        assert.equal(identity.user_id, 8675309, "and Kick's own field is stored as it answered it");
        assert.equal(identityCalls[0].url, 'https://api.kick.com/public/v1/users', 'the users endpoint');
        assert.equal(identityCalls[0].options.headers.authorization, 'Bearer access-771', 'with the bearer token');
      },
    },
  ],
});
