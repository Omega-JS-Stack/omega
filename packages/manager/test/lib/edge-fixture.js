/**
 * Edge service fixtures shared by the edge test files: a real brand root, the
 * brand config loadBrand would produce, a recording fake CloudflareAPI, the
 * direct-handler context that bypasses the service's setup, and the whole
 * service walk with every read a converged zone answers.
 */
const { DEFAULTS, OPERATIONS, templateObject } = require('../../src/config.js');
const service = require('../../src/services/edge/index.js');
const { makeBrandRoot } = require('./config-fixture.js');

const DOMAIN = 'fixture-brand.test';
const ZONE = { id: 'zone-1', name: DOMAIN, status: 'active' };
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ACCOUNT_ID = 'acct-1';
const RUM_SITES = `/accounts/${ACCOUNT_ID}/rum/site_info`;

// The zone ensure lands the resolved zone id in omega.json5, so a fixture
// root has to be a real brand root
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
    targets: { web: { type: 'web' } },
  };
  return templateObject(config, { domain: url.replace(/^https?:\/\//, '') });
}

/** A paged list answer: fakeApi returns its `result_info` beside the result. */
class Page {
  constructor(result, resultInfo) {
    this.result = result;
    this.resultInfo = resultInfo;
  }
}

/**
 * Recording fake CloudflareAPI. `responses` maps "METHOD endpoint" to a
 * result (or a function: throw inside it to simulate API errors). Missing
 * keys throw, so any unexpected call fails loudly. A FormData body is kept
 * on the call as `form`, so a test can read its parts.
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
      ...(isFormData && { form: options.body }),
    });

    const responder = api.responses[`${method} ${endpoint}`];
    if (responder === undefined) {
      throw new Error(`fakeApi: no response for "${method} ${endpoint}"`);
    }
    const answer = typeof responder === 'function' ? responder() : responder;
    if (answer instanceof Page) {
      return { success: true, result: answer.result, result_info: answer.resultInfo };
    }
    return { success: true, result: answer };
  };

  api.getZoneByName = async (name) => zones.find((z) => z.name === name) || null;
  api.getAllZones = async () => zones;

  api.mutations = () => api.calls.filter((c) => MUTATING.has(c.method));
  api.call = (method, endpoint) => api.calls.find((c) => c.method === method && c.endpoint === endpoint);
  return api;
}

// Direct-handler context (bypasses setup, for focused per-operation tests)
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

/** The whole edge service, setup included, over every operation in order. */
function runService(config, api, options = {}, brandRoot = tmpRoot()) {
  return service.run({
    brandId: config.brand?.id || 'fixture-brand',
    brandRoot,
    brandConfig: config,
    brand: { id: config.brand?.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.edge,
    options,
    cloudflareApi: api,
  });
}

/**
 * A Web Analytics site in the shape Cloudflare's list returns: the zone it
 * serves and its on/off switch live on its `ruleset`, not at the top level.
 */
function rumSite({ siteTag, zoneTag = ZONE.id, zoneName = DOMAIN, enabled }) {
  return {
    site_tag: siteTag,
    site_token: `${siteTag}-token`,
    auto_install: true,
    created: '2026-01-01T00:00:00Z',
    rules: [],
    ruleset: { id: `${siteTag}-ruleset`, enabled, zone_name: zoneName, zone_tag: zoneTag },
    snippet: '',
  };
}

// A Cloudflare failure as the real client throws it: the errors array in the
// message, the HTTP status on `status`
function apiError(errors, status) {
  const error = new Error(`Cloudflare API Error: ${JSON.stringify(errors)}`);
  error.status = status;
  return error;
}

// A token missing a permission: Cloudflare answers 403 with code 10000
function forbidden() {
  throw apiError([{ code: 10000, message: 'Authentication error' }], 403);
}

// A 403 known only by its HTTP status, with no code 10000 text
function forbiddenByStatus() {
  throw apiError([{ code: 9109, message: 'Unauthorized to access requested resource' }], 403);
}

function serverError() {
  throw apiError([{ code: 10001, message: 'Internal server error' }], 500);
}

/**
 * The three account-level Web Analytics endpoints: the list, the create, and
 * an update per listed site. `pages` (arrays of sites) pages the list by
 * `?page=N` with Cloudflare's `result_info`, in place of a one-page `sites`.
 * `forbidden` makes all three answer 403: `true` with code 10000, 'status'
 * with another code. `writeError` makes the create and updates answer 500.
 */
function rumResponses({ sites = [], pages = null, forbidden: denied = false, writeError = false } = {}) {
  const denial = denied === 'status' ? forbiddenByStatus : forbidden;
  const answer = (value) => (denied ? denial : () => structuredClone(value));
  const write = (value) => (writeError && !denied ? serverError : answer(value));
  const responses = {
    [`POST ${RUM_SITES}`]: write(rumSite({ siteTag: 'site-created', enabled: true })),
  };

  if (pages) {
    const total = pages.flat().length;
    pages.forEach((page, i) => {
      const info = { page: i + 1, per_page: page.length, count: page.length, total_count: total, total_pages: pages.length };
      // structuredClone drops the class, so each answer builds its own Page
      const listed = denied ? denial : () => new Page(structuredClone(page), info);
      responses[`GET ${RUM_SITES}/list?page=${i + 1}`] = listed;
      if (i === 0) responses[`GET ${RUM_SITES}/list`] = listed;
    });
  } else {
    responses[`GET ${RUM_SITES}/list`] = answer(sites);
  }

  for (const site of pages ? pages.flat() : sites) {
    responses[`PUT ${RUM_SITES}/${site.site_tag}`] = write(site);
  }
  return responses;
}

/** Every read a fully-converged default-config zone answers. */
function convergedResponses(config) {
  const cacheRules = config.edge.providers.cloudflare.cacheRules;
  const redirect = config.edge.providers.cloudflare.rules.redirect[0];
  const sec = config.edge.providers.cloudflare.rules.security[0];
  const csp = config.edge.providers.cloudflare.rules.responseHeaders[0].headers['Content-Security-Policy'];

  return {
    'GET /accounts': [{ id: ACCOUNT_ID }],
    'GET /zones/zone-1': { ...ZONE, account: { id: ACCOUNT_ID, name: 'Fixture Account' } },
    // The framework default keeps Web Analytics on, so the zone's site is enabled
    [`GET ${RUM_SITES}/list`]: [rumSite({ siteTag: 'site-1', enabled: true })],
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

module.exports = {
  DOMAIN, ZONE, ACCOUNT_ID, RUM_SITES, tmpRoot, brandConfig, fakeApi, handlerContext, runService,
  convergedResponses, rumSite, rumResponses,
};
