/**
 * Domain service tests — registrar nameserver reconciliation against
 * recording fakes for both APIs (Cloudflare zone lookup + Namecheap DNS).
 * Proves skip semantics, the converged zero-mutation no-op, drift updates,
 * the psl SLD/TLD split (multi-part TLDs), manual-registrar handling, and
 * the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/domain/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.NAMECHEAP_USERNAME;
delete process.env.NAMECHEAP_API_KEY;

const DOMAIN = 'fixture-brand.test';
// Cloudflare returns these unsorted — handlers must sort before comparing
const CF_NS = ['rita.ns.cloudflare.com', 'abe.ns.cloudflare.com'];
const CF_NS_SORTED = [...CF_NS].sort();

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ url = `https://${DOMAIN}`, provider = 'namecheap' } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    domain: structuredClone(DEFAULTS.domain),
    targets: { web: {} },
  };
  config.domain.providers = provider ? { [provider]: {} } : {};
  return config;
}

/** Fake CloudflareAPI — only the zone lookup the domain service uses. */
function fakeCloudflare(zone) {
  const api = {
    lookups: [],
    getZoneByName: async (name) => {
      api.lookups.push(name);
      return zone || null;
    },
  };
  return api;
}

/**
 * Recording fake NamecheapAPI. Records every call; getDns can be made to
 * throw (domain not in the account).
 */
function fakeNamecheap({ current = [], getDnsError = null } = {}) {
  const api = { calls: [] };

  api.getDns = async (sld, tld) => {
    api.calls.push({ method: 'getDns', sld, tld });
    if (getDnsError) {
      throw new Error(getDnsError);
    }
    return { usingCustom: current.length > 0, nameservers: current };
  };

  api.setCustomNameservers = async (sld, tld, nameservers) => {
    api.calls.push({ method: 'setCustomNameservers', sld, tld, nameservers });
  };

  api.mutations = () => api.calls.filter((c) => c.method === 'setCustomNameservers');
  return api;
}

function runService(config, { cloudflare, namecheap, options = {} } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-domain-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.domain,
    options,
    serviceData: {},
    cloudflareApi: cloudflare,
    namecheapApi: namecheap,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('domain: skips without a domain.providers registrar', async () => {
  const result = await runService(brandConfig({ provider: null }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /domain\.providers/);
});

test('domain: domain.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.domain.enabled = false;

  const result = await runService(config);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /domain\.enabled/);
});

test('domain: skips without CLOUDFLARE_TOKEN (zone nameservers are unreadable)', async () => {
  const result = await runService(brandConfig(), { namecheap: fakeNamecheap() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /CLOUDFLARE_TOKEN/);
});

test('domain: namecheap provider skips without NAMECHEAP credentials', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'active', name_servers: CF_NS };
  const result = await runService(brandConfig(), { cloudflare: fakeCloudflare(zone) });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /NAMECHEAP_USERNAME/);
});

test('domain: manual provider needs no Namecheap credentials', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'active', name_servers: CF_NS };
  const result = await runService(brandConfig({ provider: 'squarespace' }), {
    cloudflare: fakeCloudflare(zone),
  });
  assert.equal(result.status, 'success');
});

// ─── Namecheap reconciliation ────────────────────────────────────────────────

test('domain: converged nameservers are a zero-mutation no-op', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'active', name_servers: CF_NS };
  // Namecheap returns them in a different order — comparison must sort
  const namecheap = fakeNamecheap({ current: [...CF_NS].reverse() });

  const result = await runService(brandConfig(), {
    cloudflare: fakeCloudflare(zone),
    namecheap,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.nameservers.alreadySet, true);
  assert.equal(namecheap.mutations().length, 0);
});

test('domain: subdomain project manages the PARENT domain\'s nameservers (cp113)', async () => {
  // playground.omegajs.dev-style brand: the zone AND the registrar entry are
  // the registrable parent — never the subdomain.
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  const cloudflare = fakeCloudflare(zone);
  const namecheap = fakeNamecheap({ current: ['dns1.registrar-servers.com'] });

  const result = await runService(brandConfig({ url: `https://app.${DOMAIN}` }), {
    cloudflare,
    namecheap,
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(cloudflare.lookups, [DOMAIN]); // parent zone queried, not app.DOMAIN
  const set = namecheap.mutations();
  assert.equal(set.length, 1);
  assert.equal(`${set[0].sld}.${set[0].tld}`, DOMAIN); // registrar write hits the parent
  assert.deepEqual(set[0].nameservers, CF_NS_SORTED);
});

test('domain: drifted nameservers are set at Namecheap (sorted)', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  const namecheap = fakeNamecheap({ current: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'] });

  const result = await runService(brandConfig(), {
    cloudflare: fakeCloudflare(zone),
    namecheap,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.nameservers.updated, true);
  assert.deepEqual(result.output.nameservers.previous, ['dns1.registrar-servers.com', 'dns2.registrar-servers.com']);

  const set = namecheap.mutations();
  assert.equal(set.length, 1);
  assert.deepEqual(set[0], { method: 'setCustomNameservers', sld: 'fixture-brand', tld: 'test', nameservers: CF_NS_SORTED });
});

test('domain: multi-part TLDs split correctly via psl (omega-manager popped one label)', async () => {
  const zone = { id: 'zone-uk', name: 'mybrand.co.uk', status: 'pending', name_servers: CF_NS };
  const namecheap = fakeNamecheap({ current: [] });

  const result = await runService(brandConfig({ url: 'https://mybrand.co.uk' }), {
    cloudflare: fakeCloudflare(zone),
    namecheap,
  });

  assert.equal(result.status, 'success');
  // Namecheap wants SLD "mybrand" + TLD "co.uk" — NOT "mybrand.co" + "uk"
  assert.deepEqual(namecheap.calls[0], { method: 'getDns', sld: 'mybrand', tld: 'co.uk' });
  assert.deepEqual(namecheap.mutations()[0].sld, 'mybrand');
  assert.deepEqual(namecheap.mutations()[0].tld, 'co.uk');
});

test('domain: domain not in the Namecheap account warns instead of failing', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  const namecheap = fakeNamecheap({ getDnsError: 'Domain not found in this account' });

  const result = await runService(brandConfig(), {
    cloudflare: fakeCloudflare(zone),
    namecheap,
  });

  assert.equal(result.status, 'warned');
  assert.match(result.output.nameservers.error, /not found/);
  assert.equal(namecheap.mutations().length, 0);
});

test('domain: dry-run reports the planned update with zero mutations', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  const namecheap = fakeNamecheap({ current: ['dns1.registrar-servers.com'] });

  const result = await runService(brandConfig(), {
    cloudflare: fakeCloudflare(zone),
    namecheap,
    options: { dryRun: true },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.nameservers.planned, 'update');
  assert.deepEqual(result.output.nameservers.required, CF_NS_SORTED);
  assert.equal(namecheap.mutations().length, 0);
});

// ─── Manual registrars ───────────────────────────────────────────────────────

test('domain: manual provider with an active zone is already converged', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'active', name_servers: CF_NS };

  const result = await runService(brandConfig({ provider: 'squarespace' }), {
    cloudflare: fakeCloudflare(zone),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.nameservers.alreadySet, true);
});

test('domain: manual provider with a pending zone warns with the values to set', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };

  const result = await runService(brandConfig({ provider: 'squarespace' }), {
    cloudflare: fakeCloudflare(zone),
  });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.nameservers.manual, true);
  assert.equal(result.output.nameservers.provider, 'squarespace');
  assert.deepEqual(result.output.nameservers.required, CF_NS_SORTED);
});

// ─── Zone edge cases ─────────────────────────────────────────────────────────

test('domain: no Cloudflare zone yet warns and touches nothing', async () => {
  const namecheap = fakeNamecheap();

  const result = await runService(brandConfig(), {
    cloudflare: fakeCloudflare(null),
    namecheap,
  });

  assert.equal(result.status, 'warned');
  assert.match(result.output.nameservers.note, /no Cloudflare zone/);
  assert.equal(namecheap.calls.length, 0);
});

test('domain: zone without assigned nameservers warns and touches nothing', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'initializing', name_servers: [] };
  const namecheap = fakeNamecheap();

  const result = await runService(brandConfig(), {
    cloudflare: fakeCloudflare(zone),
    namecheap,
  });

  assert.equal(result.status, 'warned');
  assert.match(result.output.nameservers.note, /no assigned nameservers/);
  assert.equal(namecheap.calls.length, 0);
});
