/**
 * Onboard wizard tests: non-interactive flag/derivation paths, the real
 * interactive wizard over fake TTY streams, fill-missing (never-overwrite)
 * semantics, dry-run, company-mode placement + stamping, resume inside an
 * existing brand, the manage handoff, and the manage pins — workspace green
 * on a fresh scaffold, testing honestly nudging toward the update service.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');

const { runOnboard, deriveId, deriveName, deriveUrl } = require('../src/onboard.js');
const { discoverBrands } = require('../src/lib/company.js');
const { runManage } = require('../src/manage.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Fixture brands must never reach a real external account via shell-exported
// credentials — every service must skip in the manage pins and the handoff
// child process (which inherits this env)
delete process.env.GH_TOKEN;
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

const FAKE_FETCH_200 = { fetch: async () => ({ status: 200, json: async () => ({}) }), retryDelayMs: 0 };

function tempDir(prefix = 'omega-onboard-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readConfig(root) {
  return JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
}

// Scaffolded app package.jsons declare their framework (`*`); stub the
// packages at the brand root so the update service's resolution climb passes
// without the registry (pre-publish, and tests must never install).
function stubFrameworks(root, names) {
  for (const name of names) {
    const dir = path.join(root, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0-stub' }));
  }
}

// ─── Derivation units ────────────────────────────────────────────────────────

test('deriveId/deriveName/deriveUrl: dir names → wizard defaults', () => {
  assert.equal(deriveId('My Brand 2'), 'my-brand-2');
  assert.equal(deriveId('acme-demo'), 'acme-demo');
  assert.equal(deriveId('123-acme'), 'acme'); // ids start with a letter
  assert.equal(deriveId('!!!'), null);

  assert.equal(deriveName('acme-demo'), 'Acme Demo');
  assert.equal(deriveUrl('acme-demo'), 'https://acmedemo.com'); // dashes drop out (omega-manager parity)
});

// ─── Non-interactive (flags + derivation) ────────────────────────────────────

test('non-interactive: full flags scaffold the complete brand monorepo', async () => {
  const root = tempDir();

  const report = await runOnboard(root, {
    id: 'acme',
    name: 'Acme Inc',
    url: 'https://acme.io',
    description: 'Rockets and anvils',
    tagline: 'Beep beep',
    targets: 'web,backend,desktop',
    manage: false,
  });

  assert.equal(report.mode, 'fresh');
  assert.equal(report.brandRoot, root);
  assert.equal(report.valid, true);
  assert.deepEqual(report.created.sort(), [
    '.env',
    '.gitignore',
    'README.md',
    'apps/backend/package.json',
    'apps/desktop/package.json',
    'apps/website/package.json',
    'config/omega.json5',
    'package.json',
  ]);
  assert.deepEqual(report.kept, []);

  const config = readConfig(root);
  assert.deepEqual(config.brand, {
    id: 'acme',
    name: 'Acme Inc',
    description: 'Rockets and anvils',
    tagline: 'Beep beep',
    url: 'https://acme.io',
    contact: { email: 'support@acme.io' },
  });
  assert.deepEqual(config.theme, { id: 'classy', appearance: 'system' });
  assert.deepEqual(Object.keys(config.targets), ['web', 'backend', 'desktop']);
  // Desktop target → the reverse-DNS bundle prefix seeds (derived from the url)
  assert.deepEqual(config.certificates, { apple: { bundleIdPrefix: 'io.acme' } });
  // `targets` is the LAST top-level key in the seeded config (canonical order)
  assert.equal(Object.keys(config).at(-1), 'targets');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'acme');
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.workspaces, ['apps/*']);

  const appPkg = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'website', 'package.json'), 'utf8'));
  assert.equal(appPkg.name, 'acme-website');

  // cp95a seeds: framework dep per app — the backend's is a RUNTIME
  // dependency on its ONE app manifest (src/dist pillar: the stage derives
  // dist/package.json from it), every other target's is a devDependency —
  // plus a bootable demo-* cloud project and the starter catalog as a comment
  assert.deepEqual(appPkg.devDependencies, { '@omega.js/web': '*' });
  const backendPkg = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'backend', 'package.json'), 'utf8'));
  assert.deepEqual(backendPkg.dependencies, { '@omega.js/backend': '*' });
  assert.equal(backendPkg.devDependencies, undefined, 'backend framework is a runtime dep, not dev');
  assert.deepEqual(config.cloud, { provider: 'firebase', config: { projectId: 'demo-acme' } });
  const rawConfig = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');
  assert.match(rawConfig, /\/\/ payment: \{/, 'starter catalog ships commented');
  assert.equal(config.payment, undefined, 'catalog is a comment, not config');

  // The .env stub documents the credential entry points: external keys
  // commented out, omega-owned keys provisioned with generated secrets
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.ok(env.includes('# CLOUDFLARE_TOKEN='));
  assert.ok(env.includes('# STRIPE_SECRET_KEY='));
  assert.match(env, /^OMEGA_ADMIN_KEY=[A-Za-z0-9_-]{43}$/m);
  assert.match(env, /^OMEGA_WEBHOOK_KEY=[A-Za-z0-9_-]{43}$/m);
  assert.match(env, /^OMEGA_NAMESPACE=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/m);
  assert.notEqual(env.match(/^OMEGA_ADMIN_KEY=(.+)$/m)[1], env.match(/^OMEGA_WEBHOOK_KEY=(.+)$/m)[1]);
  const uncommented = env.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  assert.ok(uncommented.every((line) => line.startsWith('OMEGA_')), 'only omega-owned keys are provisioned');

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const entry of ['node_modules/', '.omega/', '.env', 'dist/']) {
    assert.ok(gitignore.includes(entry), `gitignore missing ${entry}`);
  }
});

test('non-interactive: everything derives from the directory name', async () => {
  const parent = tempDir();
  const root = path.join(parent, 'sweet-saucy');
  fs.mkdirSync(root);

  const report = await runOnboard(root, { manage: false });

  assert.equal(report.valid, true);
  const config = readConfig(root);
  assert.equal(config.brand.id, 'sweet-saucy');
  assert.equal(config.brand.name, 'Sweet Saucy');
  assert.equal(config.brand.url, 'https://sweetsaucy.com');
  assert.equal(config.brand.contact.email, 'support@sweetsaucy.com');
  // Optional fields stay OUT of the config instead of landing as empty strings
  assert.ok(!('description' in config.brand));
  assert.ok(!('tagline' in config.brand));
  // Target default: the classic web + backend pair
  assert.deepEqual(Object.keys(config.targets), ['web', 'backend']);
});

test('non-interactive: underivable id is a clear error, bad flag values throw', async () => {
  const parent = tempDir();
  const root = path.join(parent, '№∆');
  fs.mkdirSync(root);

  await assert.rejects(() => runOnboard(root, { manage: false }), /--id=<id>/);
  await assert.rejects(() => runOnboard(root, { id: 'Bad_Id', manage: false }), /Invalid brand id/);
  await assert.rejects(() => runOnboard(root, { id: 'ok', url: 'ftp://x', manage: false }), /Invalid brand url/);
  await assert.rejects(() => runOnboard(root, { id: 'ok', targets: 'web,gopher', manage: false }), /Unknown target\(s\): gopher/);

  // Nothing was written by any failed attempt
  assert.deepEqual(fs.readdirSync(root), []);
});

// ─── Interactive wizard (real prompts over fake TTY streams) ─────────────────

test('interactive: the full wizard — typed id, accepted defaults, checkbox targets, manage declined', async () => {
  const root = tempDir();
  const tty = openTtyPrompt();

  try {
    const run = runOnboard(root, {});

    await tty.answer('Brand ID:', 'wizard-brand\r');
    await tty.answer('Brand name:', '\r');                    // accept derived: Wizard Brand
    await tty.answer('Brand URL:', '\r');                     // accept derived: https://wizardbrand.com
    await tty.answer('Brand description', 'A wizard-made brand\r');
    await tty.answer('Brand tagline', '\r');                  // empty → omitted
    await tty.answer('Targets (', '\r');                      // accept checked defaults: web + backend
    await tty.answer('Keep this account list?', '\r');        // inherit → nothing written
    await tty.answer('Run manage now?', 'n\r');

    const report = await run;

    assert.equal(report.mode, 'fresh');
    assert.equal(report.valid, true);
    assert.equal(report.manageExitCode, null);

    const config = readConfig(root);
    assert.equal(config.brand.id, 'wizard-brand');
    assert.equal(config.brand.name, 'Wizard Brand');
    assert.equal(config.brand.url, 'https://wizardbrand.com');
    assert.equal(config.brand.description, 'A wizard-made brand');
    assert.ok(!('tagline' in config.brand));
    assert.deepEqual(Object.keys(config.targets), ['web', 'backend']);
    // Inherited account list stays unwritten — the source layer keeps owning it
    assert.ok(!('account' in config));
  } finally {
    tty.close();
  }
});

test('interactive: customizing the account list writes account.admins into the brand config', async () => {
  const root = tempDir();
  const tty = openTtyPrompt();

  try {
    const run = runOnboard(root, { id: 'accounts-brand', name: 'Accounts Brand', url: 'https://accountsbrand.com', targets: 'web,backend' });

    await tty.answer('Brand description', '\r');
    await tty.answer('Brand tagline', '\r');
    await tty.answer('Keep this account list?', 'n\r');
    await tty.answer('Account email', 'boss@{domain}\r');
    await tty.answer('Manage the Firebase Auth account', '\r');   // yes (default)
    await tty.answer('Sync the contact to marketing providers?', 'n\r');
    await tty.answer('Add another account?', '\r');               // no (default)
    await tty.answer('Run manage now?', 'n\r');

    const report = await run;
    assert.equal(report.valid, true);

    const config = readConfig(root);
    assert.deepEqual(config.account, {
      admins: [{ email: 'boss@{domain}', account: true, marketing: false }],
    });
  } finally {
    tty.close();
  }
});

test('interactive: dry-run never prompts, even with a TTY, and writes nothing', async () => {
  const parent = tempDir();
  const root = path.join(parent, 'dry-brand');
  fs.mkdirSync(root);
  const tty = openTtyPrompt();

  try {
    // No tty.answer() calls — a prompt would hang this until the timeout
    const report = await runOnboard(root, { dryRun: true });

    assert.equal(report.created.length, 0);
    assert.ok(report.planned.includes('config/omega.json5'));
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    tty.close();
  }
});

// ─── Fill-missing semantics ──────────────────────────────────────────────────

test('rerun converges: second onboard keeps every file, existing files are never overwritten', async () => {
  const root = tempDir();
  const custom = '{\n  "name": "hand-tuned",\n  "private": true,\n  "workspaces": ["apps/*"]\n}\n';
  fs.writeFileSync(path.join(root, 'package.json'), custom);

  const first = await runOnboard(root, { id: 'keeper', manage: false });
  assert.deepEqual(first.kept, ['package.json']);
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), custom);

  const second = await runOnboard(root, { manage: false });
  assert.equal(second.mode, 'resume');
  assert.equal(second.created.length, 0);
  assert.equal(second.kept.length, first.created.length + 1);
});

test('resume from inside an existing brand: answers come from its config, only gaps fill in', async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
    brand: { id: 'existing', name: 'Existing Brand', url: 'https://existing.test' },
    targets: { web: {} },
  }`);
  fs.mkdirSync(path.join(root, 'apps', 'website'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'website', 'package.json'), '{ "name": "existing-website" }\n');

  // From INSIDE the app dir — the brand root resolves by walk-up
  const report = await runOnboard(path.join(root, 'apps', 'website'), { manage: false });

  assert.equal(report.mode, 'resume');
  assert.equal(report.brandRoot, root);
  assert.deepEqual(report.created.sort(), ['.env', '.gitignore', 'README.md', 'package.json']);

  // Scaffolded files carry the EXISTING brand's identity, not derived guesses
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(readme.startsWith('# Existing Brand'));
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.ok(env.startsWith('# Existing Brand'));
});

// ─── Company mode ────────────────────────────────────────────────────────────

test('company mode: the new brand lands under brands.roots[0] and gets the company stamp', async () => {
  const companyRoot = tempDir('omega-onboard-co-');
  fs.mkdirSync(path.join(companyRoot, 'config'));
  fs.writeFileSync(path.join(companyRoot, 'config', 'omega.json5'), `{
    brand: { name: 'My Co' },
    monitoring: { provider: 'sentry', dsn: 'https://co@sentry.example/1' },
    brands: { roots: ['./brands'] },
  }`);
  fs.mkdirSync(path.join(companyRoot, 'brands'));

  const report = await runOnboard(companyRoot, { id: 'acme', manage: false });

  const brandRoot = path.join(companyRoot, 'brands', 'acme');
  assert.equal(report.brandRoot, brandRoot);
  assert.equal(report.mode, 'fresh');
  assert.equal(report.valid, true);

  // Stamped: brand-local runs will layer the company defaults
  const marker = JSON.parse(fs.readFileSync(path.join(brandRoot, '.omega', 'company.json'), 'utf8'));
  assert.equal(marker.root, companyRoot);

  // Discovery sees the new brand
  const { brands } = discoverBrands(companyRoot);
  assert.deepEqual(brands.map((b) => b.id), ['acme']);

  // Onboarding the same id again converges instead of clobbering
  const again = await runOnboard(companyRoot, { id: 'acme', manage: false });
  assert.equal(again.mode, 'resume');
  assert.equal(again.created.length, 0);
});

// ─── Manage pins ─────────────────────────────────────────────────────────────

test('fresh scaffold runs the workspace service green', async () => {
  const root = tempDir();
  await runOnboard(root, { id: 'green', targets: 'web,backend', manage: false });

  const report = await runManage(root, { service: 'workspace' });

  assert.equal(report.hasErrors, false);
  assert.equal(report.results.workspace.status, 'success');
});

test('full manage on a fresh brand: services skip cleanly, testing honestly nudges toward the frameworks', async () => {
  const root = tempDir();
  await runOnboard(root, { id: 'nudge', targets: 'web,backend', manage: false });
  // Both declared frameworks stubbed (the backend's is a runtime dep on its
  // app manifest since the src/dist pillar) — mirrors a post-`mgr i local` brand
  stubFrameworks(root, ['@omega.js/web', '@omega.js/backend']);

  const report = await runManage(root, { ...FAKE_FETCH_200 });

  // The scaffold itself is sound…
  assert.equal(report.results.workspace.status, 'success');
  assert.equal(report.results.update.status, 'success');

  // …every external service skips (no credentials, no config)…
  for (const [service, result] of Object.entries(report.results)) {
    if (service !== 'testing') {
      assert.notEqual(result.status, 'error', `${service} should not error on a fresh brand`);
    }
  }

  // …and testing names exactly what's missing: the apps' framework internals
  assert.equal(report.hasErrors, true);
  assert.equal(report.results.testing.status, 'error');
  assert.match(report.results.testing.error, /build output/);
  assert.match(report.results.testing.error, /firebase\.json/);
});

test('manage handoff: --manage spawns the real CLI in the new brand', async () => {
  const parent = tempDir();
  const root = path.join(parent, 'handoff-brand');
  fs.mkdirSync(root);
  stubFrameworks(root, ['@omega.js/web']);

  // localhost URL → the testing service's live checks fail fast (connection
  // refused, no DNS wait); the child's honest exit 1 comes back through
  const report = await runOnboard(root, {
    id: 'handoff-brand',
    url: 'https://localhost:9',
    targets: 'web',
    manage: true,
  });

  assert.notEqual(report.manageExitCode, null);
  assert.equal(report.manageExitCode, 1); // testing: build output missing — the designed nudge

  // The child actually ran manage: run output landed in .omega/runs/
  const runs = fs.readdirSync(path.join(root, '.omega', 'runs'));
  assert.equal(runs.length, 1);
  const run = JSON.parse(fs.readFileSync(path.join(root, '.omega', 'runs', runs[0]), 'utf8'));
  assert.equal(run.brandId, 'handoff-brand');
});
