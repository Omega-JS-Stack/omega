/**
 * AdSense service tests — domain presence + approval state against a
 * recording fake of the read-only Management API v2. Proves skip semantics
 * (including the de-ITW'd accountId — no company pub- default), the READY
 * converged read, the per-state warn ladder, the missing-site console
 * deep-link, and dry-run parity (the API has no writes at all).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/adsense/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const DOMAIN = 'fixture-brand.test';
const ACCOUNT_ID = 'pub-0000000000000000';
const SITES_URL = `https://adsense.google.com/adsense/u/0/${ACCOUNT_ID}/sites/list?url=${DOMAIN}`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ url = `https://${DOMAIN}`, accountId = ACCOUNT_ID } = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    adsense: { ...structuredClone(DEFAULTS.adsense), accountId },
    targets: { web: {} },
  };
}

/** Recording fake GoogleAdsenseAPI — the v2 API is read-only, so every call is a read. */
function fakeAdsense({ sites = [] } = {}) {
  const api = { calls: [] };

  api.listSites = async (accountId) => {
    api.calls.push({ method: 'listSites', accountId });
    return structuredClone(sites);
  };

  return api;
}

function runService(config, { adsense, options = {} } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-adsense-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.adsense,
    options,
    serviceData: {},
    adsenseApi: adsense,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('adsense: skips without Google credentials in .env', async () => {
  const result = await runService(brandConfig()); // no injected api → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /GOOGLE_CLIENT_ID\/GOOGLE_CLIENT_SECRET/);
});

test('adsense: adsense.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.adsense.enabled = false;

  const result = await runService(config, { adsense: fakeAdsense() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /adsense\.enabled/);
});

test('adsense: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { adsense: fakeAdsense() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

test('adsense: skips without adsense.accountId — and the default carries no company account', async () => {
  const result = await runService(brandConfig({ accountId: null }), { adsense: fakeAdsense() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /adsense\.accountId/);

  // omega-manager defaulted this to the company's shared pub- account — the
  // manager defaults layer must not carry any account at all
  assert.equal(DEFAULTS.adsense.accountId, null);
});

// ─── Site present ────────────────────────────────────────────────────────────

test('adsense: READY site is a success with exactly one read', async () => {
  const api = fakeAdsense({ sites: [{ domain: DOMAIN, state: 'READY', autoAdsEnabled: true }] });

  const result = await runService(brandConfig(), { adsense: api });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.sites, { domain: DOMAIN, state: 'READY', autoAdsEnabled: true });
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0], { method: 'listSites', accountId: ACCOUNT_ID });
});

test('adsense: a www-prefixed AdSense entry matches the bare domain', async () => {
  const api = fakeAdsense({ sites: [{ domain: `www.${DOMAIN}`, state: 'READY', autoAdsEnabled: false }] });

  const result = await runService(brandConfig(), { adsense: api });

  assert.equal(result.status, 'success');
  assert.equal(result.output.sites.domain, `www.${DOMAIN}`);
});

test('adsense: non-READY approval states are warned, not failed', async () => {
  for (const state of ['GETTING_READY', 'REQUIRES_REVIEW', 'NEEDS_ATTENTION']) {
    const api = fakeAdsense({ sites: [{ domain: DOMAIN, state, autoAdsEnabled: false }] });

    const result = await runService(brandConfig(), { adsense: api });

    assert.equal(result.status, 'warned', `state ${state} should warn`);
    assert.equal(result.output.sites.state, state);
    assert.equal(api.calls.length, 1);
  }
});

test('adsense: an unknown state is surfaced verbatim as a warning', async () => {
  const api = fakeAdsense({ sites: [{ domain: DOMAIN, state: 'SOME_FUTURE_STATE' }] });

  const result = await runService(brandConfig(), { adsense: api });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.sites.state, 'SOME_FUTURE_STATE');
});

// ─── Site missing ────────────────────────────────────────────────────────────

test('adsense: missing site warns with the exact add-site console deep-link', async () => {
  const api = fakeAdsense({ sites: [{ domain: 'some-other-brand.test', state: 'READY' }] });

  const result = await runService(brandConfig(), { adsense: api });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.sites, { domain: DOMAIN, state: null, addUrl: SITES_URL });
  assert.equal(api.calls.length, 1);
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('adsense: dry-run behaves identically — the API has no writes at all', async () => {
  const ready = fakeAdsense({ sites: [{ domain: DOMAIN, state: 'READY', autoAdsEnabled: true }] });
  const readyResult = await runService(brandConfig(), { adsense: ready, options: { dryRun: true } });
  assert.equal(readyResult.status, 'success');
  assert.equal(ready.calls.length, 1);

  const missing = fakeAdsense();
  const missingResult = await runService(brandConfig(), { adsense: missing, options: { dryRun: true } });
  assert.equal(missingResult.status, 'warned');
  assert.equal(missingResult.output.sites.addUrl, SITES_URL);
  assert.equal(missing.calls.length, 1);
});
