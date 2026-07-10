/**
 * Cloudflare service tests — the read → diff → write reconciliation against a
 * recording fake API (the real client wraps fetch; these prove the diff
 * logic, skip semantics, subdomain filtering, the converged-zone zero-mutation
 * no-op, and the dry-run guarantee).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OPERATIONS, DEFAULTS, templateObject } = require('../src/config.js');
const service = require('../src/services/cloudflare/index.js');
const { buildRequiredRecords } = require('../src/services/cloudflare/lib/dns-records-helpers.js');

// Tests must never see a real token from the shell environment
delete process.env.CLOUDFLARE_TOKEN;

const DOMAIN = 'fixture-brand.test';
const ZONE = { id: 'zone-1', name: DOMAIN, status: 'active' };
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Fixtures ────────────────────────────────────────────────────────────────

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-cf-'));
}

/**
 * Brand config as loadBrand would produce it: manager DEFAULTS merged under
 * brand choices, `{ domain }` templated. Tests mutate the returned clone.
 */
function brandConfig(url = `https://${DOMAIN}`) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    domain: structuredClone(DEFAULTS.domain),
    cloudflare: structuredClone(DEFAULTS.cloudflare),
    targets: { web: {} },
  };
  return templateObject(config, { domain: url.replace(/^https?:\/\//, '') });
}

/**
 * Recording fake CloudflareAPI. `responses` maps "METHOD endpoint" to a
 * result (or a function — throw inside it to simulate API errors). Missing
 * keys throw, so any unexpected call fails loudly.
 */
function fakeApi({ zones = [], responses = {} } = {}) {
  const api = { calls: [], responses };

  api.makeRequest = async (endpoint, options = {}) => {
    const method = options.method || 'GET';
    const isFormData = options.body instanceof FormData;
    api.calls.push({
      method,
      endpoint,
      body: options.body ? (isFormData ? '[form-data]' : JSON.parse(options.body)) : undefined,
    });

    const responder = api.responses[`${method} ${endpoint}`];
    if (responder === undefined) {
      throw new Error(`fakeApi: no response for "${method} ${endpoint}"`);
    }
    return { success: true, result: typeof responder === 'function' ? responder() : responder };
  };

  api.getZoneByName = async (name) => zones.find((z) => z.name === name) || null;
  api.getAllZones = async () => zones;

  api.mutations = () => api.calls.filter((c) => MUTATING.has(c.method));
  api.call = (method, endpoint) => api.calls.find((c) => c.method === method && c.endpoint === endpoint);
  return api;
}

function runService(config, api, options = {}) {
  return service.run({
    brandId: config.brand?.id || 'fixture-brand',
    brandRoot: tmpRoot(),
    brandConfig: config,
    brand: { id: config.brand?.id, config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.cloudflare,
    options,
    serviceData: {},
    cloudflareApi: api,
  });
}

// Direct-handler context (bypasses setup — for focused per-operation tests)
function handlerContext(config, api, extra = {}) {
  return {
    cloudflareApi: api,
    brandRoot: tmpRoot(),
    brandConfig: config,
    domain: DOMAIN,
    zoneDomain: DOMAIN,
    isSubdomainProject: false,
    zoneId: 'zone-1',
    serviceData: {},
    options: {},
    ...extra,
  };
}

/** Every read a fully-converged default-config zone answers. */
function convergedResponses(config) {
  const cache = config.cloudflare.cacheRules[0];
  const redirect = config.cloudflare.rules.redirect[0];
  const sec = config.cloudflare.rules.security[0];
  const csp = config.cloudflare.rules.responseHeaders[0].headers['Content-Security-Policy'];

  return {
    'GET /accounts': [{ id: 'acct-1' }],
    'GET /zones/zone-1/dns_records': [
      { id: 'r1', type: 'A', name: DOMAIN, content: '185.199.108.153', proxied: true, comment: 'GitHub Pages IP' },
      { id: 'r2', type: 'AAAA', name: DOMAIN, content: '2606:50c0:8000::153', proxied: true, comment: 'GitHub Pages IP' },
      { id: 'r3', type: 'CNAME', name: `www.${DOMAIN}`, content: DOMAIN, proxied: true, comment: 'Redirect www to root domain' },
      { id: 'r4', type: 'TXT', name: DOMAIN, content: '"v=spf1 include:_spf.google.com include:sendgrid.net -all"', comment: 'SPF policy' },
      { id: 'r5', type: 'TXT', name: `_dmarc.${DOMAIN}`, content: '"v=DMARC1; p=quarantine; pct=100"', comment: 'DMARC policy' },
    ],
    'GET /zones/zone-1/settings': Object.entries(config.cloudflare.settings)
      .map(([id, value]) => ({ id, value: structuredClone(value), editable: true })),
    'GET /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint': {
      id: 'rs-cache', kind: 'zone', phase: 'http_request_cache_settings', name: 'Cache Rules', description: 'managed',
      rules: [{
        id: 'cr1', description: cache.name, expression: cache.expression, enabled: cache.enabled,
        action: 'set_cache_settings',
        action_parameters: {
          cache: true,
          edge_ttl: { mode: 'override_origin', default: cache.edgeTtl },
          browser_ttl: { mode: 'override_origin', default: cache.browserTtl },
        },
      }],
    },
    'GET /zones/zone-1/managed_headers': {
      managed_request_headers: [
        { id: 'add_client_certificate_headers', enabled: false },
        { id: 'add_visitor_location_headers', enabled: true },
        { id: 'remove_visitor_ip_headers', enabled: false },
        { id: 'add_waf_credential_check_status_header', enabled: false },
      ],
      managed_response_headers: [
        { id: 'remove_x-powered-by_header', enabled: true },
        { id: 'add_security_headers', enabled: false },
      ],
    },
    'GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint': {
      id: 'rs-redirect', kind: 'zone', phase: 'http_request_dynamic_redirect', name: 'Redirect Rules',
      rules: [{
        id: 'rr1', description: redirect.name, expression: redirect.expression, enabled: redirect.enabled,
        action: 'redirect',
        action_parameters: {
          from_value: {
            status_code: redirect.statusCode,
            preserve_query_string: redirect.preserveQueryString,
            target_url: redirect.targetUrl,
          },
        },
      }],
    },
    'GET /zones/zone-1/rulesets/phases/http_config_settings/entrypoint': { id: 'rs-config', rules: [] },
    'GET /zones/zone-1/rulesets/phases/http_response_headers_transform/entrypoint': {
      id: 'rs-rh',
      rules: [{
        id: 'rh1', description: 'CSP: Allow iframe from self', expression: 'true', action: 'rewrite',
        action_parameters: { headers: { 'Content-Security-Policy': { operation: 'set', value: csp } } },
        enabled: true,
      }],
    },
    'GET /zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint': {
      id: 'rs-sec', description: '',
      rules: [{
        id: 'sr1', description: sec.name, action: 'skip',
        action_parameters: { products: sec.skipProducts, phases: sec.skipPhases, ruleset: sec.skipRuleset },
        expression: sec.expression, enabled: sec.enabled, logging: { enabled: sec.logging },
      }],
    },
    'GET /zones/zone-1/rulesets/phases/http_request_firewall_managed/entrypoint': { id: 'rs-man', rules: [] },
    'GET /zones/zone-1/speed_api/pages': [{ url: `https://${DOMAIN}` }],
    [`GET /zones/zone-1/speed_api/schedule/${encodeURIComponent(`https://${DOMAIN}`)}`]: {
      frequency: 'WEEKLY', region: 'us-central1',
    },
  };
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('cloudflare: skips without CLOUDFLARE_TOKEN', async () => {
  const result = await runService(brandConfig(), undefined);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /CLOUDFLARE_TOKEN/);
});

test('cloudflare: cloudflare.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.cloudflare.enabled = false;

  const result = await runService(config, fakeApi());
  assert.equal(result.status, 'skipped');
});

test('cloudflare: subdomain project uses the parent zone and only runs zone + dns-records', async () => {
  const sub = `app.${DOMAIN}`;
  const config = brandConfig(`https://${sub}`);
  const api = fakeApi({
    zones: [ZONE],
    responses: {
      'GET /accounts': [{ id: 'acct-1' }],
      'GET /zones/zone-1/dns_records': [
        { id: 's1', type: 'A', name: sub, content: '185.199.108.153', proxied: true, comment: 'GitHub Pages IP' },
        { id: 's2', type: 'AAAA', name: sub, content: '2606:50c0:8000::153', proxied: true, comment: 'GitHub Pages IP' },
      ],
    },
  });

  const result = await runService(config, api);

  assert.equal(result.status, 'success');
  assert.equal(result.state.zoneId, 'zone-1');
  assert.deepEqual(api.mutations(), []);
  // Zone-level operations never ran
  for (const c of api.calls) {
    assert.ok(!/settings|rulesets|managed_headers|speed_api|email/.test(c.endpoint), `unexpected zone-level call: ${c.endpoint}`);
  }
});

// ─── Idempotency: the converged zone ─────────────────────────────────────────

test('cloudflare: fully converged zone is a zero-mutation no-op across all 12 operations', async () => {
  const config = brandConfig();
  const api = fakeApi({ zones: [ZONE], responses: convergedResponses(config) });

  const result = await runService(config, api);

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.state.zoneId, 'zone-1');
});

// ─── Zone ────────────────────────────────────────────────────────────────────

test('zone: missing zone is created; pending reports nameservers without any interactive wait', async () => {
  const ensureZone = require('../src/services/cloudflare/ensure/zone.js');
  const api = fakeApi({
    zones: [],
    responses: {
      'GET /accounts': [{ id: 'acct-1' }],
      'POST /zones': { id: 'zone-new', status: 'pending', name_servers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'] },
    },
  });

  const result = await ensureZone(handlerContext(brandConfig(), api));

  assert.equal(result.state.zoneId, 'zone-new');
  assert.equal(result.output.zone.status, 'pending');
  assert.deepEqual(result.output.zone.nameservers, ['a.ns.cloudflare.com', 'b.ns.cloudflare.com']);
  assert.ok(api.call('POST', '/zones'));
});

test('zone: dry-run never creates', async () => {
  const ensureZone = require('../src/services/cloudflare/ensure/zone.js');
  const api = fakeApi({ zones: [], responses: { 'GET /accounts': [{ id: 'acct-1' }] } });

  const result = await ensureZone(handlerContext(brandConfig(), api, { options: { dryRun: true } }));

  assert.equal(result.output.zone.planned, 'create');
  assert.deepEqual(api.mutations(), []);
});

test('zone: a zone created this run is visible to later operations via serviceData', async () => {
  const ensureDns = require('../src/services/cloudflare/ensure/dns-records.js');
  const api = fakeApi({
    responses: { 'GET /zones/zone-fresh/dns_records': [] },
  });

  // zoneId null at setup time (zone didn't exist), zone op returned state
  const config = brandConfig();
  config.cloudflare.dns = null; // diff returns null — read is the point here
  await ensureDns(handlerContext(config, api, { zoneId: null, serviceData: { zoneId: 'zone-fresh' } }));

  assert.ok(api.call('GET', '/zones/zone-fresh/dns_records'));
});

// ─── DNS records ─────────────────────────────────────────────────────────────

test('dns helpers: platform records only — company extras (BIMI/SendGrid/DMARC reports) are config-gated', () => {
  // Default config: no BIMI, no SendGrid, DMARC without report addresses
  const defaults = buildRequiredRecords(DOMAIN, brandConfig().cloudflare.dns, false, null);
  const names = defaults.map((r) => r.name);
  assert.ok(!names.some((n) => n.includes('_bimi')));
  assert.ok(!names.some((n) => n.includes('emailauth')));
  const dmarc = defaults.find((r) => r.name === `_dmarc.${DOMAIN}`);
  assert.equal(dmarc.content, '"v=DMARC1; p=quarantine; pct=100"');

  // Everything configured: records appear with the configured values
  const full = buildRequiredRecords(DOMAIN, {
    spf: 'strict',
    dmarcPolicy: 'reject',
    spfIncludes: ['_spf.google.com'],
    dmarcReports: { rua: ['dmarc@corp.test'], ruf: ['forensics@corp.test'] },
    bimiLogo: 'https://cdn.corp.test/logo.svg',
    sendgrid: { id: '123', whitelabel: 'wl001' },
    records: [{ type: 'TXT', name: '@', content: '"ahrefs-x"', comment: 'Ahrefs domain verification' }],
  }, false, 'privateemail');

  const byName = (n, t) => full.find((r) => r.name === n && (!t || r.type === t));
  assert.equal(byName(DOMAIN, 'TXT').content, '"ahrefs-x"'); // custom record, @ resolved to the domain
  assert.equal(byName(`_dmarc.${DOMAIN}`).content, '"v=DMARC1; p=reject; rua=mailto:dmarc@corp.test; ruf=mailto:forensics@corp.test; pct=100"');
  assert.equal(byName(`default._bimi.${DOMAIN}`).content, '"v=BIMI1; l=https://cdn.corp.test/logo.svg"');
  assert.equal(byName(`emailauth.${DOMAIN}`).content, 'u123.wl001.sendgrid.net');
  assert.equal(byName(`s1._domainkey.${DOMAIN}`).content, 's1.domainkey.u123.wl001.sendgrid.net');
  assert.equal(byName(`123.${DOMAIN}`).content, 'sendgrid.net');
  const spf = full.find((r) => r.type === 'TXT' && r.content.includes('v=spf1'));
  assert.ok(spf.content.includes('include:spf.privateemail.com'));
  assert.ok(spf.content.endsWith('-all"'));
  assert.equal(full.filter((r) => r.type === 'MX').length, 2);
  // TXT customs are ADDITIVE: the apex verification token coexists with the
  // SPF default (a custom apex TXT must never suppress SPF)
  assert.equal(full.filter((r) => r.type === 'TXT' && r.name === DOMAIN).length, 2);
});

test('dns-records: drift creates missing, updates SPF enforcement, deletes obsolete MX + wrong A', async () => {
  const ensureDns = require('../src/services/cloudflare/ensure/dns-records.js');
  const config = brandConfig();
  config.domain.email.provider = 'cloudflare';

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/dns_records': [
        // Wrong A content → replaced (delete + create of the right one)
        { id: 'a1', type: 'A', name: DOMAIN, content: '1.2.3.4', proxied: true, comment: 'GitHub Pages IP' },
        // SPF with soft enforcement while config says strict → content update
        { id: 't1', type: 'TXT', name: DOMAIN, content: '"v=spf1 include:_spf.google.com include:sendgrid.net include:_spf.mx.cloudflare.net ~all"', comment: 'SPF policy' },
        // Mailgun MX while provider is cloudflare → obsolete
        { id: 'm1', type: 'MX', name: DOMAIN, content: 'mxa.mailgun.org', priority: 10, comment: 'Squarespace email forwarding' },
      ],
      'POST /zones/zone-1/dns_records': {},
      'PATCH /zones/zone-1/dns_records/t1': {},
      'DELETE /zones/zone-1/dns_records/m1': {},
      'DELETE /zones/zone-1/dns_records/a1': {},
    },
  });

  const result = await ensureDns(handlerContext(config, api));

  assert.equal(result.status, 'success');
  // Creates: AAAA, www CNAME, DMARC = 3. The wrong-content A and the route MX
  // records converge on the NEXT run — existing records matching by name+type
  // block creation this run while the deletes clear them (faithful omega-
  // manager two-run convergence).
  assert.equal(result.output.dns.created.length, 3);
  assert.equal(result.output.dns.updated.length, 1);
  assert.equal(result.output.dns.deleted.length, 2);
  assert.equal(result.output.dns.errors.length, 0);

  const patched = api.call('PATCH', '/zones/zone-1/dns_records/t1');
  assert.ok(patched.body.content.endsWith('-all"'));
  // No SendGrid/BIMI records invented (not configured)
  const created = api.calls.filter((c) => c.method === 'POST').map((c) => c.body.name);
  assert.ok(!created.some((n) => n.includes('emailauth') || n.includes('_bimi')));
});

test('dns-records: dry-run reports planned counts with zero mutations', async () => {
  const ensureDns = require('../src/services/cloudflare/ensure/dns-records.js');
  const api = fakeApi({
    responses: { 'GET /zones/zone-1/dns_records': [] },
  });

  const result = await ensureDns(handlerContext(brandConfig(), api, { options: { dryRun: true } }));

  assert.deepEqual(api.mutations(), []);
  // A, AAAA, www, SPF, DMARC (no email provider → no MX)
  assert.equal(result.output.dns.planned.create, 5);
});

// ─── Zone settings ───────────────────────────────────────────────────────────

test('zone-settings: patches exactly the drifted editable settings; read-only drift is skipped', async () => {
  const ensureSettings = require('../src/services/cloudflare/ensure/zone-settings.js');
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/settings': [
        { id: 'ssl', value: 'off', editable: true },          // drifted → PATCH
        { id: 'waf', value: 'on', editable: false },          // drifted but read-only → skipped
        { id: 'brotli', value: 'on', editable: true },        // converged
        { id: 'speed_brain', value: 'on', editable: true },   // addons present in bulk → no extra GET
        { id: 'fonts', value: 'on', editable: true },
      ],
      'PATCH /zones/zone-1/settings/ssl': {},
    },
  });

  const result = await ensureSettings(handlerContext(brandConfig(), api));

  assert.deepEqual(result.output.settings.success, ['ssl']);
  assert.equal(api.mutations().length, 1);
  assert.deepEqual(api.call('PATCH', '/zones/zone-1/settings/ssl').body, { value: 'full' });
});

test('zone-settings: dry-run lists the plan, patches nothing', async () => {
  const ensureSettings = require('../src/services/cloudflare/ensure/zone-settings.js');
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/settings': [
        { id: 'ssl', value: 'off', editable: true },
        { id: 'speed_brain', value: 'on', editable: true },
        { id: 'fonts', value: 'on', editable: true },
      ],
    },
  });

  const result = await ensureSettings(handlerContext(brandConfig(), api, { options: { dryRun: true } }));

  assert.deepEqual(result.output.settings.planned, ['ssl']);
  assert.deepEqual(api.mutations(), []);
});

// ─── Rulesets ────────────────────────────────────────────────────────────────

test('cache-rules: updates stale TTLs and removes unconfigured rules in one PUT', async () => {
  const ensureCacheRules = require('../src/services/cloudflare/ensure/cache-rules.js');
  const config = brandConfig();
  const cache = config.cloudflare.cacheRules[0];

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint': {
        id: 'rs-cache', kind: 'zone', phase: 'http_request_cache_settings', name: 'Cache Rules', description: 'managed',
        rules: [
          {
            id: 'cr1', description: cache.name, expression: cache.expression, enabled: true,
            action: 'set_cache_settings',
            action_parameters: { cache: true, edge_ttl: { mode: 'override_origin', default: 100 }, browser_ttl: { mode: 'override_origin', default: 100 } },
          },
          { id: 'cr2', description: 'Old Rule Nobody Configured', expression: 'true', enabled: true, action: 'set_cache_settings', action_parameters: {} },
        ],
      },
      'PUT /zones/zone-1/rulesets/rs-cache': {},
    },
  });

  const result = await ensureCacheRules(handlerContext(config, api));

  assert.equal(result.output.cacheRules.updated, true);
  const put = api.call('PUT', '/zones/zone-1/rulesets/rs-cache');
  assert.equal(put.body.rules.length, 1);
  assert.equal(put.body.rules[0].action_parameters.edge_ttl.default, cache.edgeTtl);
});

test('cache-rules: missing entrypoint ruleset is created via POST', async () => {
  const ensureCacheRules = require('../src/services/cloudflare/ensure/cache-rules.js');
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint': () => {
        throw new Error('Cloudflare API Error: could not find entrypoint ruleset (10003)');
      },
      'POST /zones/zone-1/rulesets': {},
    },
  });

  const result = await ensureCacheRules(handlerContext(brandConfig(), api));

  assert.equal(result.output.cacheRules.updated, true);
  const post = api.call('POST', '/zones/zone-1/rulesets');
  assert.equal(post.body.phase, 'http_request_cache_settings');
  assert.equal(post.body.rules.length, 1);
});

test('managed-transforms: enables only the drifted transform', async () => {
  const ensureTransforms = require('../src/services/cloudflare/ensure/rules-managed-transforms.js');
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/managed_headers': {
        managed_request_headers: [{ id: 'add_visitor_location_headers', enabled: false }],
        managed_response_headers: [{ id: 'remove_x-powered-by_header', enabled: true }],
      },
      'PATCH /zones/zone-1/managed_headers': {},
    },
  });

  const result = await ensureTransforms(handlerContext(brandConfig(), api));

  assert.equal(result.output.managedTransforms.updated, true);
  const patch = api.call('PATCH', '/zones/zone-1/managed_headers');
  const visitor = patch.body.managed_request_headers.find((h) => h.id === 'add_visitor_location_headers');
  assert.equal(visitor.enabled, true);
});

// ─── Email routing ───────────────────────────────────────────────────────────

test('email-routing: provider other than cloudflare makes no API calls', async () => {
  const ensureEmailRouting = require('../src/services/cloudflare/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.provider = 'squarespace';

  const api = fakeApi();
  await ensureEmailRouting(handlerContext(config, api));

  assert.equal(api.calls.length, 0);
});

test('email-routing: converged catch-all + rules are a no-op', async () => {
  const ensureEmailRouting = require('../src/services/cloudflare/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.provider = 'cloudflare';
  config.domain.email.forwarding = [
    { from: '*', to: 'inbox@corp.test' },
    { from: 'support', to: 'help@corp.test' },
  ];

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/email/routing': { enabled: true },
      'GET /zones/zone-1/email/routing/rules': [{
        tag: 't1', enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: `support@${DOMAIN}` }],
        actions: [{ type: 'forward', value: ['help@corp.test'] }],
      }],
      'GET /zones/zone-1/email/routing/rules/catch_all': {
        enabled: true, matchers: [{ type: 'all' }], actions: [{ type: 'forward', value: ['inbox@corp.test'] }],
      },
    },
  });

  const result = await ensureEmailRouting(handlerContext(config, api));

  assert.equal(result.status, 'success');
  assert.equal(result.output.emailRouting.skipped, 2);
  assert.deepEqual(api.mutations(), []);
});

test('email-routing: unverified destination sends a verification email and returns warned (no interactive poll)', async () => {
  const ensureEmailRouting = require('../src/services/cloudflare/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.provider = 'cloudflare';
  config.domain.email.forwarding = [{ from: 'support', to: 'new@corp.test' }];

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/email/routing': { enabled: true },
      'GET /zones/zone-1/email/routing/rules': [],
      'POST /zones/zone-1/email/routing/rules': () => {
        throw new Error('Cloudflare API Error: [{"code":2054,"message":"destination address not verified"}]');
      },
      'GET /zones/zone-1': { account: { id: 'acct-1' } },
      'POST /accounts/acct-1/email/routing/addresses': {},
      'GET /zones/zone-1/email/routing/rules/catch_all': { enabled: false },
    },
  });

  const result = await ensureEmailRouting(handlerContext(config, api));

  assert.equal(result.status, 'warned');
  assert.equal(result.output.emailRouting.unverified, 1);
  assert.ok(api.call('POST', '/accounts/acct-1/email/routing/addresses'));
});

// ─── Speed + workers ─────────────────────────────────────────────────────────

test('speed-scheduled-tests: inactive zone (nameservers pending) is skipped, not failed', async () => {
  const ensureSpeed = require('../src/services/cloudflare/ensure/speed-scheduled-tests.js');
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/speed_api/pages': () => {
        throw new Error('Cloudflare API Error: [{"code":401,"message":"speed.errors.zone_not_active"}]');
      },
    },
  });

  const result = await ensureSpeed(handlerContext(brandConfig(), api));
  assert.equal(result.status, 'skipped');
});

test('workers: no workers configured → no API traffic', async () => {
  const ensureWorkers = require('../src/services/cloudflare/ensure/workers.js');
  const api = fakeApi();

  const result = await ensureWorkers(handlerContext(brandConfig(), api));

  assert.equal(result, undefined);
  assert.equal(api.calls.length, 0);
});

// ─── Interactive verification polls (fake TTY + stubbed browser) ─────────────

const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { openTtyPrompt } = require('./lib/interactive.js');

test('zone: pending zone with a manual registrar opens its nameserver page and polls until active', async () => {
  const ensureZone = require('../src/services/cloudflare/ensure/zone.js');
  const api = fakeApi({
    zones: [{ id: 'zone-p', name: DOMAIN, status: 'pending', name_servers: ['a.ns.cloudflare.com'] }],
    responses: {
      'GET /accounts': [{ id: 'acct-1' }],
      // The poll's first re-read already sees the activated zone
      'GET /zones/zone-p': { id: 'zone-p', name: DOMAIN, status: 'active' },
    },
  });
  const config = brandConfig();
  config.domain.provider = 'squarespace';
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = ensureZone(handlerContext(config, api));
    await tty.answer('Open browser now?', '\r');
    const result = await run;

    assert.equal(result.state.zoneId, 'zone-p');
    assert.equal(result.output.zone.status, 'active');
    assert.deepEqual(opened, [`https://account.squarespace.com/domains/managed/${DOMAIN}/dns/domain-nameservers`]);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('zone: pending zone with an API registrar defers to the domain service even interactively', async () => {
  const ensureZone = require('../src/services/cloudflare/ensure/zone.js');
  // No GET /zones/zone-p responder — a poll attempt would fail loudly
  const api = fakeApi({
    zones: [{ id: 'zone-p', name: DOMAIN, status: 'pending', name_servers: ['a.ns.cloudflare.com'] }],
    responses: { 'GET /accounts': [{ id: 'acct-1' }] },
  });
  const config = brandConfig();
  config.domain.provider = 'namecheap';
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const result = await ensureZone(handlerContext(config, api));

    assert.equal(result.output.zone.status, 'pending');
    assert.deepEqual(opened, []);
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});

test('email-routing: interactive run opens the dashboard and retries the write once verified', async () => {
  const ensureEmailRouting = require('../src/services/cloudflare/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.provider = 'cloudflare';
  config.domain.email.forwarding = [{ from: 'support', to: 'new@corp.test' }];

  let attempts = 0;
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/email/routing': { enabled: true },
      'GET /zones/zone-1/email/routing/rules': [],
      'POST /zones/zone-1/email/routing/rules': () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Cloudflare API Error: [{"code":2054,"message":"destination address not verified"}]');
        }
        return {};
      },
      'GET /zones/zone-1': { account: { id: 'acct-1' } },
      'POST /accounts/acct-1/email/routing/addresses': {},
      'GET /zones/zone-1/email/routing/rules/catch_all': { enabled: false },
    },
  });
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = ensureEmailRouting(handlerContext(config, api));
    await tty.answer('Open browser now?', '\r');
    const result = await run;

    assert.equal(result.status, 'success');
    assert.equal(result.output.emailRouting.created, 1);
    assert.equal(result.output.emailRouting.unverified, 0);
    assert.deepEqual(opened, ['https://dash.cloudflare.com/acct-1/email-routing/destination-addresses']);
    assert.equal(attempts, 2); // initial write + the poll's retry after verification
  } finally {
    tty.close();
    setBrowserOpener(null);
  }
});
