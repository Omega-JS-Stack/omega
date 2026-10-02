/**
 * brandState(cwd): the one read of what a folder is (empty, unrelated files, a
 * template copy, a half-done brand, a finished brand, a legacy brand), what it
 * lacks, and the one next command. Every brand here is born through the real
 * onboarding with flags and no terminal; a read never changes a file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Before the source loads: no real npm install, dev stack or GitHub call
const { folder, git, quietly, pluginInstalled } = require('./lib/onboard-seams.js');
require('@omega.js/devkit/test/temp-home');

const { ENV_SCHEMA } = require('@omega.js/config');
const { runOnboard } = require('../src/onboard.js');
const { brandState, STATES } = require('../src/lib/brand-state.js');
const { stageTemplate } = require('./lib/brand-template.js');
const { snapshot } = require('./lib/tree-snapshot.js');
const { install } = require('./lib/brand-install.js');

pluginInstalled();

const FLAGS = { id: 'acme', name: 'Acme', url: 'https://acme.test', contactName: 'Jane Doe', manage: false, dev: false };

// Keys only the backend reads, so a brand with no backend never lacks one
const BACKEND_ONLY_KEYS = [
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY',
  'RECAPTCHA_SECRET_KEY', 'HCAPTCHA_SECRET', 'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'SENDGRID_API_KEY', 'BEEHIIV_API_KEY', 'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET',
  'CHARGEBEE_API_KEY', 'COINBASE_COMMERCE_API_KEY', 'GOOGLE_ANALYTICS_SECRET_BACKEND',
  'ANTHROPIC_API_KEY', 'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY',
];

// Keys only an operator of that product holds, so a new brand never owes one
const OPERATOR_ONLY_KEYS = ['SLAPFORM_SERVICE_ACCOUNT', 'CHATSY_SERVICE_ACCOUNT', 'REPLYIFY_SERVICE_ACCOUNT', 'SERVER_SERVICE_ACCOUNT'];

// The keys OMEGA mints for a backend: generated, never asked
const MINTED_KEYS = ['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY'];

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A brand onboarded with flags and no terminal, its dependencies not installed. */
async function onboarded(targets = 'web,backend') {
  const root = folder('acme');
  const { report } = await quietly(() => runOnboard(root, { ...FLAGS, targets }));
  assert.equal(report.valid, true, 'the fixture brand onboarded clean');
  return root;
}

/** A finished brand: onboarded, then installed. */
async function completeBrand(targets) {
  return install(await onboarded(targets));
}

/** Give the brand config a retired key, every other line as onboarding wrote it. */
function withRetiredKey(root) {
  const file = path.join(root, 'config', 'omega.json5');
  const config = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, config.replace(/^\{$/m, '{\n  slapform: { endpoint: "https://slapform.test/f/abc" },'));
  return root;
}

/** A finished brand as a fresh clone leaves it: only tracked files, then installed. */
async function clonedBrand() {
  const source = await onboarded();
  const root = path.join(path.dirname(source), 'acme-clone');
  git(path.dirname(source), 'clone', '-q', source, root);
  return install(root);
}

/** Turn a gating service on: Sentry chosen as the monitoring provider. */
function withSentry(root) {
  const file = path.join(root, 'config', 'omega.json5');
  const config = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, config.replace(/^\{$/m, '{\n  monitoring: { providers: { sentry: { org: "acme" } } },'));
  return root;
}

/**
 * Read the brand with an empty .env and no schema key in process.env, so
 * nothing from the machine or an earlier test fills a gap.
 */
async function stateWithEmptyEnv(root) {
  fs.writeFileSync(path.join(root, '.env'), '');
  const saved = {};
  for (const { name } of ENV_SCHEMA) {
    if (!name || !(name in process.env)) continue;
    saved[name] = process.env[name];
    delete process.env[name];
  }
  try {
    return await brandState(root);
  } finally {
    for (const { name } of ENV_SCHEMA) if (name) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

/** The keys of the env rows whose `optional` is exactly `optional`. */
const envKeys = (report, optional) => report.missing.env.filter((entry) => entry.optional === optional).map((entry) => entry.key);

/** A missing-list entry holds a gap: a non-empty list, or a truthy flag. */
const listed = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

/** The target `inTarget` names, whether it holds the name or a record of it. */
const targetName = (inTarget) => (typeof inTarget === 'string' ? inTarget : inTarget.name);

// ─── The names ───────────────────────────────────────────────────────────────

test('#1031 names: STATES are the six states', () => {
  assert.deepEqual([...STATES].sort(), ['brand', 'empty', 'half-done', 'legacy', 'template', 'unrelated']);
});

// ─── One test per state ──────────────────────────────────────────────────────

test('#1031 case 1: an empty folder is empty', async () => {
  const report = await brandState(folder('empty'));

  assert.equal(report.state, 'empty');
});

test('#1031 case 1: a folder holding only .DS_Store is empty', async () => {
  const root = folder('empty');
  fs.writeFileSync(path.join(root, '.DS_Store'), Buffer.from([0, 0, 0, 1]));

  const report = await brandState(root);

  assert.equal(report.state, 'empty');
});

test('#1031 case 2: files with no brand config and no template mark are unrelated', async () => {
  const root = folder('my-app');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'my-app', private: true }));
  fs.writeFileSync(path.join(root, 'index.js'), 'console.log("hello");\n');

  const report = await brandState(root);

  assert.equal(report.state, 'unrelated');
});

test('#1031 case 3: a package.json carrying the template mark, with no brand config, is a template whose next command is npm start', async () => {
  const report = await brandState(stageTemplate(folder('acme-omega')));

  assert.equal(report.state, 'template');
  assert.equal(report.next, 'npm start');
});

test('#1031 case 4: a brand config with a scaffold file missing is half-done, and the file is listed', async () => {
  const root = await completeBrand();
  fs.rmSync(path.join(root, '.gitignore'));

  const report = await brandState(root);

  assert.equal(report.state, 'half-done');
  assert.deepEqual(report.missing.files, ['.gitignore']);
});

test('#1031 case 4: a declared target with no folder is half-done, and the target is listed', async () => {
  const root = await completeBrand();
  fs.rmSync(path.join(root, 'targets', 'backend'), { recursive: true });

  const report = await brandState(root);

  assert.equal(report.state, 'half-done');
  assert.deepEqual(report.missing.targets, ['backend']);
});

test('#1031 case 4: a brand whose dependencies are not installed is half-done, and the install is listed', async () => {
  const report = await brandState(await onboarded());

  assert.equal(report.state, 'half-done');
  assert.ok(listed(report.missing.install), `install is listed: ${JSON.stringify(report.missing)}`);
});

test('#1031 case 4: a config that does not load is half-done, and the config is listed', async () => {
  const root = await completeBrand();
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), '{ brand: { id: "acme",\n');

  const report = await brandState(root);

  assert.equal(report.state, 'half-done');
  assert.ok(listed(report.missing.config), `config is listed: ${JSON.stringify(report.missing)}`);
});

test('#1031 case 5: a complete brand is a brand, and nothing is listed as missing', async () => {
  const root = await completeBrand();

  const report = await brandState(root);

  assert.equal(report.state, 'brand');
  assert.equal(report.brandRoot, root);
  assert.ok(!report.inTarget, 'the brand root is no target');
  for (const kind of ['files', 'targets', 'config', 'install']) {
    assert.equal(listed(report.missing[kind]), false, `${kind}: ${JSON.stringify(report.missing[kind])}`);
  }
});

test('#1031 case 5: a finished brand freshly cloned, its gitignored files absent, is a brand with nothing missing', async () => {
  const root = await clonedBrand();
  assert.equal(fs.existsSync(path.join(root, '.env')), false, 'the clone carries no .env');

  const report = await brandState(root);

  assert.equal(report.state, 'brand');
  for (const kind of ['files', 'targets', 'config', 'install']) {
    assert.equal(listed(report.missing[kind]), false, `${kind}: ${JSON.stringify(report.missing[kind])}`);
  }
});

test('#1031 case 6: a brand config with a retired key is legacy, and the next command is npx omega migrate', async () => {
  const root = withRetiredKey(await completeBrand());

  const report = await brandState(root);

  assert.equal(report.state, 'legacy');
  assert.equal(report.next, 'npx omega migrate');
});

test('#1031 case 7: inside a target, the report is the brand root\'s and inTarget names the target', async () => {
  const root = await completeBrand();
  const targetDir = path.join(root, 'targets', 'web');
  const deep = path.join(targetDir, 'src', 'pages');
  fs.mkdirSync(deep, { recursive: true });

  for (const cwd of [targetDir, deep]) {
    const report = await brandState(cwd);
    assert.equal(report.state, 'brand', cwd);
    assert.equal(report.brandRoot, root, cwd);
    assert.equal(targetName(report.inTarget), 'web', cwd);
  }
});

test('#1031 case 9: a read in any state leaves every file and folder as it was, adding not even an empty folder', async () => {
  const brand = await completeBrand();
  const deep = path.join(brand, 'targets', 'web', 'src');
  fs.mkdirSync(deep, { recursive: true });
  const unrelated = folder('my-app');
  fs.writeFileSync(path.join(unrelated, 'index.js'), 'console.log("hello");\n');
  const missingFile = await completeBrand();
  fs.rmSync(path.join(missingFile, 'README.md'));
  const missingTarget = await completeBrand();
  fs.rmSync(path.join(missingTarget, 'targets', 'web'), { recursive: true });
  const broken = await completeBrand();
  fs.writeFileSync(path.join(broken, 'config', 'omega.json5'), '{ brand: {\n');

  const cases = [
    ['empty', folder('empty'), null],
    ['unrelated', unrelated, null],
    ['template', stageTemplate(folder('acme-omega')), null],
    ['half-done, a file missing', missingFile, null],
    ['half-done, a target missing', missingTarget, null],
    ['half-done, not installed', await onboarded(), null],
    ['half-done, a config that does not load', broken, null],
    ['brand', brand, null],
    ['brand, freshly cloned', await clonedBrand(), null],
    ['brand, read from inside a target', brand, deep],
    ['legacy', withRetiredKey(await completeBrand()), null],
  ];
  for (const [label, root, cwd] of cases) {
    const before = snapshot(root);
    await brandState(cwd || root);
    assert.deepEqual(snapshot(root), before, `${label}: nothing written, moved or removed`);
  }
});

// ─── The missing keys ────────────────────────────────────────────────────────

test('#1029 case 11: a brand with reCAPTCHA on and an empty env lists RECAPTCHA_SECRET_KEY; a brand with no backend lists no backend-only key', async () => {
  delete process.env.RECAPTCHA_SECRET_KEY;

  const withBackend = await brandState(await completeBrand('web,backend'));
  assert.ok(
    JSON.stringify(withBackend.missing).includes('"RECAPTCHA_SECRET_KEY"'),
    `the missing keys name it: ${JSON.stringify(withBackend.missing)}`,
  );

  const webOnly = JSON.stringify((await brandState(await completeBrand('web'))).missing);
  assert.deepEqual(BACKEND_ONLY_KEYS.filter((key) => webOnly.includes(`"${key}"`)), [], webOnly);
  assert.doesNotMatch(webOnly, /"CONNECTIONS_/);
});

// ─── Optional keys ───────────────────────────────────────────────────────────

test('#1031 status: a fresh website-alone brand with an empty env is ready for npm start, its operator-only keys optional', async () => {
  const report = await stateWithEmptyEnv(await completeBrand('web'));

  assert.equal(report.state, 'brand');
  assert.equal(report.next, 'npm start');
  assert.deepEqual(OPERATOR_ONLY_KEYS.filter((key) => !envKeys(report, true).includes(key)), [], `each operator-only key is optional: ${JSON.stringify(report.missing.env)}`);
});

test('#1031 status: a brand with a backend and an empty env is ready for npm start, the minted keys never asked', async () => {
  const report = await stateWithEmptyEnv(await completeBrand('web,backend'));

  assert.equal(report.state, 'brand');
  assert.equal(report.next, 'npm start');
  const listedKeys = report.missing.env.map((entry) => entry.key);
  assert.deepEqual(MINTED_KEYS.filter((key) => listedKeys.includes(key)), [], JSON.stringify(report.missing.env));
});

test('#1031 status: a key with its own provider switch is optional, the answer manage gives', async () => {
  const report = await stateWithEmptyEnv(await completeBrand('web,backend'));

  // Each provider token sits behind its own `analytics.providers.<x>` switch, so
  // manage never gates on it and status lists it as optional, like preflight does
  assert.deepEqual(['META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN'].filter((key) => !envKeys(report, true).includes(key)), [], JSON.stringify(report.missing.env));
});

test('#1031 status: a brand that turns a gating service on and lacks its key is still ready for npm start, the key listed as not optional', async () => {
  const report = await stateWithEmptyEnv(withSentry(await completeBrand('web')));

  assert.equal(report.state, 'brand');
  assert.equal(report.next, 'npm start');
  assert.ok(envKeys(report, false).includes('SENTRY_AUTH_TOKEN'), `SENTRY_AUTH_TOKEN is listed with optional: false: ${JSON.stringify(report.missing.env)}`);
});
