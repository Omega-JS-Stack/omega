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

const { GoogleOAuth2Client, GOOGLE_SCOPES, googleTokenStorePath, startAuthUrlReprint } = require('../src/lib/google-auth.js');

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

// ═══ One consent session per run + the stable-line reprint (#56: the live
// run burned three loopback urls in six minutes, and the human was still
// reading the first one, dead by the time it was clicked) ═══

/** A client whose browser flow is the injected fake (the one network seam). */
function flowClient(storePath, flow) {
  class TestClient extends GoogleOAuth2Client {
    performOAuth2Flow() {
      return flow();
    }
  }
  return new TestClient({ clientId: 'x', clientSecret: 'y', scopes: GOOGLE_SCOPES, tokenStorePath: storePath });
}

test('google-auth: concurrent callers join ONE consent session per run (#56)', async () => {
  const storePath = tmpStore(null);
  let flows = 0;
  const releases = [];
  const flow = () => {
    flows += 1;
    return new Promise((resolve) => { releases.push(resolve); });
  };

  const pending = Promise.all([
    flowClient(storePath, flow).getAccessToken(),
    flowClient(storePath, flow).getAccessToken(),
  ]);
  await new Promise(setImmediate);
  // Assert BEFORE releasing: a regression to two flows must fail here, not
  // strand the first promise and time the whole file out.
  assert.equal(flows, 1, 'the second service joined the open session instead of minting another url');
  releases.forEach((release) => release('fresh-token'));

  assert.deepEqual(await pending, ['fresh-token', 'fresh-token']);
});

test('google-auth: a failed consent session is not replaced by a new url later in the run (#56)', async () => {
  const storePath = tmpStore(null);
  let flows = 0;
  const flow = () => {
    flows += 1;
    return Promise.reject(new Error('Authentication timed out'));
  };

  await assert.rejects(flowClient(storePath, flow).getAccessToken(), /Authentication timed out/);
  await assert.rejects(flowClient(storePath, flow).getAccessToken(), /Authentication timed out/);

  assert.equal(flows, 1, 'the next service reports the same dead session, it does not open a second one');
});

test('google-auth: a completed session releases the run slot so a token gone bad can re-consent', async () => {
  const storePath = tmpStore(null);
  let flows = 0;
  const flow = () => {
    flows += 1;
    return Promise.resolve(`token-${flows}`);
  };

  assert.equal(await flowClient(storePath, flow).getAccessToken(), 'token-1');
  assert.equal(await flowClient(storePath, flow).getAccessToken(), 'token-2');
});

test('google-auth: the consent url reprints on a stable line while the flow is open (#56)', async () => {
  const lines = [];
  const stop = startAuthUrlReprint('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', {
    intervalMs: 10,
    expiresAt: Date.now() + 300_000,
    log: (line) => lines.push(line),
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  stop();
  const printedWhileOpen = lines.length;
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(printedWhileOpen >= 2, `reprinted while waiting (got ${printedWhileOpen} lines)`);
  const printed = lines.join('\n');
  assert.match(printed, /accounts\.google\.com\/o\/oauth2\/v2\/auth\?client_id=x/, 'reprints the live url');
  assert.match(printed, /min left/, 'says how long the url has');
  assert.equal(lines.length, printedWhileOpen, 'stops the moment the flow settles');
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
