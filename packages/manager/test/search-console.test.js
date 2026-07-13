/**
 * Search Console service tests — domain property + DNS verification +
 * sitemaps against recording fakes for both APIs. Proves skip semantics,
 * the converged zero-mutation no-op, the one-pass verify flow (TXT via
 * Cloudflare, verify once, pending → warned + rerun converges), stale-token
 * replacement, the no-API ga-link warn, missing-only sitemap submission
 * (omega-manager resubmitted every run), and the dry-run guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/search-console/index.js');
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

function brandConfig({ url = `https://${DOMAIN}`, targets = { web: {} }, gaProperty = GA_PROPERTY } = {}) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    searchConsole: structuredClone(DEFAULTS.searchConsole),
    analytics: structuredClone(DEFAULTS.analytics),
    targets,
  };
  config.analytics.providers.google.propertyId = gaProperty;
  return config;
}

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

function runService(config, { gsc, cloudflare = null, brandState = {}, options = {} } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: '/tmp/omega-manager-gsc-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState,
    apps: [],
    operations: OPERATIONS['search-console'],
    options,
    serviceData: brandState['search-console'] || {},
    searchConsoleApi: gsc,
    cloudflareApi: cloudflare,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('search-console: skips without Google credentials', async () => {
  const result = await runService(brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /GOOGLE_CLIENT_ID/);
});

test('search-console: searchConsole.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.searchConsole.enabled = false;

  const result = await runService(config, { gsc: fakeGsc() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /searchConsole\.enabled/);
});

test('search-console: skips without brand.url', async () => {
  const result = await runService(brandConfig({ url: '' }), { gsc: fakeGsc() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brand\.url/);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('search-console: a fully converged brand is a zero-mutation no-op across all 3 operations', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig(), {
    gsc,
    brandState: { 'search-console': { gaLinked: true } },
  });

  assert.equal(result.status, 'success');
  assert.equal(gsc.mutations().length, 0);
  assert.equal(result.state.propertyUrl, PROPERTY_URL);
  assert.equal(result.state.permissionLevel, 'siteOwner');
  assert.equal(result.state.gaLinked, true);
  assert.equal(result.output.sitemaps.existing, 1);
});

// ─── Property creation / verification ────────────────────────────────────────

test('search-console: missing property is verified via TXT and added in one pass', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN, method: 'DNS_TXT' },
    verifySite: { site: { identifier: DOMAIN } },
    addSite: { added: true },
    listSitemaps: [{ path: SITEMAP_URL }],
  });
  const cf = fakeCf();

  const result = await runService(brandConfig(), {
    gsc,
    cloudflare: cf,
    brandState: { 'search-console': { gaLinked: true } },
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

test('search-console: stale verification records are replaced, not accumulated', async () => {
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

  await runService(brandConfig(), {
    gsc,
    cloudflare: cf,
    brandState: { 'search-console': { gaLinked: true } },
  });

  const deletes = cf.mutations().filter((c) => c.httpMethod === 'DELETE');
  assert.equal(deletes.length, 1); // the stale google token — the SPF record is untouched
  assert.match(deletes[0].endpoint, /rec-old/);
  assert.equal(cf.mutations().filter((c) => c.httpMethod === 'POST').length, 1);
});

test('search-console: verification still propagating warns and defers the add', async () => {
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

test('search-console: an already-verified domain still gets the property added', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
    verifySite: () => {
      throw new Error('HTTP 400: Site has already been verified by this user.');
    },
    addSite: {},
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig(), {
    gsc,
    cloudflare: fakeCf({ txtRecords: [{ id: 'r1', type: 'TXT', name: DOMAIN, content: `"${TOKEN}"` }] }),
    brandState: { 'search-console': { gaLinked: true } },
  });

  assert.equal(result.status, 'success');
  assert.equal(gsc.callsTo('addSite').length, 1);
});

test('search-console: no Cloudflare token → manual TXT record + warned', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
  });

  const result = await runService(brandConfig(), { gsc, cloudflare: null });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.property.manualRecord, { name: DOMAIN, type: 'TXT', content: TOKEN });
  assert.equal(gsc.callsTo('addSite').length, 0);
});

test('search-console: subdomain brands verify at the subdomain label in the apex zone', async () => {
  const gsc = fakeGsc({
    listSites: [],
    getVerificationToken: { token: TOKEN },
    verifySite: {},
    addSite: {},
    listSitemaps: [{ path: `https://app.${DOMAIN}/sitemap.xml` }],
  });
  const cf = fakeCf({ zone: { id: 'zone-1', name: DOMAIN } });

  const result = await runService(brandConfig({ url: `https://app.${DOMAIN}` }), {
    gsc,
    cloudflare: cf,
    brandState: { 'search-console': { gaLinked: true } },
  });

  assert.equal(cf.calls[0].name, DOMAIN); // zone lookup at the APEX
  const post = cf.mutations().find((c) => c.httpMethod === 'POST');
  assert.equal(post.body.name, 'app');
  assert.equal(result.state.propertyUrl, `sc-domain:app.${DOMAIN}`);
});

// ─── GA association ──────────────────────────────────────────────────────────

test('search-console: unconfirmed GA association warns with the associations URL (no API exists)', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig(), { gsc });

  assert.equal(result.status, 'warned');
  assert.match(result.output.gaLink.associationsUrl, /resource_id=sc-domain%3A/);
  assert.equal(result.state.gaLinked, false);
  assert.equal(gsc.mutations().length, 0);
});

test('search-console: interactive GA-association is Enter-gated, confirm stamps gaLinked, service passes', async () => {
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

  try {
    const run = runService(brandConfig(), { gsc });
    await tty.answer('Press Enter to open the Search Console associations page', '\r');
    await tty.answer(`Search Console associated with GA property ${GA_PROPERTY}?`, 'y\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.state.gaLinked, true);
    assert.match(opened[0], /search\.google\.com\/search-console\/settings\/associations/);
    assert.equal(gsc.mutations().length, 0);
  } finally {
    promptModule.openInBrowser = realOpen;
    tty.close();
  }
});

test('search-console: no GA property configured → nothing to associate, no warn', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [{ path: SITEMAP_URL }],
  });

  const result = await runService(brandConfig({ gaProperty: null }), { gsc });

  assert.equal(result.status, 'success');
  assert.equal(result.output?.gaLink, undefined);
});

// ─── Sitemaps ────────────────────────────────────────────────────────────────

test('search-console: missing sitemaps are submitted; existing ones are left alone', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
    listSitemaps: [],
    submitSitemap: { submitted: true },
  });

  const result = await runService(brandConfig(), {
    gsc,
    brandState: { 'search-console': { gaLinked: true } },
  });

  const submits = gsc.callsTo('submitSitemap');
  assert.equal(submits.length, 1);
  assert.deepEqual(submits[0].args, [PROPERTY_URL, SITEMAP_URL]);
  assert.equal(result.output.sitemaps.submitted, 1);
});

test('search-console: submitSitemap = false skips submission without reading', async () => {
  const config = brandConfig();
  config.searchConsole.submitSitemap = false;

  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
  });

  const result = await runService(config, {
    gsc,
    brandState: { 'search-console': { gaLinked: true } },
  });

  assert.equal(result.status, 'success');
  assert.equal(gsc.callsTo('listSitemaps').length, 0);
});

test('search-console: brands without a web target have no sitemap to submit', async () => {
  const gsc = fakeGsc({
    listSites: [{ siteUrl: PROPERTY_URL, permissionLevel: 'siteOwner' }],
  });

  const result = await runService(brandConfig({ targets: { backend: {} } }), {
    gsc,
    brandState: { 'search-console': { gaLinked: true } },
  });

  assert.equal(result.status, 'success');
  assert.equal(gsc.callsTo('listSitemaps').length, 0);
  assert.equal(gsc.callsTo('submitSitemap').length, 0);
});

// ─── Dry-run ─────────────────────────────────────────────────────────────────

test('search-console: dry-run on a fully drifted brand performs zero mutations', async () => {
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

test('search-console: interactive run polls verification until DNS propagates, then adds the property', async () => {
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
    const result = await runService(brandConfig(), {
      gsc,
      cloudflare: cf,
      brandState: { 'search-console': { gaLinked: true } },
    });

    assert.equal(result.status, 'success');
    assert.equal(verifies, 2); // initial attempt + the poll's first re-check
    assert.deepEqual(gsc.callsTo('addSite')[0].args, [PROPERTY_URL]);
    assert.equal(result.state.propertyUrl, PROPERTY_URL);
  } finally {
    tty.close();
  }
});
