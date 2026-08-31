/**
 * Domain service tests — registrar nameserver reconciliation against
 * recording fakes for both APIs (Cloudflare zone lookup + Namecheap DNS).
 * Proves skip semantics, the converged zero-mutation no-op, drift updates,
 * the psl SLD/TLD split (multi-part TLDs), manual-registrar handling, the
 * IP-whitelist walkthrough (#698), and the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/domain/index.js');
const { NamecheapAPI, API_ACCESS_URL, isWhitelistError } = require('../src/services/domain/lib/namecheap-api.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see real credentials from the shell environment
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.NAMECHEAP_USERNAME;
delete process.env.NAMECHEAP_API_KEY;

const DOMAIN = 'fixture-brand.test';
// Cloudflare returns these unsorted — handlers must sort before comparing
const CF_NS = ['rita.ns.cloudflare.com', 'abe.ns.cloudflare.com'];
const CF_NS_SORTED = [...CF_NS].sort();
// The caller IP Namecheap refuses until it is whitelisted (TEST-NET-3)
const CLIENT_IP = '203.0.113.7';

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

/**
 * Fake CloudflareAPI — only the zone lookup the domain service uses. Pass an
 * ARRAY to answer a sequence of lookups (the last entry repeats), which is how
 * a zone that fills in its nameservers mid-wait is fixtured.
 */
function fakeCloudflare(zone) {
  const answers = Array.isArray(zone) ? zone : null;
  const api = {
    lookups: [],
    getZoneByName: async (name) => {
      api.lookups.push(name);
      const answer = answers ? answers[Math.min(api.lookups.length - 1, answers.length - 1)] : zone;
      return answer || null;
    },
  };
  return api;
}

/**
 * The rejection the client throws for a caller IP that is not on Namecheap's
 * API whitelist — shaped exactly as makeRequest builds it (code off the
 * <Error> element, plus the IP only the client knows).
 */
function whitelistRejection() {
  const error = new Error('Namecheap API error: API Key is invalid or API access has not been enabled');
  error.namecheapCode = '1011102';
  error.clientIp = CLIENT_IP;
  return error;
}

/**
 * Recording fake NamecheapAPI. Records every call; getDns can be made to
 * throw (domain not in the account), or to refuse the first `rejections`
 * reads with the IP-whitelist rejection (#698).
 */
function fakeNamecheap({ current = [], getDnsError = null, rejections = 0 } = {}) {
  const api = { calls: [] };
  let refused = 0;

  api.getDns = async (sld, tld) => {
    api.calls.push({ method: 'getDns', sld, tld });
    if (refused < rejections) {
      refused += 1;
      throw whitelistRejection();
    }
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

/** Run fn with console.log captured; returns the joined lines. */
async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
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

// ─── The IP-whitelist walkthrough (#698) ─────────────────────────────────────

test('domain: the client tags a whitelist rejection with its code and the caller IP (#698)', async () => {
  const realFetch = global.fetch;
  global.fetch = async (url) => (String(url).includes('ipify')
    ? { json: async () => ({ ip: CLIENT_IP }) }
    : { text: async () => '<?xml version="1.0" encoding="utf-8"?><ApiResponse Status="ERROR"><Errors><Error Number="1011102">API Key is invalid or API access has not been enabled</Error></Errors></ApiResponse>' });

  try {
    const api = new NamecheapAPI({ username: 'fixture-user', apiKey: 'fixture-key' });
    const error = await api.getDns('fixture-brand', 'test').then(() => null, (e) => e);

    assert.ok(error, 'a Status="ERROR" response throws');
    assert.equal(error.namecheapCode, '1011102');
    assert.equal(error.clientIp, CLIENT_IP, 'the walkthrough gets the IP to whitelist off the error');
    assert.equal(isWhitelistError(error), true);
    // Every other API failure stays on the plain warn path
    assert.equal(isWhitelistError(new Error('Namecheap API error: Domain not found')), false);
  } finally {
    global.fetch = realFetch;
  }
});

test('domain: a whitelist rejection opens the API access page with the IP and rechecks until it passes (#698)', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  // Refused twice: the first read AND the walkthrough's first recheck, so the
  // loop has to run a second recheck before it passes
  const namecheap = fakeNamecheap({ current: ['dns1.registrar-servers.com'], rejections: 2 });
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig(), { cloudflare: fakeCloudflare(zone), namecheap });

    await tty.waitFor(`Add ${CLIENT_IP} under "Whitelisted IPs"`);
    await tty.answer('Press Enter to open the Namecheap API access page', '\r');
    await tty.answer('(enter)=check now, (s)=skip', '\r');
    const result = await run;

    assert.equal(result.status, 'success', 'the recheck passed, so the walk finished the registrar write');
    assert.deepEqual(opened, [API_ACCESS_URL], 'the apiaccess ROOT page, never a deep link');
    assert.ok(namecheap.calls.filter((c) => c.method === 'getDns').length >= 3, 'the refused read was rechecked in a loop');
    assert.deepEqual(namecheap.mutations()[0].nameservers, CF_NS_SORTED);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('domain: a recheck that fails for a NEW reason reports THAT error, not the stale whitelist one (#698)', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  // The whitelist stops the first read; by the recheck the IP is on the list
  // and Namecheap answers with the real problem — the domain isn't in the account
  const namecheap = fakeNamecheap({ rejections: 1, getDnsError: 'Namecheap API error: Domain not found' });
  setBrowserOpener(async () => true);
  const tty = openTtyPrompt();
  let result;

  try {
    const printed = await captureLogAsync(async () => {
      const run = runService(brandConfig(), { cloudflare: fakeCloudflare(zone), namecheap });

      await tty.answer('Press Enter to open the Namecheap API access page', '\r');
      result = await run;
    });

    assert.match(printed, /Domain not found/, 'the recheck error is printed, never swallowed');
    assert.match(printed, /not purchased\?/, 'the non-whitelist hint is reachable on this branch');
    assert.equal(result.status, 'warned');
    assert.match(result.output.nameservers.error, /Domain not found/);
    assert.doesNotMatch(result.output.nameservers.error, /API access has not been enabled/, 'the pre-walk whitelist message is stale here');
    assert.equal(namecheap.mutations().length, 0);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('domain: declining the whitelist walkthrough warns and continues (#698)', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  const namecheap = fakeNamecheap({ rejections: Infinity });
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = runService(brandConfig(), { cloudflare: fakeCloudflare(zone), namecheap });

    await tty.answer('Press Enter to open the Namecheap API access page', '\r');
    await tty.answer('(enter)=check now, (s)=skip', 's');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.match(result.output.nameservers.error, /API access has not been enabled/);
    assert.equal(namecheap.mutations().length, 0);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('domain: a whitelist rejection on a non-interactive run warns and continues, never prompting (#698)', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  const namecheap = fakeNamecheap({ rejections: Infinity });
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });

  try {
    const result = await runService(brandConfig(), { cloudflare: fakeCloudflare(zone), namecheap });

    assert.equal(result.status, 'warned');
    assert.deepEqual(result.warned, [{ operation: 'nameservers', reason: 'could not read the nameservers at Namecheap' }]);
    assert.match(result.output.nameservers.error, /API access has not been enabled/);
    assert.deepEqual(opened, [], 'no browser, no poll — today\'s warn-and-continue');
    assert.equal(namecheap.calls.length, 1, 'the refused read is never retried without a TTY');
  } finally {
    setBrowserOpener(null);
  }
});

test('domain: an accepted API call never opens the whitelist walkthrough (#698)', async () => {
  const zone = { id: 'zone-1', name: DOMAIN, status: 'active', name_servers: CF_NS };
  const namecheap = fakeNamecheap({ current: [...CF_NS] });
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const result = await runService(brandConfig(), { cloudflare: fakeCloudflare(zone), namecheap });

    assert.equal(result.status, 'success');
    assert.deepEqual(opened, []);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
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

// #662: the edge service creates the zone earlier in the SAME walk, so a bare
// zone here is seconds-old — the registrar write waits for Cloudflare to
// assign the nameservers instead of leaving it to a second run.
test('domain: a zone still assigning nameservers is waited out and set in the SAME walk (#662)', async () => {
  const bare = { id: 'zone-1', name: DOMAIN, status: 'initializing', name_servers: [] };
  const assigned = { id: 'zone-1', name: DOMAIN, status: 'pending', name_servers: CF_NS };
  const cloudflare = fakeCloudflare([bare, bare, assigned]);
  const namecheap = fakeNamecheap({ current: ['dns1.registrar-servers.com'] });

  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig(), { cloudflare, namecheap });

    await tty.answer('(enter)=check now, (s)=skip', '\r');
    const result = await run;

    assert.equal(result.status, 'success', 'the walk finished the registrar write — no rerun owed');
    assert.ok(cloudflare.lookups.length >= 3, 'the zone was re-read on a later tick');
    assert.deepEqual(namecheap.mutations()[0].nameservers, CF_NS_SORTED);
  } finally {
    tty.close();
  }
});

test('domain: skipping the nameserver wait warns with the reason the summary prints (#662)', async () => {
  const bare = { id: 'zone-1', name: DOMAIN, status: 'initializing', name_servers: [] };
  const cloudflare = fakeCloudflare(bare);
  const namecheap = fakeNamecheap();

  const tty = openTtyPrompt();
  try {
    const run = runService(brandConfig(), { cloudflare, namecheap });

    await tty.answer('(enter)=check now, (s)=skip', 's');
    const result = await run;

    assert.equal(result.status, 'warned');
    assert.deepEqual(result.warned, [{ operation: 'nameservers', reason: 'the zone has no assigned nameservers yet' }]);
    assert.equal(namecheap.calls.length, 0);
  } finally {
    tty.close();
  }
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
