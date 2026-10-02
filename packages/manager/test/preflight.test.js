// Tests for src/lib/preflight.js: the gate run before any service. The keys a
// service is missing come from @omega.js/config's one function (names only,
// values NEVER printed); the scopes come from the REQUIRES registry, checked
// against the token store's granted-scopes record. Plus the run/skip/strict
// verdicts, the walkthrough content, and the runManage wiring.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { setPromptStreams } = require('@omega.js/devkit/prompt');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('@omega.js/devkit/test/temp-home');

const { resolveCompany } = require('@omega.js/config');

const { REQUIRES, SERVICE_ORDER } = require('../src/config.js');
const { runPreflight, readTokenStore } = require('../src/lib/preflight.js');
const { runManage } = require('../src/manage.js');
const { googleTokenStorePath } = require('../src/lib/google-auth.js');

// Preflight checks must be deterministic regardless of the shell's exports
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.NAMECHEAP_USERNAME;
delete process.env.NAMECHEAP_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.SENDGRID_API_KEY;
delete process.env.BEEHIIV_API_KEY;
delete process.env.SENTRY_AUTH_TOKEN;
delete process.env.APPLE_API_ISSUER;
delete process.env.APPLE_API_KEY_ID;
delete process.env.APPLE_TEAM_ID;

const SECRET_VALUE = 'super-secret-preflight-value-never-printed';

// The Google OAuth client is a cloud key, asked only once the project is a real one
const REAL_PROJECT = { cloud: { provider: 'firebase', config: { projectId: 'preflight-live' } } };

function withStreams(isTTY, fn) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = isTTY;
  output.isTTY = isTTY;
  setPromptStreams({ input, output });
  try {
    return fn();
  } finally {
    setPromptStreams(null);
  }
}

/** Capture every console.log line emitted while fn runs. */
function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

/** captureLog for an async run (the manage walk + its printed summary). */
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

function stageTokenStore(tokens) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-'));
  if (tokens) {
    const storePath = googleTokenStorePath(root);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(tokens));
  }
  return root;
}

// ─── what each service is found missing ─────────────────────────────────────
//
// Real services on real configs: what a service needs and when lives in the
// env schema, and preflight asks the one function for the verb `manage`.

/**
 * One preflight run, its printed lines captured.
 * @param {string[]} services - The services to check.
 * @param {object} brandConfig - The brand config.
 * @param {object} [run] - { isTTY, brandRoot, company, options }.
 * @returns {{ findings: object[], gates: object, log: string }}
 */
function preflight(services, brandConfig, { isTTY = false, brandRoot = stageTokenStore(null), company, options = {} } = {}) {
  let result;
  const log = captureLog(() => {
    result = withStreams(isTTY, () => runPreflight({ services, brandConfig, brandRoot, company, options }));
  });
  return { ...result, log };
}

test('preflight: edge turned off, no finding', () => {
  const { findings, gates } = preflight(['edge'], { edge: { providers: { cloudflare: { enabled: false } } } });
  assert.equal(findings.length, 0);
  assert.equal(gates.edge, undefined);
});

// The advertising gate is the client id alone. The `enabled` key it
// used to read beside it is deleted, so a config still carrying it must not
// silence the preflight ask for the account the service still manages.
test('preflight: the advertising ask is client presence, not a second switch (#527)', () => {
  const withClient = preflight(['advertising'], { ...REAL_PROJECT, advertising: { providers: { adsense: { client: 'ca-pub-1', enabled: false } } } });
  assert.ok(withClient.gates.advertising, 'a configured client id asks for its credentials');
  assert.deepEqual([...withClient.gates.advertising.missingEnv].sort(), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

  const noClient = preflight(['advertising'], { ...REAL_PROJECT, advertising: { providers: { adsense: {} } } });
  assert.equal(noClient.gates.advertising, undefined, 'no client id, nothing to ask for');
});

test('preflight: missing env, a finding naming the exact vars', () => {
  const { gates } = preflight(['edge'], {});
  assert.deepEqual(gates.edge.missingEnv, ['CLOUDFLARE_TOKEN']);
  assert.equal(gates.edge.needsInteractive, undefined, 'a missing secret is no consent gap');
});

test('preflight: env present, no finding', () => {
  process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
  try {
    const { findings, gates } = preflight(['edge'], {});
    assert.equal(findings.length, 0);
    assert.deepEqual(gates, {});
  } finally {
    delete process.env.CLOUDFLARE_TOKEN;
  }
});

test('preflight: namecheap creds only for namecheap brands', () => {
  const squarespace = preflight(['domain'], { domain: { providers: { squarespace: {} } } });
  assert.deepEqual(squarespace.gates.domain.missingEnv, ['CLOUDFLARE_TOKEN']);

  const namecheap = preflight(['domain'], { domain: { providers: { namecheap: {} } } });
  assert.deepEqual([...namecheap.gates.domain.missingEnv].sort(), ['CLOUDFLARE_TOKEN', 'NAMECHEAP_API_KEY', 'NAMECHEAP_USERNAME']);

  // No provider chosen: the service skips itself and preflight stays quiet
  assert.equal(preflight(['domain'], {}).gates.domain, undefined);
});

test('preflight: scopes, no token store is a consent gap with no missing env', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const { gates } = preflight(['search'], REAL_PROJECT);
    assert.match(gates.search.needsInteractive, /Google consent/);
    assert.deepEqual(gates.search.missingEnv, []);
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test('preflight: scopes, a store missing a required scope names it, a sufficient one is clean', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const partial = stageTokenStore({ access_token: 'tok', scopes: ['https://www.googleapis.com/auth/webmasters'], account_email: 'ops@example.test' });
    const narrow = preflight(['search'], REAL_PROJECT, { brandRoot: partial });
    assert.match(narrow.gates.search.needsInteractive, /siteverification/);

    const full = stageTokenStore({
      access_token: 'tok',
      scopes: ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/siteverification'],
      account_email: 'ops@example.test',
    });
    assert.deepEqual(preflight(['search'], REAL_PROJECT, { brandRoot: full }).gates, {});
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test('preflight: readTokenStore, a real store round-trips and a pre-tracking store grants nothing', () => {
  const root = stageTokenStore({ access_token: 'tok', scopes: ['a', 'b'], account_email: 'me@example.test' });
  const store = readTokenStore(root);
  assert.equal(store.exists, true);
  assert.deepEqual(store.scopes, ['a', 'b']);
  assert.equal(store.accountEmail, 'me@example.test');

  const legacyRoot = stageTokenStore({ access_token: 'tok' }); // no scopes array
  assert.deepEqual(readTokenStore(legacyRoot).scopes, []);

  assert.equal(readTokenStore(stageTokenStore(null)).exists, false);
});

// ─── runPreflight: verdicts ─────────────────────────────────────────────────

test('preflight verdicts: non-interactive missing env, skip with missingEnv', () => {
  const { gates, log } = preflight(['edge'], {});

  assert.match(log, /Preflight/);
  assert.equal(gates.edge.action, 'skip');
  assert.match(gates.edge.reason, /CLOUDFLARE_TOKEN/);
  assert.match(gates.edge.reason, /^preflight: /);
  assert.deepEqual(gates.edge.missingEnv, ['CLOUDFLARE_TOKEN']);
});

test('preflight verdicts: interactive and a pasted key, run (the paste flow fixes it mid-run)', () => {
  assert.equal(preflight(['edge'], {}, { isTTY: true }).gates.edge.action, 'run');
});

test('preflight verdicts: interactive but a key nobody pastes, still skip (no flow collects it)', () => {
  // The Google OAuth client is set up by hand in the Cloud console, never pasted mid-run
  assert.equal(preflight(['search'], REAL_PROJECT, { isTTY: true }).gates.search.action, 'skip');
});

test('preflight verdicts: --strict is an error, even interactive', () => {
  assert.equal(preflight(['edge'], {}, { isTTY: true, options: { strict: true } }).gates.edge.action, 'error');
});

test('preflight verdicts: a consent/scope gap carries the ⚑ pending marker; a missing-secret gap does not (#228)', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const { gates } = preflight(['search', 'edge'], REAL_PROJECT);

    assert.match(gates.search.needsInteractive, /Google consent/,
      'the summary ⚑ section reads this field; without it the skip is a nameless count');
    assert.equal(gates.edge.needsInteractive, undefined,
      'a missing secret already rides the 🔑 section; double-listing is noise');

    // A store that exists but lacks the scope is the same pending human step
    const narrowStore = stageTokenStore({ access_token: 'a', refresh_token: 'r', scopes: ['https://www.googleapis.com/auth/firebase'] });
    const narrow = preflight(['search'], REAL_PROJECT, { brandRoot: narrowStore });
    assert.match(narrow.gates.search.needsInteractive, /webmasters/, 'and it names the scopes to re-consent');
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test('preflight verdicts: nothing missing, no gates and nothing printed', () => {
  process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
  try {
    const { findings, gates, log } = preflight(['edge'], {});
    assert.equal(findings.length, 0);
    assert.deepEqual(gates, {});
    assert.equal(log, '');
  } finally {
    delete process.env.CLOUDFLARE_TOKEN;
  }
});

// ─── Walkthrough content (cp236 tone) ───────────────────────────────────────

test('preflight walkthrough: what/which/why/fix/rerun', () => {
  const { log } = preflight(['edge'], {});

  assert.match(log, /Preflight/);                                            // the consolidated header
  assert.match(log, /edge/);                                                 // which service
  assert.match(log, /reconciles the zone, DNS records/);                     // why it matters
  assert.match(log, /CLOUDFLARE_TOKEN=<value>/);                             // the exact .env line
  assert.match(log, /https:\/\/dash\.cloudflare\.com\/profile\/api-tokens/); // where the value comes from
  assert.match(log, /Create a token with Zone edit/);                        // the hint
  assert.match(log, /npm run manage -- --service=edge/);                     // the rerun verb
});

test('preflight walkthrough: a present var is not nagged, and env VALUES never appear', () => {
  process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
  try {
    const { log } = preflight(['domain'], { domain: { providers: { namecheap: {} } } });

    assert.match(log, /NAMECHEAP_API_KEY=<value>/);
    assert.ok(!log.includes('CLOUDFLARE_TOKEN=<value>'), 'present vars are not nagged');
    assert.ok(!log.includes(SECRET_VALUE), 'values NEVER print');
  } finally {
    delete process.env.CLOUDFLARE_TOKEN;
  }
});

// A brand of a company, both real on disk: the parent carries the
// shared `company/` tree, whose `.env` is the tier every sub-brand inherits,
// and the machine registry is how the child's `company: { id }` resolves.
function stageCompanyBrand({ envFile = true } = {}) {
  const parentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-company-'));
  fs.mkdirSync(path.join(parentRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(parentRoot, 'config', 'omega.json5'),
    JSON.stringify({ brand: { id: 'parent-brand', name: 'Parent', url: 'https://parent.test' } }),
  );
  fs.mkdirSync(path.join(parentRoot, 'company', 'config'), { recursive: true });
  fs.writeFileSync(path.join(parentRoot, 'company', 'config', 'omega.json5'), JSON.stringify({}));
  if (envFile) fs.writeFileSync(path.join(parentRoot, 'company', '.env'), 'SHARED="value"\n');
  fs.writeFileSync(
    path.join(process.env.OMEGA_HOME, 'brands.json'),
    JSON.stringify({ 'parent-brand': { root: parentRoot, name: 'Parent', url: 'https://parent.test' } }),
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-child-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'config', 'omega.json5'),
    JSON.stringify({ brand: { id: 'child-brand', name: 'Child', url: 'https://child.test' }, company: { id: 'parent-brand' } }),
  );

  return { root, companyEnv: path.join(parentRoot, 'company', '.env') };
}

test('preflight walkthrough: a company brand is sent to the COMPANY .env (#910)', () => {
  const { root, companyEnv } = stageCompanyBrand();
  const company = resolveCompany(root);
  assert.equal(company.id, 'parent-brand', 'the fixture resolves a company');

  const { gates, log } = preflight(['edge'], {}, { brandRoot: root, company });

  // One shape for every service the walkthrough prints: the key belongs in
  // the company file each sub-brand inherits, and the brand file is the
  // override, not the home.
  assert.match(log, /CLOUDFLARE_TOKEN=<value>/);
  assert.ok(log.includes(companyEnv), `the fix line names the company .env: ${log}`);
  assert.match(log, /brand \.env overrides it/);
  assert.ok(gates.edge.reason.includes(companyEnv), `the skip reason says it too: ${gates.edge.reason}`);
});

test('preflight walkthrough: the company .env is named even before it exists (#910)', () => {
  // The file a first-time company brand has yet to create is still the file
  // the key belongs in, so the line names the path rather than falling back.
  const { root, companyEnv } = stageCompanyBrand({ envFile: false });

  const { log } = preflight(['edge'], {}, { brandRoot: root, company: resolveCompany(root) });

  assert.ok(log.includes(companyEnv), `the fix line names the file to create: ${log}`);
});

test('preflight walkthrough: a standalone brand keeps the brand .env line (#910)', () => {
  const root = stageTokenStore(null);

  const { log } = preflight(['edge'], {}, { brandRoot: root, company: resolveCompany(root) });

  assert.match(log, /to the brand \.env/);
  assert.ok(!log.includes('company'), `no company, no company line: ${log}`);
});

test('preflight walkthrough: scope gap names the acting identity + both remedies (cp236 model)', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const root = stageTokenStore({ access_token: 'tok', scopes: ['https://www.googleapis.com/auth/webmasters'], account_email: 'ops@example.test' });

    const { log } = preflight(['search'], REAL_PROJECT, { brandRoot: root });

    assert.match(log, /search/);
    assert.match(log, /scope:siteverification/);           // what's missing, short form
    assert.match(log, /ops@example\.test/);                // acting identity (cp236)
    assert.match(log, /google-tokens\.json/);              // the token store path
    assert.match(log, /re-consent/);                       // remedy 1
    assert.match(log, /delete the token store/);           // remedy 2 (cp236 alternative)
    assert.ok(!log.includes(SECRET_VALUE));
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

// ─── Registry sanity ────────────────────────────────────────────────────────

test('preflight registry: every REQUIRES key is a real service, and its scopes are Google scopes', () => {
  for (const [serviceName, declaration] of Object.entries(REQUIRES)) {
    assert.ok(SERVICE_ORDER.includes(serviceName), `${serviceName} is not in SERVICE_ORDER`);
    for (const scope of declaration.scopes || []) {
      assert.match(scope, /^https:\/\/www\.googleapis\.com\/auth\//, `${serviceName} scope ${scope}`);
    }
  }
});

// ─── runManage wiring ───────────────────────────────────────────────────────

function stageBrand({ projectId } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-brand-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'preflight-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2));
  fs.mkdirSync(path.join(root, 'config'));
  const cloud = projectId ? `\n  cloud: { provider: 'firebase', config: { projectId: '${projectId}' } },` : '';
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: {
    id: 'preflight-brand',
    name: 'Preflight Brand',
    url: 'https://preflight-brand.test',
  },${cloud}
  targets: {
    web: { type: 'web' },
  },
}`);
  // A no-dep web target whose build writes dist/index.html: the update
  // service must pass so the loop provably continues PAST preflight skips
  fs.mkdirSync(path.join(root, 'targets', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'web', 'package.json'), JSON.stringify({
    name: 'preflight-web',
    private: true,
    scripts: { build: 'node build.js' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'targets', 'web', 'build.js'), `const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), '<!doctype html><title>preflight</title>');
`);
  return root;
}

test('runManage: preflight-failing service skips with the walkthrough reason and missingEnv', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, { service: 'edge' }));

  assert.equal(report.hasErrors, false);
  assert.equal(report.results.edge.status, 'skipped');
  assert.match(report.results.edge.reason, /^preflight: /);
  assert.match(report.results.edge.reason, /CLOUDFLARE_TOKEN/);
  assert.deepEqual(report.results.edge.missingEnv, ['CLOUDFLARE_TOKEN']);
});

test('runManage: --strict turns the preflight failure into a hard error', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, { service: 'edge', strict: true }));

  assert.equal(report.hasErrors, true);
  assert.equal(report.results.edge.status, 'error');
  assert.match(report.results.edge.error, /^preflight: /);
  assert.match(report.results.edge.error, /CLOUDFLARE_TOKEN/);
});

test('runManage: a consent-gated preflight skip is NAMED in the ⚑ pending list, with its rerun hint (#228)', async () => {
  const root = stageBrand({ projectId: 'preflight-live' });

  const log = await captureLogAsync(() => withStreams(false, () => runManage(root, { service: 'search' })));

  assert.match(log, /⚑ Skipped — needs an interactive run/,
    'a consent gap belongs in the pending aggregate, not only in the walkthrough scroll-back');
  assert.match(log, /search\/preflight/, 'the ⚑ line names the service');
  assert.match(log, /npm run manage -- --service=search/);
});

test('runManage: the cycle continues past preflight skips (absorb, never crash)', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, {}));

  // edge (and friends) skipped by preflight…
  assert.equal(report.results.edge.status, 'skipped');
  assert.match(report.results.edge.reason, /^preflight: /);
  // …while later services still ran — the loop never stopped
  assert.ok(report.results.testing, 'testing service should still have run');
  assert.ok(report.results.workspace, 'workspace service should still have run');
});
