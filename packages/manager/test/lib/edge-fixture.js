/**
 * Edge service fixtures shared by the edge test files: a real brand root, the
 * brand config loadBrand would produce, a recording fake CloudflareAPI, and
 * the direct-handler context that bypasses the service's setup.
 */
const { DEFAULTS, templateObject } = require('../../src/config.js');
const { makeBrandRoot } = require('./config-fixture.js');

const DOMAIN = 'fixture-brand.test';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

/**
 * Recording fake CloudflareAPI. `responses` maps "METHOD endpoint" to a
 * result (or a function: throw inside it to simulate API errors). Missing
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

module.exports = { DOMAIN, tmpRoot, brandConfig, fakeApi, handlerContext };
