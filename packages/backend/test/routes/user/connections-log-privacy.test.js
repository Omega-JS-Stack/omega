/**
 * Test: routes/user/connections provider log privacy
 * A provider's identity check logs WHICH provider, WHOSE account and whether the
 * token exchange succeeded — never the exchange response, never the profile
 * ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
 *
 * Run (from the framework repo): npm test routes/user/connections-log-privacy
 *
 * Every provider used to open its identity check with
 * `ctx.log('verifyIdentity(): tokenizeResult', tokenizeResult)`, which wrote the
 * access token, the refresh token and (Google) the id token into Cloud Logging in
 * plain text, for the whole retention window — anyone with a log-viewer role on a
 * brand's project could read users' live third-party credentials. Google logged the
 * decoded profile beside it and Discord/Spotify the provider's identity response,
 * which is the user's PII. Discord's and Spotify's identity fetches also carried
 * `log: true`, and wonderful-fetch prints its whole configuration — headers
 * included, and that request's authorization header IS the access token.
 *
 * The seam is the one [#632] established: the assertions read the captured `ctx`
 * output. The call is allowed to REJECT after the line under test is written (the
 * hand-rolled Manager has no Firestore behind it), exactly as
 * `signup-log-privacy.test.js` does.
 *
 * The one stand-in is `wonderful-fetch`, replaced in the require cache and restored
 * in `cleanup()` — the identity APIs are real external services, and the framework's
 * rule is that a normal run never calls one (`webhook-forward.test.js` sets this
 * pattern). It answers with a profile precisely so the assertion that no identity
 * response reaches a log has something to have leaked.
 */

// Replace wonderful-fetch BEFORE the providers are required — each does
// `require('wonderful-fetch')` at module load. Restored in cleanup() below, or the
// stub leaks into every test file that runs later in the same process.
const originalFetchPath = require.resolve('wonderful-fetch');
const originalFetchCacheEntry = require.cache[originalFetchPath];

const IDENTITY = { id: 'provider-user-1', user_id: 'provider-user-1', email: 'buyer@example.com', username: 'ianwieds', display_name: 'Ian Wiedenman' };

// One answer both identity shapes read: the flat profile Discord and Spotify
// return, and the `data: [user]` envelope Twitch's Helix and Kick's public API
// return. Either way it is the user's PII, which is the point of the leak check.
require.cache[originalFetchPath] = {
  id: originalFetchPath,
  filename: originalFetchPath,
  loaded: true,
  exports: async () => ({ ...IDENTITY, data: [{ ...IDENTITY }] }),
};

const google = require('../../../dist/manager/routes/user/connections/providers/google.js');
const discord = require('../../../dist/manager/routes/user/connections/providers/discord.js');
const spotify = require('../../../dist/manager/routes/user/connections/providers/spotify.js');
const twitch = require('../../../dist/manager/routes/user/connections/providers/twitch.js');
const kick = require('../../../dist/manager/routes/user/connections/providers/kick.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

function restoreFetch() {
  if (originalFetchCacheEntry) {
    require.cache[originalFetchPath] = originalFetchCacheEntry;
  } else {
    delete require.cache[originalFetchPath];
  }
}

const UID = 'user-641';
const ACCESS_TOKEN = 'ya29.fake_access_token_641';
const REFRESH_TOKEN = '1//fake_refresh_token_641';

// A real id_token shape — jwt-decode only base64url-decodes it, and what it decodes
// to is the profile Google's provider used to log.
const ID_TOKEN_CLAIMS = { sub: 'google-641', email: 'buyer@example.com', name: 'Ian Wiedenman' };
const ID_TOKEN = [
  Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(ID_TOKEN_CLAIMS)).toString('base64url'),
  'fake_signature_641',
].join('.');

const TOKENIZE_RESULT = {
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN,
  id_token: ID_TOKEN,
  token_type: 'Bearer',
  expires_in: 3599,
  scope: 'openid email profile',
};

// The material that must never appear on a line, whatever shape it is logged in.
const SECRETS = [ACCESS_TOKEN, REFRESH_TOKEN, ID_TOKEN, 'access_token', 'refresh_token', 'id_token'];
const PII = ['buyer@example.com', 'Ian Wiedenman', 'ianwieds', 'provider-user-1'];

/**
 * Run one provider's identity() step and return every line it wrote.
 * Console is captured too: `log: true` on a provider's fetch would print there.
 */
async function captureIdentityCheck(provider) {
  const captured = [];
  const record = (...args) => captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

  const ctx = { log: record, warn: record, error: record };

  const originalConsoleLog = console.log;
  console.log = record;

  try {
    // The ONE context every step takes ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)):
    // `token` is the exchange response, and `fetch` is the seam the stand-in
    // above answers on
    await provider.identity({
      ctx,
      uid: UID,
      clientId: 'client-id-641',
      token: { ...TOKENIZE_RESULT },
      fetch: require('wonderful-fetch'),
    }).catch(() => {});
  } finally {
    console.log = originalConsoleLog;
  }

  return captured;
}

function assertPrivate({ assert, lines, provider }) {
  const joined = lines.join(' | ');

  for (const secret of SECRETS) {
    assert.equal(joined.includes(secret), false, `${provider} logged a credential: ${joined}`);
  }

  for (const value of PII) {
    assert.equal(joined.includes(value), false, `${provider} logged the user's PII: ${joined}`);
  }

  const line = lines.find((l) => l.includes('identity()'));

  assert.ok(line, `${provider} logged no identity-check line at all: ${joined}`);
  assert.equal(line.includes(`provider=${provider}`), true, `the line names the provider: ${line}`);
  assert.equal(line.includes(UID), true, `the line names the account: ${line}`);
  assert.equal(line.includes('tokenExchange=succeeded'), true, `and whether the exchange worked: ${line}`);
}

module.exports = defineCases({
  description: 'Connections provider log privacy (provider + uid + outcome, never the tokens)',
  type: 'group',

  // Restore the real wonderful-fetch so the require-cache stand-in cannot leak.
  cleanup() {
    restoreFetch();
  },

  tests: [
    {
      name: 'google-logs-the-check-not-the-token-exchange-or-the-decoded-profile',

      async run({ assert }) {
        assertPrivate({ assert, lines: await captureIdentityCheck(google), provider: 'google' });
      },
    },

    {
      name: 'discord-logs-the-check-not-the-token-exchange-or-the-identity-response',

      async run({ assert }) {
        assertPrivate({ assert, lines: await captureIdentityCheck(discord), provider: 'discord' });
      },
    },

    {
      name: 'spotify-logs-the-check-not-the-token-exchange-or-the-identity-response',

      async run({ assert }) {
        assertPrivate({ assert, lines: await captureIdentityCheck(spotify), provider: 'spotify' });
      },
    },

    {
      name: 'twitch-logs-the-check-not-the-token-exchange-or-the-identity-response',

      async run({ assert }) {
        assertPrivate({ assert, lines: await captureIdentityCheck(twitch), provider: 'twitch' });
      },
    },

    {
      name: 'kick-logs-the-check-not-the-token-exchange-or-the-identity-response',

      async run({ assert }) {
        assertPrivate({ assert, lines: await captureIdentityCheck(kick), provider: 'kick' });
      },
    },

    {
      // A failed exchange still gets a line — that IS the outcome the line reports,
      // and a route that answered 400 with nothing logged was the other half of why
      // the response object was being dumped in the first place.
      name: 'a-token-exchange-that-came-back-empty-says-so',

      async run({ assert }) {
        const captured = [];
        const ctx = { log: (...args) => captured.push(args.join(' ')), warn: () => {}, error: () => {} };

        await google.identity({ ctx, uid: UID, token: { id_token: ID_TOKEN } }).catch(() => {});

        assert.equal(captured[0].includes('tokenExchange=failed'), true, `the line reports the failure: ${captured[0]}`);
      },
    },
  ],
});
