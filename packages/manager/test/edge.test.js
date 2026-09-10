/**
 * Edge service tests — the read → diff → write reconciliation against a
 * recording fake API (the real client wraps fetch; these prove the diff
 * logic, skip semantics, subdomain filtering, the converged-zone zero-mutation
 * no-op, and the dry-run guarantee).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS, DEFAULTS, templateObject } = require('../src/config.js');
const service = require('../src/services/edge/index.js');
const { buildRequiredRecords } = require('../src/services/edge/lib/dns-records-helpers.js');
const { loadBrand } = require('../src/lib/brand.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');

// Tests must never see a real token from the shell environment
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.SENDGRID_API_KEY;

const DOMAIN = 'fixture-brand.test';
const ZONE = { id: 'zone-1', name: DOMAIN, status: 'active' };
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Fixtures ────────────────────────────────────────────────────────────────

// The zone ensure lands the resolved zone id in omega.json5 (#434), so a
// fixture root has to be a real brand root
function tmpRoot() {
  return makeBrandRoot(`{
  brand: { id: 'fixture-brand', url: 'https://${DOMAIN}' },
}
`);
}

/**
 * Brand config as loadBrand would produce it: manager DEFAULTS merged under
 * brand choices, `{ domain }` templated. Tests mutate the returned clone.
 */
function brandConfig(url = `https://${DOMAIN}`) {
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url },
    domain: structuredClone(DEFAULTS.domain),
    edge: { providers: { cloudflare: structuredClone(DEFAULTS.edge.providers.cloudflare) } },
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
    brand: { id: config.brand?.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.edge,
    options,
    cloudflareApi: api,
  });
}

/**
 * SendGrid's live answer for `GET /v3/whitelabel/domains`: the domain-auth
 * record set, whose `mail_cname` data is the `u<id>.<whitelabel>` host every
 * SendGrid record is built from (#692).
 */
const SENDGRID_DOMAINS = [{
  id: 7,
  domain: DOMAIN,
  valid: true,
  dns: {
    mail_cname: { host: `emailauth.${DOMAIN}`, data: 'u123.wl001.sendgrid.net', type: 'cname', valid: true },
    dkim1: { host: `s1._domainkey.${DOMAIN}`, data: 's1.domainkey.u123.wl001.sendgrid.net' },
    dkim2: { host: `s2._domainkey.${DOMAIN}`, data: 's2.domainkey.u123.wl001.sendgrid.net' },
  },
}];

/** Fake SendGrid client — the two reads dns-records makes. */
function fakeSendgrid({ domains = SENDGRID_DOMAINS, links = [] } = {}) {
  return {
    getAuthenticatedDomains: async () => (typeof domains === 'function' ? domains() : domains),
    getBrandedLinks: async () => (typeof links === 'function' ? links() : links),
  };
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
  const cacheRules = config.edge.providers.cloudflare.cacheRules;
  const redirect = config.edge.providers.cloudflare.rules.redirect[0];
  const sec = config.edge.providers.cloudflare.rules.security[0];
  const csp = config.edge.providers.cloudflare.rules.responseHeaders[0].headers['Content-Security-Policy'];

  return {
    'GET /accounts': [{ id: 'acct-1' }],
    'GET /zones/zone-1/dns_records': [
      { id: 'r1', type: 'A', name: DOMAIN, content: '185.199.108.153', proxied: true, comment: 'GitHub Pages IP' },
      { id: 'r2', type: 'AAAA', name: DOMAIN, content: '2606:50c0:8000::153', proxied: true, comment: 'GitHub Pages IP' },
      { id: 'r3', type: 'CNAME', name: `www.${DOMAIN}`, content: DOMAIN, proxied: true, comment: 'Redirect www to root domain' },
      { id: 'r4', type: 'TXT', name: DOMAIN, content: '"v=spf1 include:_spf.google.com include:sendgrid.net -all"', comment: 'SPF policy' },
      { id: 'r5', type: 'TXT', name: `_dmarc.${DOMAIN}`, content: '"v=DMARC1; p=quarantine; pct=100"', comment: 'DMARC policy' },
    ],
    'GET /zones/zone-1/settings': Object.entries(config.edge.providers.cloudflare.settings)
      .map(([id, value]) => ({ id, value: structuredClone(value), editable: true })),
    'GET /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint': {
      id: 'rs-cache', kind: 'zone', phase: 'http_request_cache_settings', name: 'Cache Rules', description: 'managed',
      rules: cacheRules.map((rule, i) => ({
        id: `cr${i + 1}`, description: rule.name, expression: rule.expression, enabled: rule.enabled,
        action: 'set_cache_settings',
        action_parameters: {
          cache: true,
          edge_ttl: { mode: 'override_origin', default: rule.edgeTtl },
          browser_ttl: { mode: 'override_origin', default: rule.browserTtl },
        },
      })),
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

test('edge: skips without CLOUDFLARE_TOKEN', async () => {
  const result = await runService(brandConfig(), undefined);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /CLOUDFLARE_TOKEN/);
});

test('edge: edge.providers.cloudflare.enabled = false skips the service', async () => {
  const config = brandConfig();
  config.edge.providers.cloudflare.enabled = false;

  const result = await runService(config, fakeApi());
  assert.equal(result.status, 'skipped');
});

test('edge: subdomain project uses the parent zone and only runs zone + dns-records', async () => {
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

test('edge: fully converged zone is a zero-mutation no-op across all 12 operations', async () => {
  const config = brandConfig();
  const api = fakeApi({ zones: [ZONE], responses: convergedResponses(config) });

  const result = await runService(config, api);

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.state.zoneId, 'zone-1');
});

// ─── Zone ────────────────────────────────────────────────────────────────────

test('zone: missing zone is created; pending reports nameservers without any interactive wait', async () => {
  const ensureZone = require('../src/services/edge/ensure/zone.js');
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

test('zone: the resolved id lands in edge.providers.cloudflare.zone (#434)', async () => {
  const ensureZone = require('../src/services/edge/ensure/zone.js');
  const api = fakeApi({
    zones: [{ id: 'zone-1', name: DOMAIN, status: 'active' }],
    responses: { 'GET /accounts': [{ id: 'acct-1' }] },
  });
  const context = handlerContext(brandConfig(), api);

  const result = await ensureZone(context);

  // `omega purge` reads the id from config, where no Cloudflare token is in play
  assert.equal(result.state.zoneId, 'zone-1');
  assert.match(readConfigSource(context.brandRoot), /zone: "zone-1"/);
});

test('zone: dry-run never creates', async () => {
  const ensureZone = require('../src/services/edge/ensure/zone.js');
  const api = fakeApi({ zones: [], responses: { 'GET /accounts': [{ id: 'acct-1' }] } });

  const result = await ensureZone(handlerContext(brandConfig(), api, { options: { dryRun: true } }));

  assert.equal(result.output.zone.planned, 'create');
  assert.deepEqual(api.mutations(), []);
});

test('zone: subdomain project with a missing parent zone CREATES the parent (cp113)', async () => {
  const ensureZone = require('../src/services/edge/ensure/zone.js');
  const sub = `app.${DOMAIN}`;
  const api = fakeApi({
    zones: [],
    responses: {
      'GET /accounts': [{ id: 'acct-1' }],
      'POST /zones': { id: 'zone-parent', status: 'pending', name_servers: ['a.ns.cloudflare.com', 'b.ns.cloudflare.com'] },
    },
  });

  const result = await ensureZone(handlerContext(brandConfig(`https://${sub}`), api, {
    domain: sub,
    zoneDomain: DOMAIN,
    isSubdomainProject: true,
  }));

  // The zone POSTed is the PARENT, not the subdomain
  const create = api.call('POST', '/zones');
  assert.equal(create.body.name, DOMAIN);
  assert.equal(result.state.zoneId, 'zone-parent');
  assert.equal(result.output.zone.created, true);
  assert.equal(result.output.zone.status, 'pending');
  assert.deepEqual(result.output.zone.nameservers, ['a.ns.cloudflare.com', 'b.ns.cloudflare.com']);
});

test('edge: dry-run with NO existing zone plans every op — zero API writes, no zones/null calls (cp113)', async () => {
  // The latent bug: ops after `zone` used to call /zones/null/… when the
  // zone didn't exist yet. fakeApi throws on any un-stubbed call, so this
  // passing means only /accounts was ever read.
  const api = fakeApi({ zones: [], responses: { 'GET /accounts': [{ id: 'acct-1' }] } });

  const result = await runService(brandConfig(), api, { dryRun: true });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);

  const sub = fakeApi({ zones: [], responses: { 'GET /accounts': [{ id: 'acct-1' }] } });
  const subResult = await runService(brandConfig(`https://app.${DOMAIN}`), sub, { dryRun: true });
  assert.equal(subResult.status, 'success');
  assert.deepEqual(sub.mutations(), []);
});

test('zone: subdomain missing-parent dry-run plans the parent create, zero mutations', async () => {
  const ensureZone = require('../src/services/edge/ensure/zone.js');
  const api = fakeApi({ zones: [], responses: { 'GET /accounts': [{ id: 'acct-1' }] } });

  const result = await ensureZone(handlerContext(brandConfig(`https://app.${DOMAIN}`), api, {
    domain: `app.${DOMAIN}`,
    zoneDomain: DOMAIN,
    isSubdomainProject: true,
    options: { dryRun: true },
  }));

  assert.equal(result.output.zone.planned, 'create');
  assert.deepEqual(api.mutations(), []);
});

test('zone: a zone created this run is visible to later operations via serviceData', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');
  const api = fakeApi({
    responses: { 'GET /zones/zone-fresh/dns_records': [] },
  });

  // zoneId null at setup time (zone didn't exist), zone op returned state
  const config = brandConfig();
  config.edge.providers.cloudflare.dns = null; // diff returns null — read is the point here
  await ensureDns(handlerContext(config, api, { zoneId: null, serviceData: { zoneId: 'zone-fresh' } }));

  assert.ok(api.call('GET', '/zones/zone-fresh/dns_records'));
});

// ─── DNS records ─────────────────────────────────────────────────────────────

test('dns helpers: platform records only — company extras (BIMI/DMARC reports) are config-gated', () => {
  // Default config: no BIMI, no SendGrid block, DMARC without report addresses
  const defaults = buildRequiredRecords(DOMAIN, brandConfig().edge.providers.cloudflare.dns, false, null);
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
    // NOT config (#692): diffRecords folds this block in from the live
    // `GET /v3/whitelabel/domains` read before calling the builder
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

  // #646: the branded LINK host is the one SendGrid record that rides the proxy
  // — and only once SendGrid says the branding is VALID (the flip's own test
  // below). Unvalidated, it stays grey-clouded like every other SendGrid record.
  assert.equal(byName(`emailurl.${DOMAIN}`).proxied, false, 'no validity in the block, no proxy');
  assert.equal(byName(`emailauth.${DOMAIN}`).proxied, false);
  assert.equal(byName(`123.${DOMAIN}`).proxied, false);
  assert.equal(byName(`s1._domainkey.${DOMAIN}`).proxied, false);
  const spf = full.find((r) => r.type === 'TXT' && r.content.includes('v=spf1'));
  assert.ok(spf.content.includes('include:spf.privateemail.com'));
  assert.ok(spf.content.endsWith('-all"'));
  assert.equal(full.filter((r) => r.type === 'MX').length, 2);
  // TXT customs are ADDITIVE: the apex verification token coexists with the
  // SPF default (a custom apex TXT must never suppress SPF)
  assert.equal(full.filter((r) => r.type === 'TXT' && r.name === DOMAIN).length, 2);
});

// #646: SendGrid rewrites every transactional link through `emailurl.<domain>`
// and serves NO certificate for it, so the record has to ride Cloudflare's
// proxy for the click to land on HTTPS. But SendGrid VALIDATES the branding by
// resolving that name as a CNAME to sendgrid.net, and a proxied record answers
// with the edge's addresses instead — so flipping the proxy on first locks the
// branding out of ever validating. The live answer decides, per run.
test('dns helpers: the branded link host is proxied only once SendGrid validates it (#646)', () => {
  const dnsConfig = (linkBrandingValid) => ({
    sendgrid: { id: '123', whitelabel: 'wl001', ...(linkBrandingValid === undefined ? {} : { linkBrandingValid }) },
  });
  const emailurl = (config) => buildRequiredRecords(DOMAIN, config, false, null)
    .find((r) => r.name === `emailurl.${DOMAIN}`);

  assert.equal(emailurl(dnsConfig(true)).proxied, true, 'validated: the click lands on HTTPS at the edge');
  assert.equal(emailurl(dnsConfig(false)).proxied, false, 'not validated: grey-cloud, or the CNAME lookup never resolves');
  assert.equal(emailurl(dnsConfig()).proxied, false, 'and an unanswered read is a NO — a wrong proxy needs a hand edit to undo');
});

test('dns-records: the emailurl record follows SendGrid\'s link-branding validity (#646)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');

  const run = async (links) => {
    const api = fakeApi({
      responses: {
        'GET /zones/zone-1/dns_records': [],
        'POST /zones/zone-1/dns_records': { id: 'new' },
      },
    });
    await ensureDns(handlerContext(brandConfig(), api, { sendgridApi: fakeSendgrid({ links }) }));

    return api.calls.find((c) => c.method === 'POST' && c.body.name === `emailurl.${DOMAIN}`);
  };

  const validated = await run([{ domain: DOMAIN, subdomain: 'emailurl', valid: true }]);
  assert.equal(validated.body.proxied, true, 'SendGrid resolved the CNAME — the proxy is safe to turn on');

  const pending = await run([{ domain: DOMAIN, subdomain: 'emailurl', valid: false }]);
  assert.equal(pending.body.proxied, false, 'still validating — a proxied record would answer with Cloudflare IPs');

  const absent = await run([{ domain: 'other-brand.test', subdomain: 'emailurl', valid: true }]);
  assert.equal(absent.body.proxied, false, 'another brand\'s branding says nothing about this one');
});

// #692: the SendGrid record set is SendGrid's own observed fact about the
// domain — read live per run, never a config copy. omega-brand proved the copy
// wrong on 2026-08-30: domain auth passed, no `dns.sendgrid` existed, and the
// walk silently desired NO SendGrid records at all.
test('dns-records: the SendGrid records are built from the live domain-auth read (#692)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/dns_records': [],
      'POST /zones/zone-1/dns_records': { id: 'new' },
    },
  });
  await ensureDns(handlerContext(brandConfig(), api, {
    sendgridApi: fakeSendgrid({ links: [{ domain: DOMAIN, subdomain: 'emailurl', valid: true }] }),
  }));

  const created = (name) => api.calls.find((c) => c.method === 'POST' && c.body.name === name);
  // Every record derives from mail_cname's u<id>.<whitelabel> host
  assert.equal(created(`emailauth.${DOMAIN}`).body.content, 'u123.wl001.sendgrid.net');
  assert.equal(created(`123.${DOMAIN}`).body.content, 'sendgrid.net', 'the owner CNAME is named for the id');
  assert.equal(created(`s1._domainkey.${DOMAIN}`).body.content, 's1.domainkey.u123.wl001.sendgrid.net');
  assert.equal(created(`s2._domainkey.${DOMAIN}`).body.content, 's2.domainkey.u123.wl001.sendgrid.net');
  assert.equal(created(`emailurl.${DOMAIN}`).body.proxied, true, 'links reported valid — the branded link rides the proxy');
});

// #692: no answer is a LOUD skip. Silence was the bug — `emailurl.<domain>`
// never existed, so the #646 proxy-once-valid flip could never engage.
test('dns-records: an unanswered SendGrid read skips the SendGrid records and says why (#692)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');

  const run = async (extra) => {
    const api = fakeApi({
      responses: {
        'GET /zones/zone-1/dns_records': [],
        'POST /zones/zone-1/dns_records': { id: 'new' },
      },
    });
    const logs = await captureLogAsync(() => ensureDns(handlerContext(brandConfig(), api, extra)));
    const sendgridRecords = api.calls.filter((c) =>
      c.method === 'POST' && /^(emailauth|emailurl|123|s[12]\._domainkey)\./.test(c.body.name),
    );
    return { logs, sendgridRecords, api };
  };

  // No SENDGRID_API_KEY (deleted for this file) and no injected client
  const noKey = await run({});
  assert.equal(noKey.sendgridRecords.length, 0, 'nothing to build the host from');
  assert.match(noKey.logs, /SendGrid records skipped — no /);
  assert.match(noKey.logs, /SENDGRID_API_KEY/);
  assert.ok(noKey.api.calls.some((c) => c.method === 'POST' && c.body.name === DOMAIN), 'the platform records still land');

  // The account authenticates other domains, but not this brand's
  const noDomain = await run({
    sendgridApi: fakeSendgrid({ domains: [{ domain: 'other-brand.test', dns: { mail_cname: { data: 'u9.wl9.sendgrid.net' } } }] }),
  });
  assert.equal(noDomain.sendgridRecords.length, 0);
  assert.match(noDomain.logs, /no authenticated domain for /);
  assert.match(noDomain.logs, new RegExp(DOMAIN.replace('.', '\\.')));

  // A mail_cname that is not the u<id>.<whitelabel> shape — the warning names it
  const malformed = await run({
    sendgridApi: fakeSendgrid({ domains: [{ domain: DOMAIN, dns: { mail_cname: { data: 'em1234.fixture-brand.test' } } }] }),
  });
  assert.equal(malformed.sendgridRecords.length, 0, 'a guessed host would poison every SendGrid record');
  assert.match(malformed.logs, /domain-auth host /);
  assert.match(malformed.logs, /em1234\.fixture-brand\.test/);

  // An unreachable SendGrid is survivable — the zone still reconciles
  const unreachable = await run({
    sendgridApi: { getAuthenticatedDomains: async () => { throw new Error('SendGrid API error (503): Service Unavailable'); } },
  });
  assert.equal(unreachable.sendgridRecords.length, 0);
  assert.match(unreachable.logs, /could not read the domain authentication/);
  assert.match(unreachable.logs, /503/);
});

// #692: config is not a fallback for the live read. A brand that still carries
// the deleted `dns.sendgrid` block must build NOTHING from it — the stale copy
// is exactly what pointed omega-brand's records at the wrong host.
test('dns-records: a leftover dns.sendgrid config block never builds records (#692)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');
  const config = brandConfig();
  config.edge.providers.cloudflare.dns.sendgrid = { id: '999', whitelabel: 'stale' };

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/dns_records': [],
      'POST /zones/zone-1/dns_records': { id: 'new' },
    },
  });

  // Live read answers NOTHING (no key, no client injected)
  await ensureDns(handlerContext(config, api, {}));

  const created = api.calls.filter((c) => c.method === 'POST').map((c) => c.body.name);
  assert.ok(!created.some((n) => /^(emailauth|emailurl|999|s[12]\._domainkey)\./.test(n)), 'the stale copy desired nothing');
  assert.ok(created.includes(DOMAIN), 'the platform records still land');
});

// #662 + #692: the wait is for a branding that EXISTS and has not validated
// yet. A host with no branding at all gets one from the campaigns service
// later in the same walk (#693), so waiting on it HERE would never end.
test('dns-records: no link branding at all skips the wait and points at the campaigns service (#693)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/dns_records': [],
      'POST /zones/zone-1/dns_records': { id: 'new' },
    },
  });

  // A TTY is available: an entry that EXISTS holds the walk here (#662), so a
  // handler that finishes inside the beat is one that never started waiting.
  const tty = openTtyPrompt();
  let result;
  const logs = await captureLogAsync(async () => {
    try {
      const run = ensureDns(handlerContext(brandConfig(), api, {
        sendgridApi: fakeSendgrid({ links: [{ domain: 'other-brand.test', subdomain: 'emailurl', valid: true }] }),
      }));
      const raced = await Promise.race([run, new Promise((resolve) => setTimeout(() => resolve('WAITED'), 750))]);
      if (raced === 'WAITED') {
        await tty.answer('(enter)=check now, (s)=skip', 's'); // release it, then fail
        await run;
      }
      result = raced;
    } finally {
      tty.close();
    }
  });

  assert.notEqual(result, 'WAITED', 'the branding arrives from the campaigns service — a wait on it here would never end');
  const created = api.calls.find((c) => c.method === 'POST' && c.body.name === `emailurl.${DOMAIN}`);
  assert.equal(created.body.proxied, false, 'branding that does not exist never rides the proxy');
  assert.equal(result.status, 'success', 'nothing is PENDING — there is no branding to validate');
  assert.match(logs, /SendGrid has no link branding for that host yet/);
  assert.match(logs, /campaigns service creates and validates it later in this run/, 'the line names who creates it');
});

test('dns-records: drift creates missing, updates SPF enforcement, deletes obsolete MX + wrong A', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');
  const config = brandConfig();
  config.domain.email.providers = { cloudflare: {} };

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
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');
  const api = fakeApi({
    responses: { 'GET /zones/zone-1/dns_records': [] },
  });

  const result = await ensureDns(handlerContext(brandConfig(), api, { options: { dryRun: true } }));

  assert.deepEqual(api.mutations(), []);
  // A, AAAA, www, SPF, DMARC (no email provider → no MX)
  assert.equal(result.output.dns.planned.create, 5);
});

// #692: the domain-auth read is a READ, so a dry run does it too and plans the
// records it found — the old config-gated path planned nothing at all here.
test('dns-records: dry-run reads SendGrid live and names the host in the plan (#692)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');
  const api = fakeApi({
    responses: { 'GET /zones/zone-1/dns_records': [] },
  });

  let result;
  const logs = await captureLogAsync(async () => {
    result = await ensureDns(handlerContext(brandConfig(), api, {
      options: { dryRun: true },
      sendgridApi: fakeSendgrid({ links: [{ domain: DOMAIN, subdomain: 'emailurl', valid: true }] }),
    }));
  });

  assert.deepEqual(api.mutations(), []);
  // The 5 platform records + emailauth, the owner CNAME, emailurl, 2 DKIM keys
  assert.equal(result.output.dns.planned.create, 10);
  assert.match(logs, /SendGrid domain auth read live: u123\.wl001\.sendgrid\.net/);
});

// ─── Zone settings ───────────────────────────────────────────────────────────

test('zone-settings: patches exactly the drifted editable settings; read-only drift is skipped', async () => {
  const ensureSettings = require('../src/services/edge/ensure/zone-settings.js');
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
  const ensureSettings = require('../src/services/edge/ensure/zone-settings.js');
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
  const ensureCacheRules = require('../src/services/edge/ensure/cache-rules.js');
  const config = brandConfig();
  const cache = config.edge.providers.cloudflare.cacheRules[0];

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
  assert.equal(put.body.rules.length, config.edge.providers.cloudflare.cacheRules.length);
  assert.equal(put.body.rules[0].action_parameters.edge_ttl.default, cache.edgeTtl);
  assert.ok(!put.body.rules.some((rule) => rule.description === 'Old Rule Nobody Configured'));
});

test('cache-rules: missing entrypoint ruleset is created via POST', async () => {
  const ensureCacheRules = require('../src/services/edge/ensure/cache-rules.js');
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
  assert.equal(post.body.rules.length, DEFAULTS.edge.providers.cloudflare.cacheRules.length);
});

// #751: the built site's every asset is content-hashed under /assets, so it is
// cacheable forever — HTML is the one thing that must not be, or a deploy stays
// invisible to a returning visitor for as long as the browser holds it.
test('cache-rules: the framework defaults cache built assets for a year and keep HTML short (#751)', () => {
  const rules = DEFAULTS.edge.providers.cloudflare.cacheRules;
  const assets = rules.find((rule) => rule.name === 'Assets: Cache for 1 Year');
  const html = rules.find((rule) => rule.name === 'HTML: Short Browser Cache');

  assert.equal(assets.edgeTtl, 31536000);
  assert.equal(assets.browserTtl, 31536000);
  assert.ok(assets.expression.includes('wildcard r"/assets/*"'));

  assert.ok(html, 'the defaults carry an HTML rule');
  assert.equal(html.browserTtl, 60);
  assert.equal(html.edgeTtl, 7200);
  // Never the asset rule's paths — one path, one cache lifetime
  assert.ok(html.expression.includes('not starts_with(http.request.uri.path, "/assets/")'));
});

test('cache-rules: a brand declaring no rules still reconciles the framework defaults (#751)', async () => {
  const ensureCacheRules = require('../src/services/edge/ensure/cache-rules.js');
  const { config } = loadBrand(makeBrandRoot(`{
  brand: { id: 'fixture-brand', url: 'https://${DOMAIN}' },
}
`));
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint': () => {
        throw new Error('Cloudflare API Error: could not find entrypoint ruleset (10003)');
      },
      'POST /zones/zone-1/rulesets': {},
    },
  });

  await ensureCacheRules(handlerContext(config, api));

  const post = api.call('POST', '/zones/zone-1/rulesets');
  assert.deepEqual(
    post.body.rules.map((rule) => rule.description),
    ['Assets: Cache for 1 Year', 'HTML: Short Browser Cache'],
  );
  assert.equal(post.body.rules[0].action_parameters.browser_ttl.default, 31536000);
  assert.equal(post.body.rules[1].action_parameters.browser_ttl.default, 60);
});

// Cache rules are ZONE-scoped, and the zone serves the api host too
// (api.<domain>, whose Firebase rewrites answer extensionless user-scoped GETs
// like /authorize and /omega/user/connections). An unguarded HTML rule would make
// those edge-cacheable, so the rule names the hosts it is FOR.
test('cache-rules: the HTML rule never matches the api or emailurl hosts (#751)', () => {
  const rules = DEFAULTS.edge.providers.cloudflare.cacheRules;
  const html = rules.find((rule) => rule.name === 'HTML: Short Browser Cache');
  const assets = rules.find((rule) => rule.name === 'Assets: Cache for 1 Year');

  assert.ok(html.expression.includes('not starts_with(http.host, "api.")'));
  // The other proxied non-site host: the SendGrid link-tracking CNAME, whose
  // extensionless click/open URLs must reach SendGrid every time.
  assert.ok(html.expression.includes('not starts_with(http.host, "emailurl.")'));
  // Every site host on the zone still matches: apex, www, and a subdomain
  // project served under the parent zone — so the guard is the api PREFIX,
  // never an equality on one host.
  assert.ok(!html.expression.includes('http.host eq'));
  // The assets rule stays host-agnostic: both its paths are static files
  assert.ok(!assets.expression.includes('http.host'));
});

test("cache-rules: a brand's own cacheRules replace the defaults entirely (#751)", () => {
  const { config } = loadBrand(makeBrandRoot(`{
  brand: { id: 'fixture-brand', url: 'https://${DOMAIN}' },
  edge: { providers: { cloudflare: { cacheRules: [{ name: 'Only Mine', expression: 'true', edgeTtl: 60, browserTtl: 60 }] } } },
}
`));

  assert.deepEqual(config.edge.providers.cloudflare.cacheRules.map((rule) => rule.name), ['Only Mine']);
});

// #754: 0 is a real TTL, not "unset". `browserTtl: 0` is a brand saying "hold
// nothing in the browser" (Cloudflare writes `max-age=0`), and a `||` default
// silently turned that into 14400. The manager sends the TTLs the brand
// declared and lets Cloudflare judge them — an edge bypass is its own MODE in
// Cloudflare's grammar, never a value this module substitutes.
test('cache-rules: a declared TTL of 0 is honored, never replaced by the default (#754)', async () => {
  const ensureCacheRules = require('../src/services/edge/ensure/cache-rules.js');
  const { config } = loadBrand(makeBrandRoot(`{
  brand: { id: 'fixture-brand', url: 'https://${DOMAIN}' },
  edge: { providers: { cloudflare: { cacheRules: [
    { name: 'HTML: No Browser Cache', expression: 'true', edgeTtl: 7200, browserTtl: 0 },
    { name: 'API: No Cache At All', expression: 'starts_with(http.host, "api.")', edgeTtl: 0, browserTtl: 0 },
  ] } } },
}
`));
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint': () => {
        throw new Error('Cloudflare API Error: could not find entrypoint ruleset (10003)');
      },
      'POST /zones/zone-1/rulesets': {},
    },
  });

  await ensureCacheRules(handlerContext(config, api));

  const post = api.call('POST', '/zones/zone-1/rulesets');
  assert.equal(post.body.rules[0].action_parameters.browser_ttl.default, 0);
  assert.equal(post.body.rules[0].action_parameters.edge_ttl.default, 7200);
  assert.equal(post.body.rules[1].action_parameters.browser_ttl.default, 0);
  assert.equal(post.body.rules[1].action_parameters.edge_ttl.default, 0);
});

// A rule already at 0 on the zone is converged: the diff must not see a
// difference the `||` default invented and PUT a needless update every run.
test('cache-rules: a zone already at a 0 TTL needs no update (#754)', async () => {
  const ensureCacheRules = require('../src/services/edge/ensure/cache-rules.js');
  const { config } = loadBrand(makeBrandRoot(`{
  brand: { id: 'fixture-brand', url: 'https://${DOMAIN}' },
  edge: { providers: { cloudflare: { cacheRules: [
    { name: 'HTML: No Browser Cache', expression: 'true', edgeTtl: 7200, browserTtl: 0 },
  ] } } },
}
`));
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint': {
        id: 'rs-cache', kind: 'zone', phase: 'http_request_cache_settings', name: 'Cache Rules', description: 'managed',
        rules: [{
          id: 'cr1', description: 'HTML: No Browser Cache', expression: 'true', enabled: true,
          action: 'set_cache_settings',
          action_parameters: {
            cache: true,
            edge_ttl: { mode: 'override_origin', default: 7200 },
            browser_ttl: { mode: 'override_origin', default: 0 },
          },
        }],
      },
    },
  });

  const result = await ensureCacheRules(handlerContext(config, api));

  assert.equal(result, undefined);
  assert.deepEqual(api.mutations(), []);
});

// The DashQR case (#466): printed QR codes point at /c/<id> forever, so the
// destination is COMPUTED from the request path. That is the whole reason
// templated redirects live at the edge rather than in web config — a static
// host has nothing that can answer a path it never built.
const QR_RULE = {
  name: 'Redirect: QR short code',
  expression: '(starts_with(http.request.uri.path, "/c/"))',
  statusCode: 301,
  preserveQueryString: false,
  targetUrl: { expression: 'concat("https://", http.host, "/code?id=", substring(http.request.uri.path, 3))' },
  enabled: true,
};

test('rules-redirect: a templated redirect is created with its computed target intact (#466)', async () => {
  const ensureRedirect = require('../src/services/edge/ensure/rules-redirect.js');
  const config = brandConfig();
  const trailing = config.edge.providers.cloudflare.rules.redirect[0];
  config.edge.providers.cloudflare.rules.redirect.push(QR_RULE);

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint': {
        id: 'rs-redirect', kind: 'zone', phase: 'http_request_dynamic_redirect', name: 'Redirect Rules',
        rules: [{
          id: 'rr1', description: trailing.name, expression: trailing.expression, enabled: trailing.enabled,
          action: 'redirect',
          action_parameters: {
            from_value: {
              status_code: trailing.statusCode,
              preserve_query_string: trailing.preserveQueryString,
              target_url: trailing.targetUrl,
            },
          },
        }],
      },
      'PUT /zones/zone-1/rulesets/rs-redirect': {},
    },
  });

  const result = await ensureRedirect(handlerContext(config, api));

  assert.equal(result.output.redirect.updated, true);
  const put = api.call('PUT', '/zones/zone-1/rulesets/rs-redirect');
  assert.equal(put.body.rules.length, 2, 'the converged rule survives beside the new one');

  const qr = put.body.rules.find((rule) => rule.description === QR_RULE.name);
  assert.equal(qr.action, 'redirect');
  assert.equal(qr.expression, QR_RULE.expression, 'the match is the edge filter expression, verbatim');
  assert.deepEqual(qr.action_parameters.from_value, {
    status_code: 301,
    // The target carries its own `?id=`, so an inbound querystring must NOT be
    // appended — that is what the key is for.
    preserve_query_string: false,
    target_url: QR_RULE.targetUrl,
  });
});

test('rules-redirect: a converged templated rule mutates nothing, and a dry run plans instead of writing', async () => {
  const ensureRedirect = require('../src/services/edge/ensure/rules-redirect.js');
  const config = brandConfig();
  config.edge.providers.cloudflare.rules.redirect.push(QR_RULE);

  const responses = {
    'GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint': {
      id: 'rs-redirect', kind: 'zone', phase: 'http_request_dynamic_redirect', name: 'Redirect Rules',
      rules: config.edge.providers.cloudflare.rules.redirect.map((rule, index) => ({
        id: `rr${index + 1}`, description: rule.name, expression: rule.expression, enabled: rule.enabled,
        action: 'redirect',
        action_parameters: {
          from_value: {
            status_code: rule.statusCode,
            preserve_query_string: rule.preserveQueryString,
            target_url: rule.targetUrl,
          },
        },
      })),
    },
  };

  const converged = fakeApi({ responses });
  await ensureRedirect(handlerContext(config, converged));
  assert.deepEqual(converged.mutations(), [], 'a converged ruleset is a zero-mutation read');

  // Drift the live status code so the dry run has something to plan.
  const drifted = fakeApi({ responses: structuredClone(responses) });
  drifted.responses['GET /zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint']
    .rules[1].action_parameters.from_value.status_code = 302;

  const result = await ensureRedirect(handlerContext(config, drifted, { options: { dryRun: true } }));

  assert.equal(result.output.redirect.planned, 'update');
  assert.deepEqual(drifted.mutations(), [], 'a dry run writes nothing');
});

test('managed-transforms: enables only the drifted transform', async () => {
  const ensureTransforms = require('../src/services/edge/ensure/rules-managed-transforms.js');
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
  const ensureEmailRouting = require('../src/services/edge/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.providers = { squarespace: {} };

  const api = fakeApi();
  await ensureEmailRouting(handlerContext(config, api));

  assert.equal(api.calls.length, 0);
});

test('email-routing: converged catch-all + rules are a no-op', async () => {
  const ensureEmailRouting = require('../src/services/edge/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.providers = { cloudflare: {} };
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
  const ensureEmailRouting = require('../src/services/edge/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.providers = { cloudflare: {} };
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
  const ensureSpeed = require('../src/services/edge/ensure/speed-scheduled-tests.js');
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
  const ensureWorkers = require('../src/services/edge/ensure/workers.js');
  const api = fakeApi();

  const result = await ensureWorkers(handlerContext(brandConfig(), api));

  assert.equal(result, undefined);
  assert.equal(api.calls.length, 0);
});

// ─── Interactive verification polls (fake TTY + stubbed browser) ─────────────

const { setBrowserOpener } = require('@omega.js/devkit/flows');
const { openTtyPrompt } = require('./lib/interactive.js');

test('zone: pending zone with a manual registrar opens its nameserver page and polls until active', async () => {
  const ensureZone = require('../src/services/edge/ensure/zone.js');
  const api = fakeApi({
    zones: [{ id: 'zone-p', name: DOMAIN, status: 'pending', name_servers: ['a.ns.cloudflare.com'] }],
    responses: {
      'GET /accounts': [{ id: 'acct-1' }],
      // The poll's first re-read already sees the activated zone
      'GET /zones/zone-p': { id: 'zone-p', name: DOMAIN, status: 'active' },
    },
  });
  const config = brandConfig();
  config.domain.providers = { squarespace: {} };
  const opened = [];
  setBrowserOpener(async (url) => { opened.push(url); return true; });
  const tty = openTtyPrompt();

  try {
    const run = ensureZone(handlerContext(config, api));
    await tty.answer('Press Enter to open the squarespace nameserver settings', '\r');
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
  const ensureZone = require('../src/services/edge/ensure/zone.js');
  // No GET /zones/zone-p responder — a poll attempt would fail loudly
  const api = fakeApi({
    zones: [{ id: 'zone-p', name: DOMAIN, status: 'pending', name_servers: ['a.ns.cloudflare.com'] }],
    responses: { 'GET /accounts': [{ id: 'acct-1' }] },
  });
  const config = brandConfig();
  config.domain.providers = { namecheap: {} };
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
  const ensureEmailRouting = require('../src/services/edge/ensure/email-routing.js');
  const config = brandConfig();
  config.domain.email.providers = { cloudflare: {} };
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
    await tty.answer('Press Enter to open the Cloudflare destination-addresses page', '\r');
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

// #662: the flip belongs to THIS walk. SendGrid validates the branded link a
// few minutes after the CNAME lands, so an interactive run waits for that
// answer and proxies the record in the same pass; skipping keeps it grey.
test('dns-records: the run waits for SendGrid\'s validation and proxies emailurl in the SAME walk (#662)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');
  const config = brandConfig();

  let reads = 0;
  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/dns_records': [],
      'POST /zones/zone-1/dns_records': { id: 'new' },
    },
  });

  const tty = openTtyPrompt();
  try {
    const run = ensureDns(handlerContext(config, api, {
      sendgridApi: fakeSendgrid({
        links: () => {
          reads += 1;
          return [{ domain: DOMAIN, subdomain: 'emailurl', valid: reads >= 3 }];
        },
      }),
    }));

    await tty.answer('(enter)=check now, (s)=skip', '\r');
    const result = await run;

    const created = api.calls.find((c) => c.method === 'POST' && c.body.name === `emailurl.${DOMAIN}`);
    assert.equal(created.body.proxied, true, 'validation landed mid-run — the record is written proxied, not on a rerun');
    assert.equal(result.status, 'success', 'nothing is owed to a second run');
    assert.ok(reads >= 3, 'SendGrid was re-asked on a later tick');
  } finally {
    tty.close();
  }
});

test('dns-records: skipping the branded-link wait warns with the reason the summary prints (#662)', async () => {
  const ensureDns = require('../src/services/edge/ensure/dns-records.js');
  const config = brandConfig();

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/dns_records': [],
      'POST /zones/zone-1/dns_records': { id: 'new' },
    },
  });

  const tty = openTtyPrompt();
  try {
    const run = ensureDns(handlerContext(config, api, {
      sendgridApi: fakeSendgrid({ links: [{ domain: DOMAIN, subdomain: 'emailurl', valid: false }] }),
    }));

    await tty.answer('(enter)=check now, (s)=skip', 's');
    const result = await run;

    const created = api.calls.find((c) => c.method === 'POST' && c.body.name === `emailurl.${DOMAIN}`);
    assert.equal(created.body.proxied, false, 'still unvalidated — a proxied record would answer with Cloudflare IPs');
    assert.equal(result.status, 'warned');
    assert.match(result.reason, /has not validated the branded link/);
  } finally {
    tty.close();
  }
});
