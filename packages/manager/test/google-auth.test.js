/**
 * Google auth tests — the ONE-consent model: union scope list, shared
 * scope-aware token store (a cached token missing any requested scope
 * re-consents instead of 403ing), and the headless fail-fast (also covered
 * from the pipeline side in pipeline.test.js).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GoogleOAuth2Client, GOOGLE_SCOPES, googleTokenStorePath, startAuthUrlReprint, CONSENT_REQUIRED } = require('../src/lib/google-auth.js');

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

module.exports = defineCases({
  type: 'group',
  description: 'google-auth',
  tests: [
    {
      name: 'google-auth: GOOGLE_SCOPES is the manager-wide union, no duplicates',
      run: (ctx) => {
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
          ctx.expect(GOOGLE_SCOPES.includes(scope), `missing ${scope}`).toBeTruthy();
        }
        ctx.expect(new Set(GOOGLE_SCOPES).size).toBe(GOOGLE_SCOPES.length);
      },
    },

    {
      name: 'google-auth: every service shares ONE token store path',
      run: (ctx) => {
        ctx.expect(googleTokenStorePath('/brand')).toBe(path.join('/brand', '.omega', 'auth', 'google-tokens.json'));
      },
    },

    {
      name: 'google-auth: cached token with the full scope grant serves without any flow',
      run: async (ctx) => {
        const storePath = tmpStore({
          access_token: 'cached-token',
          refresh_token: 'r',
          expiry: Date.now() + 3_600_000,
          scopes: [...GOOGLE_SCOPES],
        });

        const token = await client(storePath).getAccessToken();
        ctx.expect(token).toBe('cached-token');
      },
    },

    {
      name: 'google-auth: a pre-union store (no scopes recorded) re-consents instead of 403ing forever',
      run: async (ctx) => {
        const storePath = tmpStore({
          access_token: 'legacy-token',
          refresh_token: 'r',
          expiry: Date.now() + 3_600_000,
        });

        process.env.OMEGA_NON_INTERACTIVE = '1';
        try {
          // Headless, so the re-consent surfaces as the fail-fast error — proving
          // the cached-but-underscoped token was NOT accepted
          await ctx.expect(client(storePath).getAccessToken()).rejects.toThrow(/Google consent required/);
        } finally {
          delete process.env.OMEGA_NON_INTERACTIVE;
        }
      },
    },

    {
      name: 'google-auth: a subset grant re-consents too',
      run: async (ctx) => {
        const storePath = tmpStore({
          access_token: 'narrow-token',
          refresh_token: 'r',
          expiry: Date.now() + 3_600_000,
          scopes: ['https://www.googleapis.com/auth/firebase'],
        });

        process.env.OMEGA_NON_INTERACTIVE = '1';
        try {
          await ctx.expect(client(storePath).getAccessToken()).rejects.toThrow(/Google consent required/);
        } finally {
          delete process.env.OMEGA_NON_INTERACTIVE;
        }
      },
    },

    {
      name: 'google-auth: the headless consent throw is CODED — a pending human gate, not a failure (#228)',
      run: async (ctx) => {
        ctx.expect(typeof CONSENT_REQUIRED, 'the code is exported so the runner can match on it').toBe('string');

        const storePath = tmpStore({
          access_token: 'legacy-token',
          refresh_token: 'r',
          expiry: Date.now() + 3_600_000,
        });

        process.env.OMEGA_NON_INTERACTIVE = '1';
        try {
          await ctx.expect(client(storePath).getAccessToken()).rejects.toThrow((error) => {
            ctx.expect(error.code, 'the walk classes it by code, never by message sniffing').toBe(CONSENT_REQUIRED);
            ctx.expect(error.message).toMatch(/Google consent required/);
            return true;
          });
        } finally {
          delete process.env.OMEGA_NON_INTERACTIVE;
        }
      },
    },

    {
      name: 'google-auth: saveTokens records the granted scopes',
      run: (ctx) => {
        const storePath = tmpStore(null);
        const auth = client(storePath);

        auth.saveTokens({ access_token: 'a', refresh_token: 'r', expiry: 123 });

        const written = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        ctx.expect(written.scopes).toEqual(GOOGLE_SCOPES);
        ctx.expect(written.access_token).toBe('a');
      },
    },

    {
      name: 'google-auth: concurrent callers join ONE consent session per run (#56)',
      run: async (ctx) => {
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
        ctx.expect(flows, 'the second service joined the open session instead of minting another url').toBe(1);
        releases.forEach((release) => release('fresh-token'));

        ctx.expect(await pending).toEqual(['fresh-token', 'fresh-token']);
      },
    },

    {
      name: 'google-auth: a failed consent session is not replaced by a new url later in the run (#56)',
      run: async (ctx) => {
        const storePath = tmpStore(null);
        let flows = 0;
        const flow = () => {
          flows += 1;
          return Promise.reject(new Error('Authentication timed out'));
        };

        await ctx.expect(flowClient(storePath, flow).getAccessToken()).rejects.toThrow(/Authentication timed out/);
        await ctx.expect(flowClient(storePath, flow).getAccessToken()).rejects.toThrow(/Authentication timed out/);

        ctx.expect(flows, 'the next service reports the same dead session, it does not open a second one').toBe(1);
      },
    },

    {
      name: 'google-auth: a completed session releases the run slot so a token gone bad can re-consent',
      run: async (ctx) => {
        const storePath = tmpStore(null);
        let flows = 0;
        const flow = () => {
          flows += 1;
          return Promise.resolve(`token-${flows}`);
        };

        ctx.expect(await flowClient(storePath, flow).getAccessToken()).toBe('token-1');
        ctx.expect(await flowClient(storePath, flow).getAccessToken()).toBe('token-2');
      },
    },

    {
      name: 'google-auth: the consent url reprints on a stable line while the flow is open (#56)',
      run: async (ctx) => {
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

        ctx.expect(printedWhileOpen >= 2, `reprinted while waiting (got ${printedWhileOpen} lines)`).toBeTruthy();
        const printed = lines.join('\n');
        ctx.expect(printed, 'reprints the live url').toMatch(/accounts\.google\.com\/o\/oauth2\/v2\/auth\?client_id=x/);
        ctx.expect(printed, 'says how long the url has').toMatch(/min left/);
        ctx.expect(lines.length, 'stops the moment the flow settles').toBe(printedWhileOpen);
      },
    },

    {
      name: 'google-auth: 403s name the acting identity, grant command, and re-consent path',
      run: async (ctx) => {
        const storePath = cachedStore({ account_email: 'itw.creative.works@gmail.com' });
        const restore = stubFetch({
          ok: false,
          status: 403,
          body: { error: { message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } },
        });
        try {
          await ctx.expect(client(storePath).makeRequest('https://cloudbilling.googleapis.com/v1/projects/omegajs/billingInfo')).rejects.toThrow((err) => {
              ctx.expect(err.message, 'keeps the raw API message').toMatch(/The caller does not have permission/);
              ctx.expect(err.message, 'names the acting account').toMatch(/acting Google identity: itw\.creative\.works@gmail\.com/);
              ctx.expect(err.message.includes(storePath), 'names the token store').toBeTruthy();
              ctx.expect(err.message.includes('gcloud projects add-iam-policy-binding omegajs --member=user:itw.creative.works@gmail.com --role=roles/owner'), 'gives the exact grant command with the project parsed from the URL').toBeTruthy();
              ctx.expect(err.message, 'offers the re-consent alternative').toMatch(/consent as an owning account/);
              ctx.expect(err.status).toBe('PERMISSION_DENIED');
              return true;
            });
        } finally {
          restore();
        }
      },
    },

    {
      name: 'google-auth: non-permission errors stay undecorated',
      run: async (ctx) => {
        const storePath = cachedStore();
        const restore = stubFetch({
          ok: false,
          status: 400,
          body: { error: { message: 'Invalid argument', status: 'INVALID_ARGUMENT' } },
        });
        try {
          await ctx.expect(client(storePath).makeRequest('https://firebase.googleapis.com/v1beta1/projects/omegajs')).rejects.toThrow((err) => {
              ctx.expect(err.message).toMatch(/Invalid argument/);
              ctx.expect(!err.message.includes('acting Google identity'), 'no identity block on non-403s').toBeTruthy();
              return true;
            });
        } finally {
          restore();
        }
      },
    },

    {
      name: 'google-auth: saveTokens merges over the store — refresh saves keep account_email',
      run: (ctx) => {
        const storePath = cachedStore({ account_email: 'itw.creative.works@gmail.com' });

        client(storePath).saveTokens({ access_token: 'new-token', refresh_token: 'r', expiry: 456 });

        const written = JSON.parse(fs.readFileSync(storePath, 'utf8'));
        ctx.expect(written.access_token, 'new token written').toBe('new-token');
        ctx.expect(written.account_email, 'sidecar identity survives the refresh save').toBe('itw.creative.works@gmail.com');
      },
    },
  ],
});
