/**
 * TikTok pixel authorization (#448) — the setup mints the Events API token
 * instead of demanding a standing .env key: the app secret is asked for ONCE
 * (never persisted), the portal authorization is walked with the Enter-gated
 * open, the pasted auth_code is exchanged inline, and ONLY the long-lived
 * TIKTOK_ACCESS_TOKEN lands in the brand .env.
 *
 * TikTok is NEVER called for real here — the exchange rides an injected seam,
 * and the one shape test drives a fake fetch.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { setBrowserOpener } = require('@omega.js/devkit/flows');

const { acquireTikTokToken } = require('../src/services/analytics/lib/tiktok-auth.js');
const { exchangeAuthCode, TIKTOK_APP_URL, isAuthUrlFor, parseAuthCode } = require('../src/services/analytics/lib/tiktok-api.js');
const { TIKTOK_PIXEL } = require('../src/services/analytics/lib/pixel-specs.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

delete process.env.TIKTOK_ACCESS_TOKEN;

const CONFIG_SOURCE = '{\n  brand: { id: "b", name: "Brand" },\n  analytics: { providers: { tiktok: { appId: "7300000000000000000" } } },\n}\n';

function makeContext(overrides = {}) {
  const brandRoot = overrides.brandRoot || makeBrandRoot(CONFIG_SOURCE);
  return {
    brandId: 'b',
    brandRoot,
    brandConfig: {
      brand: { id: 'b', name: 'Brand' },
      analytics: { providers: { tiktok: { appId: '7300000000000000000' } } },
    },
    options: {},
    ...overrides,
  };
}

function cleanupRoot(context) {
  delete process.env.TIKTOK_ACCESS_TOKEN;
  fs.rmSync(context.brandRoot, { recursive: true, force: true });
}

module.exports = defineCases({
  type: 'group',
  description: 'tiktok-auth',
  tests: [
    {
      name: 'tiktok-auth: a token already in the environment is converged — nothing is asked or called',
      run: async (ctx) => {
        process.env.TIKTOK_ACCESS_TOKEN = 'already-there';
        const context = makeContext({ tiktokExchange: () => { throw new Error('must not exchange'); } });
        try {
          ctx.expect(await acquireTikTokToken(context, TIKTOK_PIXEL)).toBe(true);
        } finally {
          cleanupRoot(context);
        }
      },
    },

    {
      name: 'tiktok-auth: a headless run never prompts — it steps aside for the guidance',
      run: async (ctx) => {
        delete process.env.TIKTOK_ACCESS_TOKEN;
        const context = makeContext({ tiktokExchange: () => { throw new Error('must not exchange'); } });
        try {
          ctx.expect(await acquireTikTokToken(context, TIKTOK_PIXEL)).toBe(false);
          ctx.expect(process.env.TIKTOK_ACCESS_TOKEN).toBe(undefined);
        } finally {
          cleanupRoot(context);
        }
      },
    },

    {
      name: 'tiktok-auth: the one-pass authorization pastes the secret, walks the portal, and persists ONLY the token',
      run: async (ctx) => {
        delete process.env.TIKTOK_ACCESS_TOKEN;
        const opened = [];
        const exchanged = [];
        const context = makeContext({
          tiktokExchange: async (params) => { exchanged.push(params); return 'long-lived-token'; },
        });

        const tty = openTtyPrompt();
        try {
          const run = acquireTikTokToken(context, TIKTOK_PIXEL, {
            gate: false,
            prompt: { pressEnterToOpen: async (url, label) => { opened.push([url, label]); return true; } },
          });
          await tty.answer('TikTok app secret', 'app-secret-value\r');
          await tty.answer('Advertiser authorization URL', 'https://business-api.tiktok.com/portal/auth?app_id=7300000000000000000&state=your_custom_params&redirect_uri=https%3A%2F%2Fitwcreativeworks.com\r');
          await tty.answer('redirect URL', 'AUTHCODE123\r');
          const ok = await run;

          ctx.expect(ok).toBe(true);
          // Exchanged inline, with the app id from config
          ctx.expect(exchanged).toEqual([{ appId: '7300000000000000000', secret: 'app-secret-value', authCode: 'AUTHCODE123' }]);
          // The app page was OFFERED (never auto-opened), then the PASTED authorization URL
          ctx.expect(opened.length).toBe(2);
          ctx.expect(opened[0][0]).toBe('https://business-api.tiktok.com/portal/apps/7300000000000000000');
          ctx.expect(opened[1][0]).toBe('https://business-api.tiktok.com/portal/auth?app_id=7300000000000000000&state=your_custom_params&redirect_uri=https%3A%2F%2Fitwcreativeworks.com');

          // ONLY the long-lived token is persisted — the secret was mint-time only
          const env = fs.readFileSync(path.join(context.brandRoot, '.env'), 'utf8');
          ctx.expect(env).toMatch(/TIKTOK_ACCESS_TOKEN="long-lived-token"/);
          ctx.expect(env).not.toMatch(/app-secret-value/);
          ctx.expect(env).not.toMatch(/TIKTOK_APP_SECRET/);
          ctx.expect(env).not.toMatch(/AUTHCODE123/);
          ctx.expect(process.env.TIKTOK_ACCESS_TOKEN).toBe('long-lived-token');
        } finally {
          tty.close();
          cleanupRoot(context);
        }
      },
    },

    {
      name: 'tiktok-auth: an empty secret or auth code ends the pass with nothing written',
      run: async (ctx) => {
        delete process.env.TIKTOK_ACCESS_TOKEN;
        const context = makeContext({ tiktokExchange: () => { throw new Error('must not exchange'); } });

        const tty = openTtyPrompt();
        try {
          const run = acquireTikTokToken(context, TIKTOK_PIXEL, {
            gate: false,
            prompt: { pressEnterToOpen: async () => true },
          });
          await tty.answer('TikTok app secret', '\r');
          const ok = await run;

          ctx.expect(ok).toBe(false);
          ctx.expect(process.env.TIKTOK_ACCESS_TOKEN).toBe(undefined);
          ctx.expect(fs.existsSync(path.join(context.brandRoot, '.env'))).toBe(false);
        } finally {
          tty.close();
          cleanupRoot(context);
        }
      },
    },

    {
      name: 'tiktok-auth: a failed exchange warns and writes nothing — the walk continues',
      run: async (ctx) => {
        delete process.env.TIKTOK_ACCESS_TOKEN;
        const context = makeContext({
          tiktokExchange: async () => { throw new Error('TikTok API error (40002): invalid auth_code'); },
        });

        const tty = openTtyPrompt();
        const lines = [];
        const original = console.log;
        console.log = (...args) => lines.push(args.join(' '));
        try {
          const run = acquireTikTokToken(context, TIKTOK_PIXEL, {
            gate: false,
            prompt: { pressEnterToOpen: async () => true },
          });
          await tty.answer('TikTok app secret', 'secret\r');
          await tty.answer('Advertiser authorization URL', 'https://business-api.tiktok.com/portal/auth?app_id=7300000000000000000&state=your_custom_params&redirect_uri=https%3A%2F%2Fitwcreativeworks.com\r');
          await tty.answer('redirect URL', 'BAD\r');
          const ok = await run;

          ctx.expect(ok).toBe(false);
          ctx.expect(process.env.TIKTOK_ACCESS_TOKEN).toBe(undefined);
          ctx.expect(fs.existsSync(path.join(context.brandRoot, '.env'))).toBe(false);
          ctx.expect(lines.join('\n')).toMatch(/invalid auth_code/);
        } finally {
          console.log = original;
          tty.close();
          cleanupRoot(context);
        }
      },
    },

    {
      name: 'tiktok-auth: no app id + headless → the pass ends, nothing asked and nothing landed',
      run: async (ctx) => {
        delete process.env.TIKTOK_ACCESS_TOKEN;
        const context = makeContext({
          brandRoot: makeBrandRoot('{\n  brand: { id: "b" },\n  analytics: { providers: { tiktok: {} } },\n}\n'),
          tiktokExchange: () => { throw new Error('must not exchange'); },
        });
        context.brandConfig.analytics.providers.tiktok = {};

        const ok = await acquireTikTokToken(context, TIKTOK_PIXEL, {
          gate: false,
          // The secret must never be asked for without an app id to exchange with
          prompt: { password: () => { throw new Error('must not ask for the secret'); } },
        });

        ctx.expect(ok).toBe(false);
        // Nothing landed in config either — a headless run never prompts
        ctx.expect(readConfigSource(context.brandRoot)).not.toMatch(/appId/);
        cleanupRoot(context);
      },
    },

    {
      name: 'tiktok-auth: a missing app id is ASKED for, lands in omega.json5, and the SAME pass mints the token',
      run: async (ctx) => {
        delete process.env.TIKTOK_ACCESS_TOKEN;
        const opened = [];
        const exchanged = [];
        const context = makeContext({
          brandRoot: makeBrandRoot('{\n  brand: { id: "b" },\n  analytics: { providers: { tiktok: {} } }, // the app id lands here\n}\n'),
          tiktokExchange: async (params) => { exchanged.push(params); return 'minted-token'; },
        });
        context.brandConfig.analytics.providers.tiktok = {};

        setBrowserOpener(async (url) => { opened.push(url); return true; });
        const tty = openTtyPrompt();
        try {
          const run = acquireTikTokToken(context, TIKTOK_PIXEL, {
            gate: false,
            prompt: { pressEnterToOpen: async () => true },
          });
          await tty.answer('TikTok developer app id', '7399999999999999999\r');
          await tty.answer('TikTok app secret', 'app-secret-value\r');
          await tty.answer('Advertiser authorization URL', 'https://business-api.tiktok.com/portal/auth?app_id=7399999999999999999&state=your_custom_params&redirect_uri=https%3A%2F%2Fitwcreativeworks.com\r');
          await tty.answer('redirect URL', 'AUTHCODE123\r');
          const ok = await run;

          ctx.expect(ok).toBe(true);
          // The developer-portal page is where an app id comes from
          ctx.expect(opened).toEqual(['https://business-api.tiktok.com/portal/apps']);
          // Landed in config (comment-preserving) and in memory
          ctx.expect(readConfigSource(context.brandRoot)).toMatch(/appId: "7399999999999999999"/);
          ctx.expect(readConfigSource(context.brandRoot)).toMatch(/\/\/ the app id lands here/);
          ctx.expect(context.brandConfig.analytics.providers.tiktok.appId).toBe('7399999999999999999');
          // ...and the mint continued in the SAME pass, on the id just entered
          ctx.expect(exchanged).toEqual([{ appId: '7399999999999999999', secret: 'app-secret-value', authCode: 'AUTHCODE123' }]);
          ctx.expect(fs.readFileSync(path.join(context.brandRoot, '.env'), 'utf8')).toMatch(/TIKTOK_ACCESS_TOKEN="minted-token"/);
        } finally {
          setBrowserOpener(null);
          tty.close();
          cleanupRoot(context);
        }
      },
    },

    {
      name: 'tiktok-api: the exchange posts app_id + secret + auth_code and carries NO Access-Token header',
      run: async (ctx) => {
        const calls = [];
        const fetchImpl = async (url, init) => {
          calls.push({ url, init });
          return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { access_token: 'tt-long-lived' } }) };
        };

        const token = await exchangeAuthCode({ appId: '73', secret: 's', authCode: 'c' }, fetchImpl);

        ctx.expect(token).toBe('tt-long-lived');
        ctx.expect(calls[0].url).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/');
        ctx.expect(JSON.parse(calls[0].init.body)).toEqual({ app_id: '73', secret: 's', auth_code: 'c' });
        ctx.expect(calls[0].init.headers['Access-Token']).toBe(undefined);
      },
    },

    {
      name: 'tiktok-api: a non-zero code on the exchange is an error, never a silent empty token',
      run: async (ctx) => {
        const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 40002, message: 'invalid auth_code' }) });

        await ctx.expect((() => exchangeAuthCode({ appId: '73', secret: 's', authCode: 'bad' }, fetchImpl))()).rejects.toThrow(/invalid auth_code/);
      },
    },

    {
      name: 'tiktok-api: the setup opens the APP PAGE and takes the app\'s own authorization URL — never a built one',
      run: (ctx) => {
        ctx.expect(TIKTOK_APP_URL('7676623375900344340')).toBe('https://business-api.tiktok.com/portal/apps/7676623375900344340');
        const auth = 'https://business-api.tiktok.com/portal/auth?app_id=7676623375900344340&state=your_custom_params&redirect_uri=https%3A%2F%2Fitwcreativeworks.com';
        ctx.expect(isAuthUrlFor(auth, '7676623375900344340')).toBe(true);
        ctx.expect(isAuthUrlFor(auth, '1')).toBe(false);
        ctx.expect(isAuthUrlFor('https://business-api.tiktok.com/portal/apps/7676623375900344340', '7676623375900344340')).toBe(false);
        ctx.expect(isAuthUrlFor('not a url', '7676623375900344340')).toBe(false);
      },
    },

    {
      name: 'tiktok-api: the auth_code is read out of the pasted redirect URL, or taken bare',
      run: (ctx) => {
        ctx.expect(parseAuthCode('https://itwcreativeworks.com/?auth_code=ABC123&code=ABC123&state=your_custom_params')).toBe('ABC123');
        ctx.expect(parseAuthCode('ABC123')).toBe('ABC123');
        ctx.expect(parseAuthCode('https://itwcreativeworks.com/?state=x')).toBe('');
        ctx.expect(parseAuthCode('')).toBe('');
      },
    },
  ],
});
