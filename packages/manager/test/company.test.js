/**
 * Company-mode tests — the COMPANY → BRAND rung: discovery under
 * brands.roots (incl. Ian's siblings-of-the-workspace shape), the
 * config-layer chain (manager DEFAULTS ← company ← brand), the
 * .omega/company.json stamp lifecycle (idempotent write, brand-local
 * layering, stale warning), the company←brand .env precedence, the
 * company-flag argv filter, and runCompany end-to-end over staged fixture
 * companies with REAL manage child processes (sequential, --brand filter,
 * --parallel, disabled brands, and the synthetic error entry when a child
 * dies before writing run output).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { loadConfig } = require('@omega.js/config');

const {
  isCompanyRoot,
  resolveManageRoot,
  discoverBrands,
  loadCompanyConfig,
  stampCompanyMarker,
  readCompanyMarker,
  filterChildArgs,
} = require('../src/lib/company.js');
const { loadBrand } = require('../src/lib/brand.js');
const { DEFAULTS } = require('../src/config.js');
const { runCompany, collectChildResult } = require('../src/company.js');
const { runManage } = require('../src/manage.js');
const { RunSummary } = require('../src/lib/run-summary.js');

// ─── Fixture staging ─────────────────────────────────────────────────────────

const COMPANY_CONFIG = `{
  brand: { name: 'Fixture Co' },
  monitoring: { providers: { sentry: { dsn: 'https://company@sentry.example/1' } } },
  brands: { roots: ['./brands'] },
}`;

function brandConfig(id, extra = '') {
  return `{
  brand: { id: '${id}', name: '${id} brand', url: 'https://${id}.test' },
  targets: { web: {} },${extra}
}`;
}

/** A minimal brand monorepo dir (the manage.test fixture shape, no build). */
function stageBrandDir(parentDir, dirName, { config } = {}) {
  const root = path.join(parentDir, dirName);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: dirName, private: true, workspaces: ['targets/*'],
  }, null, 2));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config || brandConfig(dirName));

  const website = path.join(root, 'targets', 'website');
  fs.mkdirSync(website, { recursive: true });
  fs.writeFileSync(path.join(website, 'package.json'), JSON.stringify({
    name: `${dirName}-website`, private: true,
  }, null, 2));

  return root;
}

/** A company workspace with brands under ./brands. */
function stageCompany({ config = COMPANY_CONFIG, brandIds = ['brand-a', 'brand-b'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-company-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config);

  const brandsDir = path.join(root, 'brands');
  fs.mkdirSync(brandsDir);
  const brands = {};
  for (const id of brandIds) {
    brands[id] = stageBrandDir(brandsDir, id);
  }

  return { root, brandsDir, brands };
}

// ─── Detection / discovery ───────────────────────────────────────────────────

test('company: a config with brands.roots is a company root; a brand is not', () => {
  const { root, brands } = stageCompany();

  assert.equal(isCompanyRoot(root), true);
  assert.equal(isCompanyRoot(brands['brand-a']), false);

  assert.deepEqual(resolveManageRoot(root), { root, isCompany: true });
  // From inside a brand under the company, the BRAND is the manage root
  assert.deepEqual(resolveManageRoot(path.join(brands['brand-a'], 'targets', 'website')), {
    root: brands['brand-a'],
    isCompany: false,
  });
});

test('company: discovery finds brands under ./brands sorted by id, skipping non-brands and nested companies', () => {
  const { root, brandsDir } = stageCompany({ brandIds: ['brand-b', 'brand-a'] });
  fs.mkdirSync(path.join(brandsDir, 'not-a-brand'));
  stageBrandDir(brandsDir, 'nested-co', { config: `{ brands: { roots: ['./x'] } }` });

  const { brands, skipped } = discoverBrands(root);

  assert.deepEqual(brands.map((b) => b.id), ['brand-a', 'brand-b']);
  assert.deepEqual(brands.map((b) => b.enabled), [true, true]);
  assert.equal(brands[0].root, path.join(brandsDir, 'brand-a'));
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /nested company/);
});

test('company: Ian\'s shape — roots [".."] scans the org folder siblings and never lists the company itself', () => {
  // {org}/company + {org}/brand-x as siblings
  const org = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-org-'));
  const company = path.join(org, 'company');
  fs.mkdirSync(path.join(company, 'config'), { recursive: true });
  fs.writeFileSync(path.join(company, 'config', 'omega.json5'), `{ brands: { roots: ['..'] } }`);
  stageBrandDir(org, 'brand-x');

  const { brands } = discoverBrands(company);

  assert.deepEqual(brands.map((b) => b.id), ['brand-x']);
});

test('company: absolute or missing brands.roots entries are config errors', () => {
  const abs = stageCompany({ config: `{ brands: { roots: ['/tmp/nope'] } }` });
  assert.throws(() => discoverBrands(abs.root), /RELATIVE to the company root/);

  const missing = stageCompany({ config: `{ brands: { roots: ['./no-such-dir'] } }` });
  assert.throws(() => discoverBrands(missing.root), /brands root not found/);
});

// ─── Company config layer / marker ───────────────────────────────────────────

test('company: loadCompanyConfig strips the brands key and hard-fails on secret-shaped keys', () => {
  const { root } = stageCompany();
  const layer = loadCompanyConfig(root);

  assert.equal(layer.monitoring.providers.sentry.dsn, 'https://company@sentry.example/1');
  assert.equal('brands' in layer, false);

  const leaky = stageCompany({ config: `{ oauth2: { clientSecret: 'oops' }, brands: { roots: ['./brands'] } }` });
  assert.throws(() => loadCompanyConfig(leaky.root), /Secret-shaped keys in company config/);
});

test('company: loadBrand layers DEFAULTS ← company ← brand off the stamp, brand values winning', () => {
  const { root, brands } = stageCompany({ brandIds: ['brand-a'] });

  const standalone = loadBrand(brands['brand-a']);
  assert.equal(standalone.config.monitoring, undefined);        // no layer without a stamp

  stampCompanyMarker(brands['brand-a'], root);

  const layered = loadBrand(brands['brand-a']);
  assert.equal(layered.config.monitoring.providers.sentry.dsn, 'https://company@sentry.example/1'); // company fills the gap
  assert.equal(layered.config.brand.name, 'brand-a brand');     // brand wins over 'Fixture Co'
  assert.equal(layered.config.enabled, true);                   // manager DEFAULTS underneath
});

test('company: the manager adds NO company fold of its own — loadBrand equals a direct loadConfig (#83)', () => {
  const { root, brands } = stageCompany({ brandIds: ['brand-a'] });
  const brandRoot = brands['brand-a'];

  // No brand.url → loadBrand's `{ domain }` templating is a no-op, so the two
  // configs can differ ONLY by how the layers were merged.
  fs.writeFileSync(
    path.join(brandRoot, 'config', 'omega.json5'),
    `{ brand: { id: 'brand-a', name: 'brand-a brand' }, targets: { web: {} } }`,
  );
  stampCompanyMarker(brandRoot, root);

  const viaManager = loadBrand(brandRoot).config;
  const direct = loadConfig(brandRoot, undefined, { defaults: DEFAULTS }).config;

  // The company layer is genuinely in play (this equality is not vacuous) …
  assert.equal(viaManager.monitoring.providers.sentry.dsn, 'https://company@sentry.example/1');
  assert.equal(viaManager.brand.name, 'brand-a brand');
  // … and the manager contributes nothing on top of @omega.js/config's chain:
  // re-adding a manager-side fold at a different rung breaks this equality.
  assert.deepEqual(viaManager, direct);
});

test('company: stamp is idempotent — unchanged marker is never rewritten', () => {
  const { root, brands } = stageCompany({ brandIds: ['brand-a'] });
  const markerPath = path.join(brands['brand-a'], '.omega', 'company.json');

  assert.equal(stampCompanyMarker(brands['brand-a'], root), true);
  assert.deepEqual(jetpack.read(markerPath, 'json'), { root });

  const mtime = fs.statSync(markerPath).mtimeMs;
  assert.equal(stampCompanyMarker(brands['brand-a'], root), false);
  assert.equal(fs.statSync(markerPath).mtimeMs, mtime);

  assert.deepEqual(readCompanyMarker(brands['brand-a']), { companyRoot: root, stale: false });
});

test('company: a marker pointing at a non-company is stale; no marker is standalone', () => {
  const { brands } = stageCompany({ brandIds: ['brand-a'] });

  assert.equal(readCompanyMarker(brands['brand-a']), null);

  const gone = path.join(os.tmpdir(), `omega-company-gone-${Date.now()}`);
  stampCompanyMarker(brands['brand-a'], gone);
  assert.deepEqual(readCompanyMarker(brands['brand-a']), { companyRoot: gone, stale: true });
});

test('company: filterChildArgs strips company flags in both forms, forwards the rest verbatim', () => {
  // The leading verb goes too (#229): the spawn names `manage` itself, so
  // forwarding it would run `omega manage manage` in every brand
  assert.deepEqual(
    filterChildArgs(['manage', '--brand', 'x', '--service=workspace', '--parallel', '--concurrency', '4', '--dry-run']),
    ['--service=workspace', '--dry-run'],
  );
  assert.deepEqual(
    filterChildArgs(['--brand=x,y', '--concurrency=2', '--service', 'update']),
    ['--service', 'update'],
  );
});

// ─── Brand-local runs under a company (in-process) ───────────────────────────

test('company: a stamped brand layers company config and .env (shell > brand > company)', async () => {
  const { root, brands } = stageCompany({ brandIds: ['brand-a'] });
  fs.writeFileSync(path.join(root, '.env'), 'OMEGA_TEST_B=from-company\nOMEGA_TEST_C=from-company\n');
  fs.writeFileSync(path.join(brands['brand-a'], '.env'), 'OMEGA_TEST_A=from-brand\nOMEGA_TEST_B=from-brand\n');
  stampCompanyMarker(brands['brand-a'], root);

  delete process.env.OMEGA_TEST_A;
  delete process.env.OMEGA_TEST_B;
  delete process.env.OMEGA_TEST_C;

  try {
    const report = await runManage(brands['brand-a'], { service: 'workspace' });

    assert.equal(report.brand.config.monitoring.providers.sentry.dsn, 'https://company@sentry.example/1');
    assert.equal(report.brand.config.brand.name, 'brand-a brand');
    assert.equal(process.env.OMEGA_TEST_A, 'from-brand');
    assert.equal(process.env.OMEGA_TEST_B, 'from-brand');
    assert.equal(process.env.OMEGA_TEST_C, 'from-company');
  } finally {
    delete process.env.OMEGA_TEST_A;
    delete process.env.OMEGA_TEST_B;
    delete process.env.OMEGA_TEST_C;
  }
});

test('company: a stale marker runs standalone (no company layer)', async () => {
  const { brands } = stageCompany({ brandIds: ['brand-a'] });
  stampCompanyMarker(brands['brand-a'], path.join(os.tmpdir(), 'omega-company-vanished'));

  const report = await runManage(brands['brand-a'], { service: 'workspace' });

  assert.equal(report.brand.config.monitoring, undefined);
  assert.equal(report.results.workspace.status, 'success');
});

// ─── runCompany end-to-end (real manage children) ────────────────────────────

test('company: sequential run — children run per brand, stamps + logs + run files land, one aggregate summary', async () => {
  const { root, brands } = stageCompany();
  const summary = new RunSummary();

  const report = await runCompany(root, {}, ['--service=workspace'], { summary });

  assert.equal(report.hasErrors, false);
  assert.deepEqual(report.brands.map((b) => b.id), ['brand-a', 'brand-b']);

  for (const id of ['brand-a', 'brand-b']) {
    // Stamped for brand-local layering
    assert.deepEqual(jetpack.read(path.join(brands[id], '.omega', 'company.json'), 'json'), { root });

    // The child wrote its own run file with the one forwarded service
    const runsDir = path.join(brands[id], '.omega', 'runs');
    const runs = fs.readdirSync(runsDir);
    assert.equal(runs.length, 1);
    const run = jetpack.read(path.join(runsDir, runs[0]), 'json');
    assert.deepEqual(run.services.map((s) => s.service), ['workspace']);
    assert.equal(run.services[0].status, 'success');

    // The company-side log tee captured the child, including the layered header
    const log = fs.readFileSync(path.join(root, '.omega', 'logs', `${id}.log`), 'utf8');
    assert.match(log, /Company:/);
    assert.match(log, new RegExp(id));
  }

  // Aggregate summary: one workspace entry per brand
  assert.deepEqual(
    summary.entries.map((e) => [e.brandId, e.serviceName, e.result.status]),
    [['brand-a', 'workspace', 'success'], ['brand-b', 'workspace', 'success']],
  );

  // Company root .omega/ got gitignored
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.omega\//);
});

test('company: --brand filters to the named brand; unknown brands throw with the available list', async () => {
  const { root, brands } = stageCompany();

  await runCompany(root, { brand: 'brand-b' }, ['--service=workspace'], { summary: new RunSummary() });

  assert.equal(fs.existsSync(path.join(brands['brand-b'], '.omega', 'runs')), true);
  assert.equal(fs.existsSync(path.join(brands['brand-a'], '.omega', 'runs')), false);
  // Stamping covers every discovered brand, filtered or not
  assert.equal(fs.existsSync(path.join(brands['brand-a'], '.omega', 'company.json')), true);

  await assert.rejects(
    () => runCompany(root, { brand: 'nope' }, [], { summary: new RunSummary() }),
    /Unknown brand\(s\): nope\. Available: brand-a, brand-b/,
  );
});

test('company: --parallel runs children concurrently with the same aggregate', async () => {
  const { root, brands } = stageCompany();
  const summary = new RunSummary();

  const report = await runCompany(root, { parallel: true }, ['--service=workspace'], { summary });

  assert.equal(report.hasErrors, false);
  for (const id of ['brand-a', 'brand-b']) {
    assert.equal(fs.readdirSync(path.join(brands[id], '.omega', 'runs')).length, 1);
  }
  assert.equal(summary.entries.length, 2);
  assert.ok(summary.entries.every((e) => e.result.status === 'success'));
});

test('company: disabled brands are stamped but never spawned', async () => {
  const { root, brands, brandsDir } = stageCompany();
  stageBrandDir(brandsDir, 'brand-off', { config: brandConfig('brand-off', `\n  enabled: false,`) });
  const summary = new RunSummary();

  await runCompany(root, {}, ['--service=workspace'], { summary });

  const offRoot = path.join(brandsDir, 'brand-off');
  assert.equal(fs.existsSync(path.join(offRoot, '.omega', 'company.json')), true);
  assert.equal(fs.existsSync(path.join(offRoot, '.omega', 'runs')), false);
  assert.deepEqual([...new Set(summary.entries.map((e) => e.brandId))], ['brand-a', 'brand-b']);
  assert.equal(fs.existsSync(path.join(brands['brand-a'], '.omega', 'runs', fs.readdirSync(path.join(brands['brand-a'], '.omega', 'runs'))[0])), true);
});

test('company: a child that dies before writing run output gets a synthetic error entry', async () => {
  const { root } = stageCompany({ brandIds: ['brand-a'] });
  const summary = new RunSummary();

  // --service=bogus makes runManage throw before any run file is written
  const report = await runCompany(root, {}, ['--service=bogus'], { summary });

  assert.equal(report.hasErrors, true);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].serviceName, 'manage');
  assert.match(summary.entries[0].result.error, /exited with code \d+ before writing run output/);
});

test('company: collectChildResult adds nothing for a clean exit with no run file', () => {
  const { brands } = stageCompany({ brandIds: ['brand-a'] });
  const summary = new RunSummary();

  collectChildResult({ id: 'brand-a', name: 'a', root: brands['brand-a'] }, Date.now(), 0, summary);

  assert.equal(summary.entries.length, 0);
});

test('company: an empty company throws with guidance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-company-empty-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{ brands: { roots: ['./brands'] } }`);
  fs.mkdirSync(path.join(root, 'brands'));

  await assert.rejects(() => runCompany(root, {}, []), /No brands found/);
});
