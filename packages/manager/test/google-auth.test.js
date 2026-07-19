/**
 * Google auth tests — the ONE-consent model: union scope list, shared
 * scope-aware token store (a cached token missing any requested scope
 * re-consents instead of 403ing), and the headless fail-fast (also covered
 * from the pipeline side in pipeline.test.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GoogleOAuth2Client, GOOGLE_SCOPES, googleTokenStorePath } = require('../src/lib/google-auth.js');

function tmpStore(tokens) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-google-auth-'));
  const storePath = path.join(dir, 'tokens.json');
  if (tokens) {
    fs.writeFileSync(storePath, JSON.stringify(tokens));
  }
  return storePath;
}

function client(storePath) {
  return new GoogleOAuth2Client({
    clientId: 'x',
    clientSecret: 'y',
    scopes: GOOGLE_SCOPES,
    tokenStorePath: storePath,
  });
}

test('google-auth: GOOGLE_SCOPES is the manager-wide union, no duplicates', () => {
  const required = [
    'https://www.googleapis.com/auth/firebase',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/webmasters',
    'https://www.googleapis.com/auth/siteverification',
    'https://www.googleapis.com/auth/analytics.edit',
    'https://www.googleapis.com/auth/adsense.readonly',
  ];
  for (const scope of required) {
    assert.ok(GOOGLE_SCOPES.includes(scope), `missing ${scope}`);
  }
  assert.equal(new Set(GOOGLE_SCOPES).size, GOOGLE_SCOPES.length);
});

test('google-auth: every service shares ONE token store path', () => {
  assert.equal(googleTokenStorePath('/brand'), path.join('/brand', '.omega', 'auth', 'google-tokens.json'));
});

test('google-auth: cached token with the full scope grant serves without any flow', async () => {
  const storePath = tmpStore({
    access_token: 'cached-token',
    refresh_token: 'r',
    expiry: Date.now() + 3_600_000,
    scopes: [...GOOGLE_SCOPES],
  });

  const token = await client(storePath).getAccessToken();
  assert.equal(token, 'cached-token');
});

test('google-auth: a pre-union store (no scopes recorded) re-consents instead of 403ing forever', async () => {
  const storePath = tmpStore({
    access_token: 'legacy-token',
    refresh_token: 'r',
    expiry: Date.now() + 3_600_000,
  });

  process.env.OMEGA_NON_INTERACTIVE = '1';
  try {
    // Headless, so the re-consent surfaces as the fail-fast error — proving
    // the cached-but-underscoped token was NOT accepted
    await assert.rejects(client(storePath).getAccessToken(), /Google consent required/);
  } finally {
    delete process.env.OMEGA_NON_INTERACTIVE;
  }
});

test('google-auth: a subset grant re-consents too', async () => {
  const storePath = tmpStore({
    access_token: 'narrow-token',
    refresh_token: 'r',
    expiry: Date.now() + 3_600_000,
    scopes: ['https://www.googleapis.com/auth/firebase'],
  });

  process.env.OMEGA_NON_INTERACTIVE = '1';
  try {
    await assert.rejects(client(storePath).getAccessToken(), /Google consent required/);
  } finally {
    delete process.env.OMEGA_NON_INTERACTIVE;
  }
});

test('google-auth: saveTokens records the granted scopes', () => {
  const storePath = tmpStore(null);
  const auth = client(storePath);

  auth.saveTokens({ access_token: 'a', refresh_token: 'r', expiry: 123 });

  const written = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.deepEqual(written.scopes, GOOGLE_SCOPES);
  assert.equal(written.access_token, 'a');
});

// ═══ Permission-seam diagnostics (2026-07-19 live find: the manage identity
// had no role on a hand-minted project and the raw 403 diagnosed nothing) ═══

function stubFetch(response) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: response.ok,
    status: response.status,
    headers: { get: () => null },
    json: async () => response.body,
  });
  return () => { global.fetch = original; };
}

function cachedStore(extra = {}) {
  return tmpStore({
    access_token: 'cached-token',
    refresh_token: 'r',
    expiry: Date.now() + 3_600_000,
    scopes: [...GOOGLE_SCOPES],
    ...extra,
  });
}

test('google-auth: 403s name the acting identity, grant command, and re-consent path', async () => {
  const storePath = cachedStore({ account_email: 'itw.creative.works@gmail.com' });
  const restore = stubFetch({
    ok: false,
    status: 403,
    body: { error: { message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } },
  });
  try {
    await assert.rejects(
      client(storePath).makeRequest('https://cloudbilling.googleapis.com/v1/projects/omegajs/billingInfo'),
      (err) => {
        assert.match(err.message, /The caller does not have permission/, 'keeps the raw API message');
        assert.match(err.message, /acting Google identity: itw\.creative\.works@gmail\.com/, 'names the acting account');
        assert.ok(err.message.includes(storePath), 'names the token store');
        assert.ok(
          err.message.includes('gcloud projects add-iam-policy-binding omegajs --member=user:itw.creative.works@gmail.com --role=roles/owner'),
          'gives the exact grant command with the project parsed from the URL',
        );
        assert.match(err.message, /consent as an owning account/, 'offers the re-consent alternative');
        assert.equal(err.status, 'PERMISSION_DENIED');
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('google-auth: non-permission errors stay undecorated', async () => {
  const storePath = cachedStore();
  const restore = stubFetch({
    ok: false,
    status: 400,
    body: { error: { message: 'Invalid argument', status: 'INVALID_ARGUMENT' } },
  });
  try {
    await assert.rejects(
      client(storePath).makeRequest('https://firebase.googleapis.com/v1beta1/projects/omegajs'),
      (err) => {
        assert.match(err.message, /Invalid argument/);
        assert.ok(!err.message.includes('acting Google identity'), 'no identity block on non-403s');
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('google-auth: saveTokens merges over the store — refresh saves keep account_email', () => {
  const storePath = cachedStore({ account_email: 'itw.creative.works@gmail.com' });

  client(storePath).saveTokens({ access_token: 'new-token', refresh_token: 'r', expiry: 456 });

  const written = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(written.access_token, 'new-token', 'new token written');
  assert.equal(written.account_email, 'itw.creative.works@gmail.com', 'sidecar identity survives the refresh save');
});
