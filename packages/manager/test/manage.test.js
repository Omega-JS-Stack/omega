/**
 * Brand loading + end-to-end manage tests over staged fixture brand
 * monorepos: app→target mapping, root resolution from any depth, the full
 * workspace → update → testing loop, idempotent rerun, and hard failure on
 * an unloadable brand config (secret-shaped keys).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveBrandRoot, loadBrand, targetFromDirName } = require('../src/lib/brand.js');
const { runManage } = require('../src/manage.js');

// Fixture brands must never reach a real Cloudflare/Namecheap/Google account
// via shell-exported credentials — those services must skip in every e2e run
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.NAMECHEAP_USERNAME;
delete process.env.NAMECHEAP_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.TIKTOK_ACCESS_TOKEN;
delete process.env.SENDGRID_API_KEY;
delete process.env.BACKEND_MANAGER_WEBHOOK_KEY;
delete process.env.BEEHIIV_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.CHARGEBEE_API_KEY;
delete process.env.SLAPFORM_SERVICE_ACCOUNT;
delete process.env.CHATSY_SERVICE_ACCOUNT;
delete process.env.REPLYIFY_SERVICE_ACCOUNT;
delete process.env.SERVER_SERVICE_ACCOUNT;

// ─── Fixture staging ─────────────────────────────────────────────────────────

const BRAND_CONFIG = `{
  brand: {
    id: 'fixture-brand',
    name: 'Fixture Brand',
    url: 'https://fixture-brand.test',
  },
  targets: {
    web: {},
  },
}`;

// A website app with NO deps (install skips — no network in tests) whose
// build writes dist/index.html, mirroring a real web target's output.
const WEBSITE_PKG = JSON.stringify({
  name: 'fixture-website',
  private: true,
  scripts: { build: 'node build.js' },
}, null, 2);

const WEBSITE_BUILD = `const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), '<!doctype html><title>fixture</title>');
`;

function stageBrand({ config = BRAND_CONFIG, apps = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-brand-'));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['apps/*'],
  }, null, 2));

  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config);

  if (apps) {
    const website = path.join(root, 'apps', 'website');
    fs.mkdirSync(website, { recursive: true });
    fs.writeFileSync(path.join(website, 'package.json'), WEBSITE_PKG);
    fs.writeFileSync(path.join(website, 'build.js'), WEBSITE_BUILD);
  }

  return root;
}

// ─── Brand root resolution ───────────────────────────────────────────────────

test('resolveBrandRoot: from the root, from inside an app, from a nested dir', () => {
  const root = stageBrand();
  const nested = path.join(root, 'apps', 'website', 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });

  assert.equal(resolveBrandRoot(root), root);
  assert.equal(resolveBrandRoot(path.join(root, 'apps', 'website')), root);
  assert.equal(resolveBrandRoot(nested), root);
});

test('resolveBrandRoot: an app\'s own config dir never masquerades as the brand root', () => {
  const root = stageBrand();
  // Give the app its own config/omega.json5 — resolution from inside it must
  // still climb to the BRAND root
  const appConfig = path.join(root, 'apps', 'website', 'config');
  fs.mkdirSync(appConfig, { recursive: true });
  fs.writeFileSync(path.join(appConfig, 'omega.json5'), `{ targets: { web: {} } }`);

  assert.equal(resolveBrandRoot(path.join(root, 'apps', 'website')), root);
});

test('resolveBrandRoot: a brand nested in a parent workspace\'s apps/ dir still resolves (sandbox-brand case)', () => {
  // {outer}/apps/my-brand/{config,apps/website} — no config above my-brand,
  // so my-brand is the brand root even though it sits under an apps/ dir
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-outer-'));
  const brandRoot = path.join(outer, 'apps', 'my-brand');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), BRAND_CONFIG);
  const website = path.join(brandRoot, 'apps', 'website');
  fs.mkdirSync(website, { recursive: true });

  assert.equal(resolveBrandRoot(brandRoot), brandRoot);
  assert.equal(resolveBrandRoot(website), brandRoot);
});

test('resolveBrandRoot: null outside any brand', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-empty-'));
  assert.equal(resolveBrandRoot(empty), null);
});

// ─── App → target mapping ────────────────────────────────────────────────────

test('targetFromDirName: exact and prefixed conventions', () => {
  assert.equal(targetFromDirName('website'), 'web');
  assert.equal(targetFromDirName('website-docs'), 'web');
  assert.equal(targetFromDirName('backend'), 'backend');
  assert.equal(targetFromDirName('extension'), 'extension');
  assert.equal(targetFromDirName('totally-custom'), null);
});

test('loadBrand: declared target beats naming; unconventional dirs map via their config', () => {
  const root = stageBrand();

  // apps/api declares targets.backend in functions/config/omega.json5 — the
  // BEM layout — and "api" matches no naming convention
  const functionsConfig = path.join(root, 'apps', 'api', 'functions', 'config');
  fs.mkdirSync(functionsConfig, { recursive: true });
  fs.writeFileSync(path.join(functionsConfig, 'omega.json5'), `{ targets: { backend: {} } }`);

  const brand = loadBrand(root);
  assert.equal(brand.id, 'fixture-brand');
  assert.deepEqual(brand.targets, ['web']);

  const byName = Object.fromEntries(brand.apps.map((a) => [a.name, a.target]));
  assert.equal(byName.website, 'web');
  assert.equal(byName.api, 'backend');
});

test('loadBrand: config load failure lands in configError, never throws', () => {
  const root = stageBrand({
    config: `{ brand: { id: 'x', name: 'X' }, oauth2: { clientSecret: 'oops' }, targets: { web: {} } }`,
  });

  const brand = loadBrand(root);
  assert.match(brand.configError, /Secret-shaped keys/);
  assert.deepEqual(brand.targets, []);
});

test('loadBrand: templates { domain } from brand.url', () => {
  const root = stageBrand({
    config: `{
      brand: { id: 'fixture-brand', name: 'Fixture', url: 'https://fixture-brand.test', contact: { email: 'support@{ domain }' } },
      targets: { web: {} },
    }`,
  });

  const brand = loadBrand(root);
  assert.equal(brand.config.brand.contact.email, 'support@fixture-brand.test');
});

// ─── End-to-end manage ───────────────────────────────────────────────────────

test('runManage: full loop — workspace, update (build), testing all pass; run output + gitignore written', async () => {
  const root = stageBrand();

  const report = await runManage(root, {});

  assert.equal(report.hasErrors, false);
  assert.equal(report.results.workspace.status, 'success');
  // No github.org configured (manager defaults alone don't enable it) → clean skip
  assert.equal(report.results.github.status, 'skipped');
  assert.match(report.results.github.reason, /github\.org/);
  // No CLOUDFLARE_TOKEN in the environment → clean skip
  assert.equal(report.results.cloudflare.status, 'skipped');
  assert.match(report.results.cloudflare.reason, /CLOUDFLARE_TOKEN/);
  // No domain.provider configured → clean skip
  assert.equal(report.results.domain.status, 'skipped');
  assert.match(report.results.domain.reason, /domain\.provider/);
  // No firebase.projectId configured → clean skip
  assert.equal(report.results.firebase.status, 'skipped');
  assert.match(report.results.firebase.reason, /firebase\.projectId/);
  // No shared reCAPTCHA keys in the environment → clean skip
  assert.equal(report.results.recaptcha.status, 'skipped');
  assert.match(report.results.recaptcha.reason, /RECAPTCHA_SITE_KEY/);
  // No analytics providers configured → clean skip
  assert.equal(report.results.analytics.status, 'skipped');
  assert.match(report.results.analytics.reason, /no analytics providers/);
  // No Google credentials in the environment → clean skip
  assert.equal(report.results['search-console'].status, 'skipped');
  assert.match(report.results['search-console'].reason, /GOOGLE_CLIENT_ID/);
  // No adsense.accountId configured → clean skip
  assert.equal(report.results.adsense.status, 'skipped');
  assert.match(report.results.adsense.reason, /adsense\.accountId/);
  // No SendGrid API key in the environment → clean skip
  assert.equal(report.results.sendgrid.status, 'skipped');
  assert.match(report.results.sendgrid.reason, /SENDGRID_API_KEY/);
  // No Beehiiv API key in the environment → clean skip
  assert.equal(report.results.beehiiv.status, 'skipped');
  assert.match(report.results.beehiiv.reason, /BEEHIIV_API_KEY/);
  // Fixture has no priced products → clean skip before any processor check
  assert.equal(report.results.payment.status, 'skipped');
  assert.match(report.results.payment.reason, /no paid products/);
  // No slapform.formId configured → clean skip
  assert.equal(report.results.slapform.status, 'skipped');
  assert.match(report.results.slapform.reason, /slapform\.formId/);
  // No chatsy.agentId configured → clean skip
  assert.equal(report.results.chatsy.status, 'skipped');
  assert.match(report.results.chatsy.reason, /chatsy\.agentId/);
  // Web-only fixture → the email agent has no backend to answer for
  assert.equal(report.results.replyify.status, 'skipped');
  assert.match(report.results.replyify.reason, /no backend target/);
  // No company-server service account → clean skip
  assert.equal(report.results.server.status, 'skipped');
  assert.match(report.results.server.reason, /SERVER_SERVICE_ACCOUNT/);
  assert.equal(report.results.update.status, 'success');
  assert.equal(report.results.testing.status, 'success');

  // The build actually produced the site
  assert.ok(fs.existsSync(path.join(root, 'apps', 'website', 'dist', 'index.html')));

  // Install was resolution-gated and skipped (fixture has no deps) — no stray
  // node_modules materialized
  const rootSteps = report.results.update.output.results.root.steps;
  assert.equal(rootSteps[0].phase, 'install');
  assert.equal(rootSteps[0].skipped, true);
  assert.ok(!fs.existsSync(path.join(root, 'node_modules')));

  // Transient run output landed in .omega/runs/
  const runsDir = path.join(root, '.omega', 'runs');
  assert.equal(fs.readdirSync(runsDir).length, 1);
  const run = JSON.parse(fs.readFileSync(path.join(runsDir, fs.readdirSync(runsDir)[0]), 'utf8'));
  assert.equal(run.brandId, 'fixture-brand');
  assert.deepEqual(run.services.map((s) => s.service), ['workspace', 'github', 'cloudflare', 'domain', 'firebase', 'recaptcha', 'analytics', 'search-console', 'adsense', 'sendgrid', 'beehiiv', 'payment', 'slapform', 'chatsy', 'replyify', 'server', 'update', 'testing']);

  // .omega/ got gitignored
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.omega/'));
});

test('runManage: rerun is idempotent — same statuses, single gitignore entry', async () => {
  const root = stageBrand();

  await runManage(root, {});
  const second = await runManage(root, {});

  assert.equal(second.hasErrors, false);
  assert.equal(second.results.workspace.status, 'success');
  assert.equal(second.results.testing.status, 'success');

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const entries = gitignore.split('\n').filter((line) => line.trim() === '.omega/');
  assert.equal(entries.length, 1);
});

test('runManage: unloadable brand config fails the workspace service and stops the run', async () => {
  const root = stageBrand({
    config: `{ brand: { id: 'x', name: 'X' }, oauth2: { clientSecret: 'oops' }, targets: { web: {} } }`,
  });

  const report = await runManage(root, {});

  assert.equal(report.hasErrors, true);
  assert.equal(report.results.workspace.status, 'error');
  assert.match(report.results.workspace.error, /Secret-shaped keys/);
  // stopOnError: update/testing never ran
  assert.equal(report.results.update, undefined);
  assert.equal(report.results.testing, undefined);
});

test('runManage: enabled target with no app is a structure error naming the dir to create', async () => {
  const root = stageBrand({
    config: `{
      brand: { id: 'fixture-brand', name: 'Fixture', url: 'https://fixture-brand.test' },
      targets: { web: {}, backend: {} },
    }`,
  });

  const report = await runManage(root, {});

  assert.equal(report.hasErrors, true);
  assert.match(report.results.workspace.error, /create apps\/backend\//);
});

test('runManage: disabled brand is skipped whole', async () => {
  const root = stageBrand({
    config: `{ enabled: false, brand: { id: 'fixture-brand', name: 'Fixture' }, targets: { web: {} } }`,
  });

  const report = await runManage(root, {});
  assert.equal(report.skipped, true);
  assert.equal(report.hasErrors, false);
});

test('runManage: --service runs exactly one service; unknown service throws', async () => {
  const root = stageBrand();

  const report = await runManage(root, { service: 'workspace' });
  assert.deepEqual(Object.keys(report.results), ['workspace']);

  await assert.rejects(() => runManage(root, { service: 'nope' }), /Unknown service/);
});

test('runManage: dry-run reports what update would do without building', async () => {
  const root = stageBrand();

  const report = await runManage(root, { dryRun: true });

  assert.equal(report.results.update.status, 'success');
  const websiteSteps = report.results.update.output.results.website.steps;
  assert.equal(websiteSteps[0].skipped, true);
  assert.ok(!fs.existsSync(path.join(root, 'apps', 'website', 'dist')));
  // testing then honestly reports the missing build output
  assert.equal(report.results.testing.status, 'error');
});
