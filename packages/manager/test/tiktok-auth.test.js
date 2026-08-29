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
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('tiktok-auth: a token already in the environment is converged — nothing is asked or called', async () => {
  process.env.TIKTOK_ACCESS_TOKEN = 'already-there';
  const context = makeContext({ tiktokExchange: () => { throw new Error('must not exchange'); } });
  try {
    assert.equal(await acquireTikTokToken(context, TIKTOK_PIXEL), true);
  } finally {
    cleanupRoot(context);
  }
});

test('tiktok-auth: a headless run never prompts — it steps aside for the guidance', async () => {
  delete process.env.TIKTOK_ACCESS_TOKEN;
  const context = makeContext({ tiktokExchange: () => { throw new Error('must not exchange'); } });
  try {
    assert.equal(await acquireTikTokToken(context, TIKTOK_PIXEL), false);
    assert.equal(process.env.TIKTOK_ACCESS_TOKEN, undefined);
  } finally {
    cleanupRoot(context);
  }
});

test('tiktok-auth: the one-pass authorization pastes the secret, walks the portal, and persists ONLY the token', async () => {
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

    assert.equal(ok, true);
    // Exchanged inline, with the app id from config
    assert.deepEqual(exchanged, [{ appId: '7300000000000000000', secret: 'app-secret-value', authCode: 'AUTHCODE123' }]);
    // The app page was OFFERED (never auto-opened), then the PASTED authorization URL
    assert.equal(opened.length, 2);
    assert.equal(opened[0][0], 'https://business-api.tiktok.com/portal/apps/7300000000000000000');
    assert.equal(opened[1][0], 'https://business-api.tiktok.com/portal/auth?app_id=7300000000000000000&state=your_custom_params&redirect_uri=https%3A%2F%2Fitwcreativeworks.com');

    // ONLY the long-lived token is persisted — the secret was mint-time only
    const env = fs.readFileSync(path.join(context.brandRoot, '.env'), 'utf8');
    assert.match(env, /TIKTOK_ACCESS_TOKEN="long-lived-token"/);
    assert.doesNotMatch(env, /app-secret-value/);
    assert.doesNotMatch(env, /TIKTOK_APP_SECRET/);
    assert.doesNotMatch(env, /AUTHCODE123/);
    assert.equal(process.env.TIKTOK_ACCESS_TOKEN, 'long-lived-token');
  } finally {
    tty.close();
    cleanupRoot(context);
  }
});

test('tiktok-auth: an empty secret or auth code ends the pass with nothing written', async () => {
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

    assert.equal(ok, false);
    assert.equal(process.env.TIKTOK_ACCESS_TOKEN, undefined);
    assert.equal(fs.existsSync(path.join(context.brandRoot, '.env')), false);
  } finally {
    tty.close();
    cleanupRoot(context);
  }
});

test('tiktok-auth: a failed exchange warns and writes nothing — the walk continues', async () => {
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

    assert.equal(ok, false);
    assert.equal(process.env.TIKTOK_ACCESS_TOKEN, undefined);
    assert.equal(fs.existsSync(path.join(context.brandRoot, '.env')), false);
    assert.match(lines.join('\n'), /invalid auth_code/);
  } finally {
    console.log = original;
    tty.close();
    cleanupRoot(context);
  }
});

test('tiktok-auth: no app id + headless → the pass ends, nothing asked and nothing landed', async () => {
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

  assert.equal(ok, false);
  // Nothing landed in config either — a headless run never prompts
  assert.doesNotMatch(readConfigSource(context.brandRoot), /appId/);
  cleanupRoot(context);
});

test('tiktok-auth: a missing app id is ASKED for, lands in omega.json5, and the SAME pass mints the token', async () => {
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

    assert.equal(ok, true);
    // The developer-portal page is where an app id comes from
    assert.deepEqual(opened, ['https://business-api.tiktok.com/portal/apps']);
    // Landed in config (comment-preserving) and in memory
    assert.match(readConfigSource(context.brandRoot), /appId: "7399999999999999999"/);
    assert.match(readConfigSource(context.brandRoot), /\/\/ the app id lands here/);
    assert.equal(context.brandConfig.analytics.providers.tiktok.appId, '7399999999999999999');
    // ...and the mint continued in the SAME pass, on the id just entered
    assert.deepEqual(exchanged, [{ appId: '7399999999999999999', secret: 'app-secret-value', authCode: 'AUTHCODE123' }]);
    assert.match(fs.readFileSync(path.join(context.brandRoot, '.env'), 'utf8'), /TIKTOK_ACCESS_TOKEN="minted-token"/);
  } finally {
    setBrowserOpener(null);
    tty.close();
    cleanupRoot(context);
  }
});

test('tiktok-api: the exchange posts app_id + secret + auth_code and carries NO Access-Token header', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { access_token: 'tt-long-lived' } }) };
  };

  const token = await exchangeAuthCode({ appId: '73', secret: 's', authCode: 'c' }, fetchImpl);

  assert.equal(token, 'tt-long-lived');
  assert.equal(calls[0].url, 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/');
  assert.deepEqual(JSON.parse(calls[0].init.body), { app_id: '73', secret: 's', auth_code: 'c' });
  assert.equal(calls[0].init.headers['Access-Token'], undefined);
});

test('tiktok-api: a non-zero code on the exchange is an error, never a silent empty token', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ code: 40002, message: 'invalid auth_code' }) });

  await assert.rejects(
    () => exchangeAuthCode({ appId: '73', secret: 's', authCode: 'bad' }, fetchImpl),
    /invalid auth_code/,
  );
});

test('tiktok-api: the setup opens the APP PAGE and takes the app\'s own authorization URL — never a built one', () => {
  assert.equal(TIKTOK_APP_URL('7676623375900344340'), 'https://business-api.tiktok.com/portal/apps/7676623375900344340');
  const auth = 'https://business-api.tiktok.com/portal/auth?app_id=7676623375900344340&state=your_custom_params&redirect_uri=https%3A%2F%2Fitwcreativeworks.com';
  assert.equal(isAuthUrlFor(auth, '7676623375900344340'), true);
  assert.equal(isAuthUrlFor(auth, '1'), false);
  assert.equal(isAuthUrlFor('https://business-api.tiktok.com/portal/apps/7676623375900344340', '7676623375900344340'), false);
  assert.equal(isAuthUrlFor('not a url', '7676623375900344340'), false);
});

test('tiktok-api: the auth_code is read out of the pasted redirect URL, or taken bare', () => {
  assert.equal(parseAuthCode('https://itwcreativeworks.com/?auth_code=ABC123&code=ABC123&state=your_custom_params'), 'ABC123');
  assert.equal(parseAuthCode('ABC123'), 'ABC123');
  assert.equal(parseAuthCode('https://itwcreativeworks.com/?state=x'), '');
  assert.equal(parseAuthCode(''), '');
});
