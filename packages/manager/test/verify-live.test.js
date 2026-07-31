/**
 * Live-verification tests — every check runs against INJECTED transports
 * (a fake fetch, a fake DNS resolver); no test ever touches the network.
 * The gating path proves a demo-only brand never even calls a transport.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveVerifySurface, checkSite, checkDomain, checkCloudflare, runVerifyLegs, VERIFY_LEGS } = require('../src/lib/verify-live.js');

const HTML = `<!doctype html><html><head><title>Paperloom</title></head><body>${'x'.repeat(600)}</body></html>`;

/** Fake fetch returning one canned response; records the URLs it saw. */
function fakeFetch({ status = 200, headers = { 'content-type': 'text/html; charset=utf-8' }, body = HTML, throws = null } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (throws) throw new Error(throws);
    return {
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

/** Fake DNS resolver: resolves for every host except those in `fails`. */
function fakeResolve(fails = []) {
  const calls = [];
  const impl = async (host) => {
    calls.push(host);
    if (fails.includes(host)) throw new Error(`queryA ENOTFOUND ${host}`);
    return ['203.0.113.7'];
  };
  impl.calls = calls;
  return impl;
}

const LIVE_BRAND = { brand: { url: 'https://playground.omegajs.dev' }, cloud: { config: { projectId: 'omegajs-playground' } } };
const DEMO_BRAND = { brand: { url: 'https://sandbox-brand.example.com' }, cloud: { config: { projectId: 'demo-sandbox-brand' } } };

test('verify: surface resolves the canonical URL and the apex + www hostnames', () => {
  const surface = resolveVerifySurface({ brand: { url: 'https://omegajs.dev' }, cloud: { config: { projectId: 'omegajs' } } });
  assert.equal(surface.gated, null);
  assert.equal(surface.url, 'https://omegajs.dev');
  assert.deepEqual(surface.hostnames, ['omegajs.dev', 'www.omegajs.dev']);
});

test('verify: a subdomain brand verifies only its own host (www belongs to the apex brand)', () => {
  const surface = resolveVerifySurface(LIVE_BRAND);
  assert.deepEqual(surface.hostnames, ['playground.omegajs.dev']);
});

test('verify: a demo-* brand is gated with a reason; a brand without brand.url too', () => {
  assert.match(resolveVerifySurface(DEMO_BRAND).gated, /demo-sandbox-brand.*emulator-only/);
  assert.match(resolveVerifySurface({ cloud: { config: { projectId: 'omegajs' } } }).gated, /no brand\.url configured/);
});

test('verify: a brand with a URL but NO cloud project is gated, not checked live', () => {
  const surface = resolveVerifySurface({ brand: { url: 'https://omegajs.dev' } });
  assert.match(surface.gated, /no cloud project configured/);
});

test('verify site: 200 + text/html + a non-trivial body passes', async () => {
  const fetchImpl = fakeFetch();
  const result = await checkSite(resolveVerifySurface(LIVE_BRAND), { fetch: fetchImpl });

  assert.equal(result.status, 'success');
  assert.equal(result.error, null);
  assert.deepEqual(fetchImpl.calls, ['https://playground.omegajs.dev']);
});

test('verify site: a non-200 fails, naming the status', async () => {
  const result = await checkSite(resolveVerifySurface(LIVE_BRAND), { fetch: fakeFetch({ status: 404 }) });
  assert.equal(result.status, 'error');
  assert.match(result.error, /404/);
});

test('verify site: the wrong content-type fails, naming what came back', async () => {
  const result = await checkSite(resolveVerifySurface(LIVE_BRAND), { fetch: fakeFetch({ headers: { 'content-type': 'application/json' } }) });
  assert.equal(result.status, 'error');
  assert.match(result.error, /application\/json/);
});

test('verify site: a trivial body fails (a 200 empty shell is not a live site)', async () => {
  const result = await checkSite(resolveVerifySurface(LIVE_BRAND), { fetch: fakeFetch({ body: '<html></html>' }) });
  assert.equal(result.status, 'error');
  assert.match(result.error, /body/);
});

test('verify site: a transport throw fails the check, carrying the message', async () => {
  const result = await checkSite(resolveVerifySurface(LIVE_BRAND), { fetch: fakeFetch({ throws: 'ECONNREFUSED' }) });
  assert.equal(result.status, 'error');
  assert.match(result.error, /ECONNREFUSED/);
});

test('verify domain: every hostname resolving passes; a failure names the host', async () => {
  const surface = resolveVerifySurface({ brand: { url: 'https://omegajs.dev' }, cloud: { config: { projectId: 'omegajs' } } });

  const resolve = fakeResolve();
  const ok = await checkDomain(surface, { resolve });
  assert.equal(ok.status, 'success');
  assert.deepEqual(resolve.calls, ['omegajs.dev', 'www.omegajs.dev']);

  const bad = await checkDomain(surface, { resolve: fakeResolve(['www.omegajs.dev']) });
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /www\.omegajs\.dev/);
});

test('verify cloudflare: cf-ray or server: cloudflare passes, neither fails', async () => {
  const surface = resolveVerifySurface(LIVE_BRAND);

  const ray = await checkCloudflare(surface, { fetch: fakeFetch({ headers: { 'content-type': 'text/html', 'cf-ray': '8f3a1b2c3d4e5f60-IAD' } }) });
  assert.equal(ray.status, 'success');

  const server = await checkCloudflare(surface, { fetch: fakeFetch({ headers: { 'content-type': 'text/html', server: 'cloudflare' } }) });
  assert.equal(server.status, 'success');

  const bare = await checkCloudflare(surface, { fetch: fakeFetch({ headers: { 'content-type': 'text/html', server: 'GitHub.com' } }) });
  assert.equal(bare.status, 'error');
  assert.match(bare.error, /cloudflare/i);
});

test('verify legs: a deployed web target runs site + domain + cloudflare as verify:<name> rows', async () => {
  const fetchImpl = fakeFetch({ headers: { 'content-type': 'text/html', 'cf-ray': '8f3a-IAD' } });
  const rows = await runVerifyLegs(['web'], LIVE_BRAND, { fetch: fetchImpl, resolve: fakeResolve() });

  assert.deepEqual(rows.map((row) => row.service), ['verify:site', 'verify:domain', 'verify:cloudflare']);
  assert.ok(rows.every((row) => row.status === 'success'));
});

test('verify legs: a target with no live surface contributes no rows', async () => {
  assert.deepEqual(Object.keys(VERIFY_LEGS), ['web']);
  const rows = await runVerifyLegs(['backend'], LIVE_BRAND, { fetch: fakeFetch(), resolve: fakeResolve() });
  assert.deepEqual(rows, []);
});

test('verify legs: a demo-only brand records gated skips and touches NO transport', async () => {
  const fetchImpl = fakeFetch();
  const resolve = fakeResolve();
  const rows = await runVerifyLegs(['web'], DEMO_BRAND, { fetch: fetchImpl, resolve });

  assert.deepEqual(rows.map((row) => row.service), ['verify:site', 'verify:domain', 'verify:cloudflare']);
  assert.ok(rows.every((row) => row.status === 'skipped'));
  assert.match(rows[0].reason, /demo-sandbox-brand.*emulator-only/);
  assert.deepEqual(fetchImpl.calls, [], 'no network for a demo brand');
  assert.deepEqual(resolve.calls, [], 'no DNS for a demo brand');
});

test('verify legs: a brand with no cloud project records gated skips, never a live check', async () => {
  const fetchImpl = fakeFetch();
  const rows = await runVerifyLegs(['web'], { brand: { url: 'https://omegajs.dev' } }, { fetch: fetchImpl, resolve: fakeResolve() });

  assert.ok(rows.every((row) => row.status === 'skipped'));
  assert.match(rows[0].reason, /no cloud project configured/);
  assert.deepEqual(fetchImpl.calls, []);
});

test('verify legs: a dry run plans the sweep — skip rows, zero transport calls', async () => {
  const exploding = () => { throw new Error('a dry run must never touch the network'); };
  const rows = await runVerifyLegs(['web'], LIVE_BRAND, { fetch: exploding, resolve: exploding }, { dryRun: true });

  assert.deepEqual(rows.map((row) => row.service), ['verify:site', 'verify:domain', 'verify:cloudflare']);
  assert.ok(rows.every((row) => row.status === 'skipped'));
  assert.match(rows[0].reason, /dry-run/);
});

test('verify legs: a failed check comes back as an error row (the pipeline fails it like a deploy leg)', async () => {
  const rows = await runVerifyLegs(['web'], LIVE_BRAND, { fetch: fakeFetch({ status: 503 }), resolve: fakeResolve() });
  const site = rows.find((row) => row.service === 'verify:site');

  assert.equal(site.status, 'error');
  assert.match(site.error, /503/);
});
