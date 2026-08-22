/**
 * Search service tests — the Search Console domain property + DNS verification +
 * sitemaps against recording fakes for both APIs. Proves skip semantics,
 * the converged zero-mutation no-op, the one-pass verify flow (TXT via
 * Cloudflare, verify once, pending → warned + rerun converges), stale-token
 * replacement, the no-API ga-link warn, missing-only sitemap submission
 * (omega-manager resubmitted every run), and the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/search/index.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see real credentials from the shell environment
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.CLOUDFLARE_TOKEN;

const DOMAIN = 'fixture-brand.test';
const PROPERTY_URL = `sc-domain:${DOMAIN}`;
const GA_PROPERTY = '123456';
const TOKEN = 'google-site-verification=fixtureTokenValue123';
const SITEMAP_URL = `https://${DOMAIN}/sitemap.xml`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

// `gaLinked` = the brand has already confirmed the Search Console ↔ GA
// association. It has no read API on either side, so config is its home (#434).
function brandConfig({ url = `https://${DOMAIN}`, targets = { web: {} }, gaProperty = GA_PROPERTY, gaLinked = false } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    search: { providers: { searchConsole: { ...structuredClone(DEFAULTS.search.providers.searchConsole), ...(gaLinked ? { gaLinked: true } : {}) } } },
    analytics: structuredClone(DEFAULTS.analytics),
    targets,
  };
  config.analytics.providers.google.propertyId = gaProperty;
  return config;
}

// The ga-link confirm writes into omega.json5, so every run gets a real one
const FIXTURE_CONFIG = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://${DOMAIN}' },
}
`;

const GSC_READS = ['listSites', 'listSitemaps'];
// getVerificationToken/verifySite change verification state — strict no-op
// tests count them as mutations
const GSC_MUTATIONS = ['addSite', 'submitSitemap', 'getVerificationToken', 'verifySite'];

/** Recording fake GoogleSearchConsoleAPI (method-level, like the others). */
function fakeGsc(responses = {}) {
  const api = { calls: [] };

  for (const method of [...GSC_READS, ...GSC_MUTATIONS]) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeGsc: no response configured for ${method}(${JSON.stringify(args)})`);
      }
      const value = responses[method];
      return typeof value === 'function' ? await value(...args) : structuredClone(value);
    };
  }

  api.mutations = () => api.calls.filter((c) => GSC_MUTATIONS.includes(c.method));
  api.callsTo = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

/** Recording fake CloudflareAPI — zone lookup + raw dns_records requests. */
function fakeCf({ zone = { id: 'zone-1', name: DOMAIN }, txtRecords = [] } = {}) {
  const api = { calls: [] };

  api.getZoneByName = async (name) => {
    api.calls.push({ method: 'getZoneByName', name });
    return zone;
  };

  api.makeRequest = async (endpoint, options = {}) => {
    const method = options.method || 'GET';
    api.calls.push({ method: 'makeRequest', httpMethod: method, endpoint, body: options.body ? JSON.parse(options.body) : null });
    if (method === 'GET') {
      return { result: txtRecords };
    }
    return { result: {} };
  };

  api.mutations = () => api.calls.filter((c) => c.method === 'makeRequest' && c.httpMethod !== 'GET');
  return api;
}

function runService(config, { gsc, cloudflare = null, options = {}, brandRoot } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || makeBrandRoot(FIXTURE_CONFIG), // the ga-link confirm writes here
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.search,
    options,
    searchConsoleApi: gsc,
    cloudflareApi: cloudflare,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('search: skips without Google credentials', async () => {
  const result = await runService(brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /GOOGLE_CLIENT_ID/);
});

test('search: search.providers.searchConsole.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.search.providers.searchConsole.enabled = false;

  const result = await runService(config, { gsc: fakeGsc() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /search\.providers\.searchConsole\.enabled/);
});

test('search: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { gsc: fakeGsc() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('search: a fully converged brand is a zero-mutation no-op across all 3 operations', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig({ gaLinked: true }), { gsc });

  assert.equal(result.status, 'success');
  assert.equal(gsc.mutations().length, 0);
  assert.equal(result.state.propertyUrl, PROPERTY_URL);
  assert.equal(result.state.permissionLevel, 'siteOwner');
  assert.equal(result.output.sitemaps.existing, 1);
});

// ─── Property creation / verification ────────────────────────────────────────

test('search: missing property is verified via TXT and added in one pass', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN, method: 'DNS_TXT' },
    verifySite: { site: { identifier: DOMAIN } },
    addSite: { added: true },
    listSitemaps: [{ path: SITEMAP_URL }],
  });
  const cf = fakeCf();

  const result = await runService(brandConfig({ gaLinked: true }), {
    gsc,
    cloudflare: cf,
  });

  assert.equal(result.status, 'success');

  // TXT record posted at the apex with the quoted token
  const posts = cf.mutations().filter((c) => c.httpMethod === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.type, 'TXT');
  assert.equal(posts[0].body.name, '@');
  assert.equal(posts[0].body.content, `"${TOKEN}"`);

  assert.deepEqual(gsc.callsTo('verifySite')[0].args, [DOMAIN, 'DNS_TXT', 'INET_DOMAIN']);
  assert.deepEqual(gsc.callsTo('addSite')[0].args, [PROPERTY_URL]);
  assert.equal(result.state.propertyUrl, PROPERTY_URL);
  assert.equal(result.state.verificationMethod, 'DNS_TXT');
});

test('search: stale verification records are replaced, not accumulated', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
    verifySite: {},
    addSite: {},
    listSitemaps: [{ path: SITEMAP_URL }],
  });
  const cf = fakeCf({
    txtRecords: [
      { id: 'rec-old', type: 'TXT', name: DOMAIN, content: '"google-site-verification=oldStaleToken"' },
      { id: 'rec-spf', type: 'TXT', name: DOMAIN, content: 'v=spf1 include:_spf.google.com -all' },
    ],
  });

  await runService(brandConfig({ gaLinked: true }), {
    gsc,
    cloudflare: cf,
  });

  const deletes = cf.mutations().filter((c) => c.httpMethod === 'DELETE');
  assert.equal(deletes.length, 1); // the stale google token — the SPF record is untouched
  assert.match(deletes[0].endpoint, /rec-old/);
  assert.equal(cf.mutations().filter((c) => c.httpMethod === 'POST').length, 1);
});

test('search: verification still propagating warns and defers the add', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
    verifySite: () => {
      throw new Error('HTTP 400: The necessary verification token could not be found on your site.');
    },
  });
  const cf = fakeCf();

  const result = await runService(brandConfig(), { gsc, cloudflare: cf });

  assert.equal(result.status, 'warned');
  assert.equal(gsc.callsTo('addSite').length, 0);
  // TXT was written — the rerun only needs to verify + add
  assert.equal(cf.mutations().filter((c) => c.httpMethod === 'POST').length, 1);
  // Downstream operations wait for the property (no listSitemaps either)
  assert.equal(gsc.callsTo('listSitemaps').length, 0);
});

test('search: an already-verified domain still gets the property added', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
    verifySite: () => {
      throw new Error('HTTP 400: Site has already been verified by this user.');
    },
    addSite: {},
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig({ gaLinked: true }), {
    gsc,
    cloudflare: fakeCf({ txtRecords: [{ id: 'r1', type: 'TXT', name: DOMAIN, content: `"${TOKEN}"` }] }),
  });

  assert.equal(result.status, 'success');
  assert.equal(gsc.callsTo('addSite').length, 1);
});

test('search: no Cloudflare token → manual TXT record + warned', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
  });

  const result = await runService(brandConfig(), { gsc, cloudflare: null });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.property.manualRecord, { name: DOMAIN, type: 'TXT', content: TOKEN });
  assert.equal(gsc.callsTo('addSite').length, 0);
});

test('search: subdomain brands verify at the subdomain label in the apex zone', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
    verifySite: {},
    addSite: {},
    listSitemaps: [{ path: `https://app.${DOMAIN}/sitemap.xml` }],
  });
  const cf = fakeCf({ zone: { id: 'zone-1', name: DOMAIN } });

  const result = await runService(brandConfig({ url: `https://app.${DOMAIN}`, gaLinked: true }), {
    gsc,
    cloudflare: cf,
  });

  assert.equal(cf.calls[0].name, DOMAIN); // zone lookup at the APEX
  const post = cf.mutations().find((c) => c.httpMethod === 'POST');
  assert.equal(post.body.name, 'app');
  assert.equal(result.state.propertyUrl, `sc-domain:app.${DOMAIN}`);
});

// ─── GA association ──────────────────────────────────────────────────────────

test('search: unconfirmed GA association warns with the associations URL (no API exists)', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig(), { gsc });

  assert.equal(result.status, 'warned');
  assert.match(result.output.gaLink.associationsUrl, /resource_id=sc-domain%3A/);
  assert.equal(gsc.mutations().length, 0);
});

test('search: interactive GA-association is Enter-gated, confirm stamps gaLinked, service passes', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  // pressEnterToOpen launches via prompt's openInBrowser — stub it
  const promptModule = require('@omega.js/devkit/prompt');
  const opened = [];
  const realOpen = promptModule.openInBrowser;
  promptModule.openInBrowser = (url) => { opened.push(url); return true; };
  const tty = openTtyPrompt();
  const brandRoot = makeBrandRoot(FIXTURE_CONFIG);

  try {
    const run = runService(brandConfig(), { gsc, brandRoot });
    await tty.answer('Press Enter to open the Search Console associations page', '\r');
    await tty.answer(`Search Console associated with GA property ${GA_PROPERTY}?`, 'y\r');
    const result = await run;

    assert.equal(result.status, 'success');
    // The confirm's ONE home is omega.json5 (#434) — nothing can re-check it
    assert.match(readConfigSource(brandRoot), /gaLinked: true/);
    assert.match(opened[0], /search\.google\.com\/search-console\/settings\/associations/);
    assert.equal(gsc.mutations().length, 0);
  } finally {
    promptModule.openInBrowser = realOpen;
    tty.close();
  }
});

test('search: no GA property configured → nothing to associate, no warn', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig({ gaProperty: null }), { gsc });

  assert.equal(result.status, 'success');
  assert.equal(result.output?.gaLink, undefined);
});

// ─── Sitemaps ────────────────────────────────────────────────────────────────

test('search: missing sitemaps are submitted; existing ones are left alone', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [],
    submitSitemap: { submitted: true },
  });

  const result = await runService(brandConfig({ gaLinked: true }), { gsc });

  const submits = gsc.callsTo('submitSitemap');
  assert.equal(submits.length, 1);
  assert.deepEqual(submits[0].args, [PROPERTY_URL, SITEMAP_URL]);
  assert.equal(result.output.sitemaps.submitted, 1);
});

test('search: submitSitemap = false skips submission without reading', async () => {
  const config = brandConfig({ gaLinked: true });
  config.search.providers.searchConsole.submitSitemap = false;

  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
  });

  const result = await runService(config, {
    gsc,
  });

  assert.equal(result.status, 'success');
  assert.equal(gsc.callsTo('listSitemaps').length, 0);
});

test('search: brands without a web target have no sitemap to submit', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
  });

  const result = await runService(brandConfig({ targets: { backend: {} }, gaLinked: true }), {
    gsc,
  });

  assert.equal(result.status, 'success');
  assert.equal(gsc.callsTo('listSitemaps').length, 0);
  assert.equal(gsc.callsTo('submitSitemap').length, 0);
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('search: dry-run on a fully drifted brand performs zero mutations', async () => {
  const gsc = fakeGsc({ listSites: [] });
  const cf = fakeCf();

  const result = await runService(brandConfig(), {
    gsc,
    cloudflare: cf,
    options: { dryRun: true },
  });

  assert.equal(gsc.mutations().length, 0); // not even a verification token is minted
  assert.equal(cf.calls.length, 0);
  assert.equal(result.output.property.planned, 'verify-and-add');
});

test('search: interactive run polls verification until DNS propagates, then adds the property', async () => {
  let verifies = 0;
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
    verifySite: () => {
      verifies++;
      if (verifies === 1) {
        throw new Error('HTTP 400: The necessary verification token could not be found on your site.');
      }
      return { site: { identifier: DOMAIN } };
    },
    addSite: { added: true },
    listSitemaps: [{ path: SITEMAP_URL }],
  });
  const cf = fakeCf();
  const tty = openTtyPrompt();

  try {
    const result = await runService(brandConfig({ gaLinked: true }), {
      gsc,
      cloudflare: cf,
      });

    assert.equal(result.status, 'success');
    assert.equal(verifies, 2); // initial attempt + the poll's first re-check
    assert.deepEqual(gsc.callsTo('addSite')[0].args, [PROPERTY_URL]);
    assert.equal(result.state.propertyUrl, PROPERTY_URL);
  } finally {
    tty.close();
  }
});
