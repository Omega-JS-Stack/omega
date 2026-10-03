/**
 * The edge service's `web-analytics` operation: the whole walk over a
 * converged zone, with the account's Web Analytics sites answered by the
 * recording fake, proves the resolved `edge.providers.cloudflare.webAnalytics
 * .enabled` reaches the zone (create, update, no write) and that a token
 * without the Account Settings permissions warns without stopping the walk.
 * A source guard holds the edge service to one account id resolver.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { join, relative } = require('node:path');
const jetpack = require('fs-jetpack');

// The machine registry is per-machine state: fixtures write into a temp home
require('@omega.js/devkit/test/temp-home');

const {
  ZONE, RUM_SITES, brandConfig, fakeApi, runService, convergedResponses, rumSite, rumResponses,
} = require('./lib/edge-fixture.js');

// Tests must never see a real token from the shell environment
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.SENDGRID_API_KEY;

const EDGE_DIR = join(__dirname, '..', 'src', 'services', 'edge');
const ANSI = /\x1b\[[0-9;]*m/g;

// A site the account holds for a zone that is not this brand's
const OTHER_ZONE_SITE = { siteTag: 'site-other', zoneTag: 'zone-other', zoneName: 'other.test' };

function configWith(enabled) {
  const config = brandConfig();
  config.edge.providers.cloudflare.webAnalytics = { enabled };
  return config;
}

/** The whole edge walk over a converged zone, console.log captured. */
async function walk(config, rum) {
  const api = fakeApi({ zones: [ZONE], responses: { ...convergedResponses(config), ...rumResponses(rum) } });
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' ').replace(ANSI, ''));
  let result;
  try {
    result = await runService(config, api);
  } finally {
    console.log = original;
  }
  return { api, result, lines };
}

/** The log lines the walk printed under the `web-analytics` operation. */
function operationLog(lines) {
  const start = lines.findIndex((line) => line.trim() === '→ web-analytics');
  assert.notEqual(start, -1, 'the walk ran the web-analytics operation');
  const end = lines.findIndex((line, i) => i > start && /^\s*→ \S+$/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

const writes = (api) => api.mutations().map((call) => `${call.method} ${call.endpoint}`);
const readSites = (api) => api.call('GET', `${RUM_SITES}/list`);

// ─── The reconcile ───────────────────────────────────────────────────────────

test('web-analytics: no site for the zone and the key true creates one, auto-installed, for the zone tag', async () => {
  const { api, result } = await walk(configWith(true), {
    sites: [rumSite({ ...OTHER_ZONE_SITE, enabled: true })],
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(writes(api), [`POST ${RUM_SITES}`]);
  const { body } = api.mutations()[0];
  assert.equal(body.zone_tag, ZONE.id);
  assert.equal(body.auto_install, true);
  // Cloudflare's create takes no `enabled`: a new site starts enabled
  assert.notEqual(body.enabled, false);
});

test('web-analytics: a site present and disabled with the key true gets one update to enabled', async () => {
  const { api, result } = await walk(configWith(true), {
    sites: [rumSite({ ...OTHER_ZONE_SITE, enabled: true }), rumSite({ siteTag: 'site-1', enabled: false })],
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(writes(api), [`PUT ${RUM_SITES}/site-1`]);
  assert.equal(api.mutations()[0].body.enabled, true);
});

test('web-analytics: a site present and enabled with the key false gets one update to disabled', async () => {
  const { api, result } = await walk(configWith(false), {
    sites: [rumSite({ ...OTHER_ZONE_SITE, enabled: false }), rumSite({ siteTag: 'site-1', enabled: true })],
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(writes(api), [`PUT ${RUM_SITES}/site-1`]);
  assert.equal(api.mutations()[0].body.enabled, false);
});

test('web-analytics: no site for the zone and the key false writes nothing', async () => {
  const { api, result } = await walk(configWith(false), {
    sites: [rumSite({ ...OTHER_ZONE_SITE, enabled: true })],
  });

  assert.equal(result.status, 'success');
  assert.ok(readSites(api), "the operation read the account's sites");
  assert.deepEqual(writes(api), []);
});

test('web-analytics: a site already matching writes nothing and reports no change', async () => {
  const { api, result, lines } = await walk(configWith(true), {
    sites: [rumSite({ ...OTHER_ZONE_SITE, enabled: false }), rumSite({ siteTag: 'site-1', enabled: true })],
  });

  assert.equal(result.status, 'success');
  assert.ok(readSites(api), "the operation read the account's sites");
  assert.deepEqual(writes(api), []);
  assert.match(operationLog(lines), /No changes needed/);
});

test('web-analytics: a 403 warns naming Account Settings Write and every other operation still runs', async () => {
  const config = configWith(true);
  const isRum = (call) => call.endpoint.startsWith(RUM_SITES);
  const otherCalls = (api) => api.calls.filter((call) => !isRum(call)).map((call) => `${call.method} ${call.endpoint}`);

  const baseline = await walk(config, { sites: [rumSite({ siteTag: 'site-1', enabled: true })] });
  const { api, result } = await walk(config, { sites: [], forbidden: true });

  assert.equal(result.status, 'warned');
  assert.equal(result.failed, undefined, 'the 403 is a warning, never a failed operation');
  assert.deepEqual(result.warned.map((entry) => entry.operation), ['web-analytics']);
  assert.match(result.warned[0].reason, /Account Settings Write/);
  assert.ok(api.calls.some(isRum), 'the operation reached the Web Analytics endpoint');
  assert.deepEqual(otherCalls(api), otherCalls(baseline.api), 'the walk made every call it makes when the token is allowed');
});

test('web-analytics: the zone\'s site on the list\'s second page is found, so it is updated and never created', async () => {
  const { api, result } = await walk(configWith(true), {
    pages: [[rumSite({ ...OTHER_ZONE_SITE, enabled: true })], [rumSite({ siteTag: 'site-1', enabled: false })]],
  });

  assert.equal(result.status, 'success');
  assert.ok(api.call('GET', `${RUM_SITES}/list?page=2`), 'the operation read the second page');
  assert.deepEqual(writes(api), [`PUT ${RUM_SITES}/site-1`]);
  assert.equal(api.mutations()[0].body.enabled, true);
});

test('web-analytics: a 403 known only by its HTTP status warns naming Account Settings Write', async () => {
  const { api, result } = await walk(configWith(true), { sites: [], forbidden: 'status' });

  assert.equal(result.status, 'warned');
  assert.equal(result.failed, undefined, 'the 403 is a warning, never a failed operation');
  assert.deepEqual(result.warned.map((entry) => entry.operation), ['web-analytics']);
  assert.match(result.warned[0].reason, /Account Settings Write/);
  assert.ok(api.calls.some((call) => call.endpoint.startsWith(RUM_SITES)), 'the operation reached the Web Analytics endpoint');
});

test('web-analytics: a 500 on the update fails the operation instead of passing for converged', async () => {
  const { api, result } = await walk(configWith(true), {
    sites: [rumSite({ siteTag: 'site-1', enabled: false })],
    writeError: true,
  });

  assert.ok(api.call('PUT', `${RUM_SITES}/site-1`), 'the update was attempted');
  assert.equal(result.status, 'error');
  assert.deepEqual(result.failed.map((entry) => entry.operation), ['web-analytics']);
  assert.equal(result.warned, undefined, 'a server error is never downgraded to a warning');
});

// ─── One account id resolver ─────────────────────────────────────────────────

test('edge source: exactly one function resolves the account id, and every caller uses it', () => {
  const sources = Object.fromEntries(
    jetpack.find(EDGE_DIR, { matching: '**/*.js' })
      .map((file) => [relative(EDGE_DIR, file), jetpack.read(file)]),
  );
  const filesMatching = (pattern) => Object.keys(sources).filter((file) => pattern.test(sources[file])).sort();

  const definers = filesMatching(/\b(?:async\s+)?function\s+accountId\s*\(|\b(?:const|let)\s+accountId\s*=\s*(?:async\b|function\b)/);
  assert.equal(definers.length, 1, `one accountId definition, found in: ${definers.join(', ') || 'none'}`);

  // The former private copies: a getAccountId per handler, zone.js's inline /accounts read
  assert.deepEqual(filesMatching(/\bgetAccountId\b/), [], 'no handler keeps its own getAccountId');
  const lookups = filesMatching(/\.account\.id\b|makeRequest\(\s*['"`]\/accounts['"`]/);
  assert.deepEqual(lookups, definers, 'only the helper reads the account id from the API');

  // A caller may bind the helper under another name (`{ accountId: resolve }`)
  for (const caller of ['ensure/zone.js', 'ensure/email-routing.js', 'ensure/workers.js', 'ensure/web-analytics.js']) {
    const source = sources[caller];
    assert.ok(source, `${caller} exists`);
    const imported = source.match(/\{[^}]*\baccountId\b(?:\s*:\s*(\w+))?[^}]*\}\s*=\s*require\(/);
    assert.ok(imported, `${caller} imports the shared accountId`);
    const binding = imported[1] || 'accountId';
    assert.ok(new RegExp(`\\b${binding}\\(`).test(source), `${caller} calls accountId (as ${binding})`);
  }
});
