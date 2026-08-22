/**
 * Brand loading + end-to-end manage tests over staged fixture brand
 * monorepos: target-dir→target mapping, root resolution from any depth, the full
 * workspace → update → testing loop, idempotent rerun, and hard failure on
 * an unloadable brand config (secret-shaped keys).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveBrandRoot, loadBrand, discoverTargets, targetFromDirName } = require('../src/lib/brand.js');
const { runManage } = require('../src/manage.js');
const { CONSENT_REQUIRED } = require('../src/lib/google-auth.js');
const { SERVICE_ORDER, BOOT_SERVICES } = require('../src/config.js');

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
delete process.env.OMEGA_WEBHOOK_KEY;
delete process.env.BEEHIIV_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.CHARGEBEE_API_KEY;
delete process.env.SLAPFORM_SERVICE_ACCOUNT;
delete process.env.CHATSY_SERVICE_ACCOUNT;
delete process.env.REPLYIFY_SERVICE_ACCOUNT;
delete process.env.SERVER_SERVICE_ACCOUNT;
delete process.env.APPLE_API_ISSUER;
delete process.env.APPLE_API_KEY_ID;
delete process.env.APPLE_TEAM_ID;
delete process.env.CSC_KEY_PASSWORD;
delete process.env.APPLE_KEYCHAIN_PASSWORD;
delete process.env.ACCOUNT_PASSWORD_SEED;

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

// A website target with NO deps (install skips — no network in tests) whose
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

function stageBrand({ config = BRAND_CONFIG, targets = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-brand-'));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2));

  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config);

  if (targets) {
    const website = path.join(root, 'targets', 'website');
    fs.mkdirSync(website, { recursive: true });
    fs.writeFileSync(path.join(website, 'package.json'), WEBSITE_PKG);
    fs.writeFileSync(path.join(website, 'build.js'), WEBSITE_BUILD);
  }

  return root;
}

// ─── Brand root resolution ───────────────────────────────────────────────────

test('resolveBrandRoot: from the root, from inside a target, from a nested dir', () => {
  const root = stageBrand();
  const nested = path.join(root, 'targets', 'website', 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });

  assert.equal(resolveBrandRoot(root), root);
  assert.equal(resolveBrandRoot(path.join(root, 'targets', 'website')), root);
  assert.equal(resolveBrandRoot(nested), root);
});

test('resolveBrandRoot: a target\'s own config dir never masquerades as the brand root', () => {
  const root = stageBrand();
  // Give the target its own config/omega.json5 — resolution from inside it must
  // still climb to the BRAND root
  const targetConfig = path.join(root, 'targets', 'website', 'config');
  fs.mkdirSync(targetConfig, { recursive: true });
  fs.writeFileSync(path.join(targetConfig, 'omega.json5'), `{ targets: { web: {} } }`);

  assert.equal(resolveBrandRoot(path.join(root, 'targets', 'website')), root);
});

test('resolveBrandRoot: a brand nested in a parent workspace\'s targets/ dir still resolves (sandbox-brand case)', () => {
  // {outer}/targets/my-brand/{config,targets/website} — no config above my-brand,
  // so my-brand is the brand root even though it sits under a targets/ dir
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-outer-'));
  const brandRoot = path.join(outer, 'targets', 'my-brand');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), BRAND_CONFIG);
  const website = path.join(brandRoot, 'targets', 'website');
  fs.mkdirSync(website, { recursive: true });

  assert.equal(resolveBrandRoot(brandRoot), brandRoot);
  assert.equal(resolveBrandRoot(website), brandRoot);
});

test('resolveBrandRoot: null outside any brand', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-empty-'));
  assert.equal(resolveBrandRoot(empty), null);
});

// ─── Target dir → target mapping ─────────────────────────────────────────────

test('targetFromDirName: exact and prefixed conventions', () => {
  assert.equal(targetFromDirName('website'), 'web');
  assert.equal(targetFromDirName('website-docs'), 'web');
  assert.equal(targetFromDirName('backend'), 'backend');
  assert.equal(targetFromDirName('extension'), 'extension');
  assert.equal(targetFromDirName('totally-custom'), null);
});

test('loadBrand: declared target beats naming; unconventional dirs map via their config', () => {
  const root = stageBrand();

  // targets/api declares targets.backend in its target-root config/omega.json5
  // (ONE authored location for every target since the src/dist pillar —
  // functions/config is staged output now) and "api" matches no convention
  const apiConfig = path.join(root, 'targets', 'api', 'config');
  fs.mkdirSync(apiConfig, { recursive: true });
  fs.writeFileSync(path.join(apiConfig, 'omega.json5'), `{ targets: { backend: {} } }`);

  const brand = loadBrand(root);
  assert.equal(brand.id, 'fixture-brand');
  assert.deepEqual(brand.enabledTargets, ['web']);

  const byName = Object.fromEntries(brand.targets.map((entry) => [entry.name, entry.target]));
  assert.equal(byName.website, 'web');
  assert.equal(byName.api, 'backend');
});

test('loadBrand: config load failure lands in configError, never throws', () => {
  const root = stageBrand({
    config: `{ brand: { id: 'x', name: 'X' }, oauth2: { clientSecret: 'oops' }, targets: { web: {} } }`,
  });

  const brand = loadBrand(root);
  assert.match(brand.configError, /Secret-shaped keys/);
  assert.deepEqual(brand.enabledTargets, []);
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

// ─── One vocabulary (#443) ───────────────────────────────────────────────────

/** A pre-#443 brand: its surfaces still under apps/, the glob still apps/*. */
function stageLegacyBrand() {
  const root = stageBrand();

  fs.renameSync(path.join(root, 'targets'), path.join(root, 'apps'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['apps/*'],
  }, null, 2));

  return root;
}

test('discoverTargets: a brand still on apps/ fails LOUD with the migration pointer, never a zero-target walk', () => {
  const root = stageLegacyBrand();

  assert.throws(() => discoverTargets(root), /still carries apps\/ instead of targets\/ \(#443\)/);
  assert.throws(() => loadBrand(root), /--migration=targets-rename --execute/);
});

test('runManage: --migration=targets-rename runs the rename ALONE — the one brand discovery refuses to walk', async () => {
  const root = stageLegacyBrand();

  const audit = await runManage(root, { migration: 'targets-rename' });
  assert.equal(audit.hasErrors, false);
  assert.equal(audit.results.migrations.output.targetsRename.audit, true);
  assert.ok(fs.existsSync(path.join(root, 'apps', 'website')), 'the default run moved nothing');

  const report = await runManage(root, { migration: 'targets-rename', execute: true });
  assert.equal(report.hasErrors, false);
  assert.ok(!fs.existsSync(path.join(root, 'apps')), 'apps/ is gone');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces,
    ['targets/*'],
  );

  // …and the brand the migration fixed now loads like any other
  assert.deepEqual(loadBrand(root).targets.map((entry) => entry.name), ['website']);
});

// ─── End-to-end manage ───────────────────────────────────────────────────────

// Testing's live checks read fetch/retryDelayMs from runManage options — a
// canned 200 keeps the full loop network-free (the fixture URL never resolves)
const FAKE_FETCH_200 = { fetch: async () => ({ status: 200, json: async () => ({}) }), retryDelayMs: 0 };

test('runManage: full loop — workspace, update (build), testing all pass; run output + gitignore written', async () => {
  const root = stageBrand();

  const report = await runManage(root, { ...FAKE_FETCH_200 });

  assert.equal(report.hasErrors, false);
  assert.equal(report.results.workspace.status, 'success');
  // No repo.providers.github.org configured (manager defaults alone don't enable it) → clean skip
  assert.equal(report.results.repo.status, 'skipped');
  assert.match(report.results.repo.reason, /github\.org/);
  // No CLOUDFLARE_TOKEN in the environment → clean skip
  assert.equal(report.results.edge.status, 'skipped');
  assert.match(report.results.edge.reason, /CLOUDFLARE_TOKEN/);
  // No domain.providers registrar configured → clean skip
  assert.equal(report.results.domain.status, 'skipped');
  assert.match(report.results.domain.reason, /domain\.providers/);
  // No cloud.config.projectId configured → clean skip
  assert.equal(report.results.cloud.status, 'skipped');
  assert.match(report.results.cloud.reason, /cloud\.config\.projectId/);
  // No shared reCAPTCHA keys in the environment → clean skip
  assert.equal(report.results.captcha.status, 'skipped');
  assert.match(report.results.captcha.reason, /RECAPTCHA_SITE_KEY/);
  // No analytics providers configured → clean skip
  assert.equal(report.results.analytics.status, 'skipped');
  assert.match(report.results.analytics.reason, /no analytics providers/);
  // No Google credentials in the environment → clean skip
  assert.equal(report.results.search.status, 'skipped');
  assert.match(report.results.search.reason, /GOOGLE_CLIENT_ID/);
  // No advertising provider authored → clean skip (wave-5 F10: through the
  // REAL pipeline — proves the DEFAULTS merge doesn't resurrect the entry)
  assert.equal(report.results.advertising.status, 'skipped');
  assert.match(report.results.advertising.reason, /no advertising\.providers\.adsense/);
  // No monitoring section configured → clean skip
  assert.equal(report.results.monitoring.status, 'skipped');
  assert.match(report.results.monitoring.reason, /no monitoring config/);
  // No SendGrid API key in the environment → clean skip
  assert.equal(report.results.campaigns.status, 'skipped');
  assert.match(report.results.campaigns.reason, /SENDGRID_API_KEY/);
  // No Beehiiv API key in the environment → clean skip
  assert.equal(report.results.newsletter.status, 'skipped');
  assert.match(report.results.newsletter.reason, /BEEHIIV_API_KEY/);
  // Fixture has no priced products → clean skip before any provider check
  assert.equal(report.results.payment.status, 'skipped');
  assert.match(report.results.payment.reason, /no paid products/);
  // No forms.providers.slapform.formId configured → clean skip
  assert.equal(report.results.forms.status, 'skipped');
  assert.match(report.results.forms.reason, /forms\.providers\.slapform\.formId/);
  // No inbound.chat.providers.chatsy.agentId configured → clean skip
  assert.equal(report.results.chat.status, 'skipped');
  assert.match(report.results.chat.reason, /inbound\.chat\.providers\.chatsy\.agentId/);
  // Web-only fixture → the email agent has no backend to answer for
  assert.equal(report.results.email.status, 'skipped');
  assert.match(report.results.email.reason, /no backend target/);
  // No company-server service account → clean skip
  assert.equal(report.results.server.status, 'skipped');
  assert.match(report.results.server.reason, /SERVER_SERVICE_ACCOUNT/);
  // Fixture has no logo sources → clean skip with guidance
  assert.equal(report.results.assets.status, 'skipped');
  assert.match(report.results.assets.reason, /brandmark\.svg/);
  // Web-only fixture → no desktop/mobile target to sign for
  assert.equal(report.results.certificates.status, 'skipped');
  assert.match(report.results.certificates.reason, /no desktop or mobile target/);
  // No parasite SEO content configured → clean skip with sidecar guidance
  assert.equal(report.results.seo.status, 'skipped');
  assert.match(report.results.seo.reason, /no SEO content configured/);
  assert.equal(report.results.update.status, 'success');
  // Web-only fixture → no backend whose Firebase Auth accounts to manage
  assert.equal(report.results.account.status, 'skipped');
  assert.match(report.results.account.reason, /no backend target/);
  // Data migrations never run without the explicit --migration flag
  assert.equal(report.results.migrations.status, 'skipped');
  assert.match(report.results.migrations.reason, /--migration flag not set/);
  assert.equal(report.results.testing.status, 'success');

  // The build actually produced the site
  assert.ok(fs.existsSync(path.join(root, 'targets', 'website', 'dist', 'index.html')));

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
  assert.deepEqual(run.services.map((s) => s.service), ['workspace', 'repo', 'edge', 'domain', 'cloud', 'captcha', 'analytics', 'search', 'advertising', 'monitoring', 'campaigns', 'newsletter', 'payment', 'forms', 'chat', 'email', 'server', 'directory', 'assets', 'certificates', 'disperse', 'seo', 'update', 'account', 'migrations', 'bookmark', 'testing']);

  // .omega/ got gitignored
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.omega/'));
});

test('runManage: rerun is idempotent — same statuses, single gitignore entry', async () => {
  const root = stageBrand();

  await runManage(root, { ...FAKE_FETCH_200 });
  const second = await runManage(root, { ...FAKE_FETCH_200 });

  assert.equal(second.hasErrors, false);
  assert.equal(second.results.workspace.status, 'success');
  assert.equal(second.results.testing.status, 'success');

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const entries = gitignore.split('\n').filter((line) => line.trim() === '.omega/');
  assert.equal(entries.length, 1);
});

test('runManage: a service that ran carries its wall time, in the report and the run record', async () => {
  const root = stageBrand();

  const report = await runManage(root, { service: 'workspace' });

  assert.equal(typeof report.results.workspace.durationMs, 'number');
  assert.ok(report.results.workspace.durationMs >= 0);

  const runsDir = path.join(root, '.omega', 'runs');
  const run = JSON.parse(fs.readFileSync(path.join(runsDir, fs.readdirSync(runsDir)[0]), 'utf8'));
  assert.equal(typeof run.services[0].durationMs, 'number');
});

test('runManage: a service run() that hits a consent gate warns — the walk continues, the report stays clean (#228)', async () => {
  const root = stageBrand();

  // A dead Google grant surfaces as the coded throw from inside the service,
  // past preflight (which only knows what the token store RECORDS).
  const servicePath = require.resolve('../src/services/repo/index.js');
  const original = require.cache[servicePath];
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    path: path.dirname(servicePath),
    loaded: true,
    exports: {
      run: async () => {
        const error = new Error('Google consent required (scopes: webmasters) — run the service once interactively to grant it');
        error.code = CONSENT_REQUIRED;
        throw error;
      },
    },
  };

  let report;
  try {
    report = await runManage(root, { ...FAKE_FETCH_200 });
  } finally {
    if (original) {
      require.cache[servicePath] = original;
    } else {
      delete require.cache[servicePath];
    }
  }

  assert.equal(report.results.repo.status, 'warned', 'a pending human gate is not a failure');
  assert.match(report.results.repo.output.auth.needsInteractive, /Google consent required/);
  assert.equal(report.results.testing.status, 'success', 'the walk ran on to the last service');
  assert.equal(report.hasErrors, false, 'so the dev boot reading this report still starts the stack');
});

// ─── Lanes (#228) ────────────────────────────────────────────────────────────

/** captureLog for an async run (the walk + its printed walkthrough/summary). */
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

test('config: the boot lane is the local slice — file work only, and every entry is a real service', () => {
  assert.deepEqual([...BOOT_SERVICES], ['workspace', 'assets', 'disperse'],
    'network/rebuild services stay out — a dev boot waits on this list');
  for (const service of BOOT_SERVICES) {
    assert.ok(SERVICE_ORDER.includes(service), `${service} is not in SERVICE_ORDER — a rename orphaned the lane list`);
  }
});

test('runManage: lane boot walks exactly the boot services, in SERVICE_ORDER order (#228)', async () => {
  const root = stageBrand();

  const report = await runManage(root, { lane: 'boot' });

  assert.deepEqual(Object.keys(report.results), ['workspace', 'assets', 'disperse'],
    'the slow lane (cloud, campaigns, update, account…) never runs at boot');
  assert.equal(report.hasErrors, false);
});

test('runManage: an unknown lane throws instead of silently walking everything', async () => {
  const root = stageBrand();

  await assert.rejects(() => runManage(root, { lane: 'quick' }), /Unknown lane/);
});

test('runManage: --service still wins over a lane (the more specific ask)', async () => {
  const root = stageBrand();

  const report = await runManage(root, { service: 'workspace', lane: 'boot' });

  assert.deepEqual(Object.keys(report.results), ['workspace']);
});

test('runManage: on a boot lane, preflight still names what MANAGE owes — without walking or failing it (#228)', async () => {
  const root = stageBrand();

  let report;
  const log = await captureLogAsync(async () => {
    report = await runManage(root, { lane: 'boot' });
  });

  // The full setup's gaps are still reported…
  assert.match(log, /⚑ Preflight/);
  assert.match(log, /edge — missing CLOUDFLARE_TOKEN/);
  // …but a manage-lane finding never becomes a result of THIS run
  assert.equal(report.results.edge, undefined, 'an unwalked service records nothing');
  assert.equal(report.hasErrors, false, 'and never fails the boot');
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

test('runManage: enabled target with no dir is a structure error naming the dir to create', async () => {
  const root = stageBrand({
    config: `{
      brand: { id: 'fixture-brand', name: 'Fixture', url: 'https://fixture-brand.test' },
      targets: { web: {}, backend: {} },
    }`,
  });

  const report = await runManage(root, {});

  assert.equal(report.hasErrors, true);
  assert.match(report.results.workspace.error, /create targets\/backend\//);
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
  assert.ok(!fs.existsSync(path.join(root, 'targets', 'website', 'dist')));
  // testing then honestly reports the missing build output
  assert.equal(report.results.testing.status, 'error');
});
