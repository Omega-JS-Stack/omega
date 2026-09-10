// Unit tests for src/license.js — the deploy-time license verdict (#320).
//
// The endpoint is a CONSTANT (the omega brand's own api host), so there is no
// base-URL seam to aim a local server at: `transport` is the injected fetch and
// every case here runs fully offline.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveLicenseVerdict, resolveLicenseStamp, licenseStamp, KEYLESS_STAMP, LICENSE_ENDPOINT } = require('../src/license.js');

// A brand that is NOT a demo-* project — the only shape that reaches the server.
const LIVE_CONFIG = { brand: { id: 'acme' }, cloud: { config: { projectId: 'acme-prod' } } };
const DEMO_CONFIG = { brand: { id: 'naked-brand' }, cloud: { config: { projectId: 'demo-naked-brand' } } };

// A transport that records its calls and answers with what the test hands it.
function stubTransport(answer) {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (typeof answer === 'function') return answer(url, options);
    return answer;
  };
  transport.calls = calls;
  return transport;
}

// The `{ user }` body GET /user responds with, wrapped as a fetch Response.
function userResponse(user, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ user }),
  };
}

const PAID_USER = { subscription: { product: { id: 'pro' }, status: 'active' } };
const BASIC_USER = { subscription: { product: { id: 'basic' }, status: 'active' } };
const CANCELLED_USER = { subscription: { product: { id: 'pro' }, status: 'cancelled' } };

test('the endpoint is the omega brand api host, hardcoded', () => {
  assert.equal(LICENSE_ENDPOINT, 'https://api.omegajs.dev/omega/user');
});

test('no key: the keyless verdict, and nothing is asked of the network', async () => {
  const transport = stubTransport(userResponse(PAID_USER));

  const verdict = await resolveLicenseVerdict({ config: LIVE_CONFIG, env: {}, transport });

  assert.deepEqual(transport.calls, [], 'a keyless context never calls the license server');
  assert.equal(verdict.licensed, false);
  assert.equal(verdict.payments, 'gated');
  assert.equal(verdict.attribution, 'shown');
  assert.match(verdict.reason, /OMEGA_LICENSE_KEY/);
});

test('an empty/whitespace key is no key', async () => {
  const transport = stubTransport(userResponse(PAID_USER));

  for (const value of ['', '   ']) {
    const verdict = await resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: value }, transport });
    assert.equal(verdict.licensed, false);
  }

  assert.deepEqual(transport.calls, [], 'nothing to send means nothing is sent');
});

test('a demo-* project is keyless-dev forever, key present or not (spec call 5)', async () => {
  const transport = stubTransport(userResponse(PAID_USER));

  const verdict = await resolveLicenseVerdict({
    config: DEMO_CONFIG,
    env: { OMEGA_LICENSE_KEY: 'live-key' },
    transport,
  });

  assert.deepEqual(transport.calls, [], 'the test brands never phone the license server');
  assert.equal(verdict.licensed, false);
  assert.equal(verdict.payments, 'gated');
  assert.equal(verdict.attribution, 'shown');
  assert.match(verdict.reason, /demo-naked-brand/);
});

test('a paid plan is the LICENSED verdict — payments live, attribution removed', async () => {
  const transport = stubTransport(userResponse(PAID_USER));

  const verdict = await resolveLicenseVerdict({
    config: LIVE_CONFIG,
    env: { OMEGA_LICENSE_KEY: 'live-key' },
    transport,
  });

  assert.equal(verdict.licensed, true);
  assert.equal(verdict.payments, 'live');
  assert.equal(verdict.attribution, 'removed');
  assert.match(verdict.reason, /pro/);
});

test('the request carries the key and the brand id (the server counts brands per key)', async () => {
  const transport = stubTransport(userResponse(PAID_USER));

  await resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'live-key' }, transport });

  assert.equal(transport.calls.length, 1);
  const url = new URL(transport.calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, LICENSE_ENDPOINT);
  assert.equal(url.searchParams.get('apiKey'), 'live-key');
  assert.equal(url.searchParams.get('brandId'), 'acme');
});

test('a real account with no live subscription is a keyless verdict, not a throw', async () => {
  // The `basic` sentinel IS "no subscription": a free omegajs.dev account, and
  // a cancelled one, which resolves to the same plan.
  for (const user of [BASIC_USER, CANCELLED_USER]) {
    const transport = stubTransport(userResponse(user));

    const verdict = await resolveLicenseVerdict({
      config: LIVE_CONFIG,
      env: { OMEGA_LICENSE_KEY: 'free-account-key' },
      transport,
    });

    assert.equal(verdict.licensed, false);
    assert.equal(verdict.payments, 'gated');
    assert.equal(verdict.attribution, 'shown');
    assert.match(verdict.reason, /no active omegajs\.dev subscription/);
  }
});

test('an unreachable server THROWS — a key present is never a quiet gate', async () => {
  const transport = stubTransport(() => { throw new Error('getaddrinfo ENOTFOUND api.omegajs.dev'); });

  await assert.rejects(
    () => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'live-key' }, transport }),
    /could not be reached.*ENOTFOUND/s,
  );
});

test('a rejected key THROWS — a typo must never ship a gated artifact for a paying brand', async () => {
  const transport = stubTransport(userResponse(null, { status: 401 }));

  await assert.rejects(
    () => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'typod-key' }, transport }),
    /rejected.*401/s,
  );
});

test('a key that resolves NOBODY throws too (a 200 with no user)', async () => {
  const transport = stubTransport(userResponse(undefined));

  await assert.rejects(
    () => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'ghost-key' }, transport }),
    /resolved no account/,
  );
});

test('an unreadable answer throws — never a silent gate', async () => {
  const transport = stubTransport({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
  });

  await assert.rejects(
    () => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'live-key' }, transport }),
    /could not be read/,
  );
});

// ─── The stamp: what every consumer records (#320, half 2) ───

test('the stamp is the verdict without the reason — one shape for every target', () => {
  const licensed = licenseStamp({ licensed: true, payments: 'live', attribution: 'removed', reason: 'licensed by the omegajs.dev "pro" subscription' });

  assert.deepEqual(licensed, { status: 'licensed', payments: 'live', attribution: 'removed' });
  assert.equal('reason' in licensed, false, 'the reason names the account plan — a shipped artifact is public');
  assert.deepEqual(
    licenseStamp({ licensed: false, payments: 'gated', attribution: 'shown', reason: 'no key' }),
    KEYLESS_STAMP,
  );
});

test('a build that runs no check stamps keyless, and asks the network nothing', async () => {
  const transport = stubTransport(userResponse(PAID_USER));

  const stamp = await resolveLicenseStamp({
    config: LIVE_CONFIG,
    production: false,
    env: { OMEGA_LICENSE_KEY: 'live-key' },
    transport,
  });

  assert.deepEqual(transport.calls, [], 'no check runs outside a production build (spec call 5)');
  assert.deepEqual(stamp, { status: 'keyless', payments: 'gated', attribution: 'shown' });
});

test('a production build stamps the resolved verdict', async () => {
  const transport = stubTransport(userResponse(PAID_USER));

  const stamp = await resolveLicenseStamp({
    config: LIVE_CONFIG,
    production: true,
    env: { OMEGA_LICENSE_KEY: 'live-key' },
    transport,
  });

  assert.equal(transport.calls.length, 1);
  assert.deepEqual(stamp, { status: 'licensed', payments: 'live', attribution: 'removed' });
});

test('a production build with a dead key throws — the stamp lane gates the deploy too', async () => {
  const transport = stubTransport(userResponse(null, { status: 401 }));

  await assert.rejects(
    () => resolveLicenseStamp({ config: LIVE_CONFIG, production: true, env: { OMEGA_LICENSE_KEY: 'typod-key' }, transport }),
    /rejected.*401/s,
  );
});
