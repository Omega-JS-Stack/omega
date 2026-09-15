/**
 * `omega company init`: the one command that creates a company's shared tree
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)). Real files in
 * temp dirs, no mocks: it refuses a brand that is not the company, it
 * scaffolds `company/` INSIDE the company brand with the shape the ONE
 * resolver reads (config layer, `.env`, gitignore, signing tree, templates),
 * a rerun is a byte-level no-op, and a brand naming the company really does
 * inherit through the REAL loader.
 *
 * Every fixture points OMEGA_HOME at its own temp home: a test must never
 * read or write the developer's real machine registry.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');
const jetpack = require('fs-jetpack');
const { loadConfig, recordBrand } = require('@omega.js/config');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677). Tests that need their own
// home still override it per test.
require('./lib/temp-home.js');

const { runCompanyInit } = require('../src/company-init.js');
const { loadBrand } = require('../src/lib/brand.js');
const { DEFAULTS } = require('../src/config.js');

const companyCommand = require('../src/commands/company.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpdir(prefix = 'omega-company-init-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run fn with console.log/error captured; returns the joined lines. */
function captureOutput(fn) {
  const lines = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    return { result: fn(), text: lines.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** Every file in a tree → relative path → { contents, mtimeMs }. */
function snapshot(root) {
  const snap = new Map();
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    snap.set(path.relative(root, file), {
      contents: fs.readFileSync(file, 'utf8'),
      mtimeMs: fs.statSync(file).mtimeMs,
    });
  }
  return snap;
}

/** Point the machine registry at this test's own home. */
function useHome(t, dir) {
  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(dir, 'home');
  t.after(() => {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });
}

/** A brand monorepo; `company` is the authored key, when it has one. */
function stageBrand(parentDir, dirName, company) {
  const root = path.join(parentDir, dirName);
  jetpack.write(path.join(root, 'package.json'), JSON.stringify({ name: dirName, private: true, workspaces: ['targets/*'] }, null, 2));
  jetpack.write(
    path.join(root, 'config', 'omega.json5'),
    `{\n  brand: { id: '${dirName}', name: '${dirName} brand', url: 'https://${dirName}.com' },\n`
    + `${company ? `  company: { id: '${company}' },\n` : ''}`
    + '  targets: { web: { type: \'web\' } },\n}\n',
  );
  return root;
}

// ─── init ────────────────────────────────────────────────────────────────────

test('company init: one command scaffolds the tree inside the company brand', (t) => {
  const dir = tmpdir();
  useHome(t, dir);
  const root = stageBrand(dir, 'fixture-co', 'self');

  const { result } = captureOutput(() => runCompanyInit(root));

  assert.equal(result.brandRoot, root);
  assert.equal(result.companyDir, path.join(root, 'company'));
  assert.deepEqual(result.created.sort(), [
    '.env',
    '.gitignore',
    'README.md',
    path.join('config', 'omega.json5'),
  ].sort());
  assert.deepEqual(result.kept, []);

  // The config LAYER: brand-agnostic placeholders only, no brand, no targets,
  // nothing about the parent brand the tree sits inside
  const config = JSON5.parse(fs.readFileSync(path.join(root, 'company', 'config', 'omega.json5'), 'utf8'));
  assert.deepEqual(config, {});

  // The .env carries placeholders only: the same canonical shape a brand .env
  // has, and not one key set
  const env = fs.readFileSync(path.join(root, 'company', '.env'), 'utf8');
  assert.match(env, /^# APPLE_API_ISSUER=$/m, 'the canonical groups render as commented placeholders');
  assert.equal(env.split('\n').filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).length, 0, 'not one key is set');

  // The unshareable half can never be committed, whatever the root file says
  const entries = fs.readFileSync(path.join(root, 'company', '.gitignore'), 'utf8')
    .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(entries, ['.env', '.env.*', '.omega/']);

  // The signing tree and the shared templates have an obvious home from minute one
  for (const relative of ['.omega/certificates/apple/certificates', '.omega/certificates/apple/csr', 'assets/templates']) {
    assert.equal(jetpack.exists(path.join(root, 'company', relative)), 'dir', `${relative} is scaffolded`);
  }

  assert.match(fs.readFileSync(path.join(root, 'company', 'README.md'), 'utf8'), /company layer/i);
});

test('company init: refuses a brand that is not the company', (t) => {
  const dir = tmpdir();
  useHome(t, dir);

  const standalone = stageBrand(dir, 'plain-brand');
  assert.throws(() => captureOutput(() => runCompanyInit(standalone)), /Set company: \{ id: "self" \} in config\/omega\.json5 first/);
  assert.equal(jetpack.exists(path.join(standalone, 'company')), false, 'nothing was written');

  const child = stageBrand(dir, 'child-brand', 'fixture-co');
  assert.throws(() => captureOutput(() => runCompanyInit(child)), /Set company: \{ id: "self" \}/);

  assert.throws(() => captureOutput(() => runCompanyInit(tmpdir('omega-company-bare-'))), /No brand found at or above/);
});

test('company init: a rerun fills gaps only, not one byte rewritten', (t) => {
  const dir = tmpdir();
  useHome(t, dir);
  const root = stageBrand(dir, 'fixture-co', 'self');
  captureOutput(() => runCompanyInit(root));

  // The operator's own edits (and their own files) must survive a rerun
  const layerPath = path.join(root, 'company', 'config', 'omega.json5');
  fs.writeFileSync(layerPath, '{ monitoring: { providers: { sentry: { org: "fixture-co" } } } }\n');
  jetpack.write(path.join(root, 'company', '.omega', 'certificates', 'apple', 'AuthKey_ABC123.p8'), 'not-a-real-key');
  const before = snapshot(root);

  const { result } = captureOutput(() => runCompanyInit(root));

  assert.deepEqual(result.created, [], 'nothing was created the second time');
  assert.equal(result.kept.length, 4, 'every scaffolded file was kept');
  assert.deepEqual(result.dirs, [], 'the tree already existed');
  assert.deepEqual(snapshot(root), before, 'a rerun is a byte-level (and mtime-level) no-op');
});

test('company init: a missing piece is refilled without touching the rest', (t) => {
  const dir = tmpdir();
  useHome(t, dir);
  const root = stageBrand(dir, 'fixture-co', 'self');
  captureOutput(() => runCompanyInit(root));

  jetpack.remove(path.join(root, 'company', '.env'));
  jetpack.remove(path.join(root, 'company', '.omega'));
  const before = snapshot(root);

  const { result } = captureOutput(() => runCompanyInit(root));

  assert.deepEqual(result.created, ['.env']);
  assert.deepEqual(result.dirs, ['.omega/certificates/apple/certificates', '.omega/certificates/apple/csr']);
  for (const [file, state] of before) {
    assert.deepEqual(snapshot(root).get(file), state, `${file} was left alone`);
  }
});

test('company init: what it scaffolds is what a brand of the company inherits', (t) => {
  const dir = tmpdir();
  useHome(t, dir);
  const companyBrand = stageBrand(dir, 'fixture-co', 'self');
  captureOutput(() => runCompanyInit(companyBrand));

  // The operator fills the layer the command just created
  fs.writeFileSync(
    path.join(companyBrand, 'company', 'config', 'omega.json5'),
    '{ monitoring: { providers: { sentry: { org: "fixture-co" } } } }\n',
  );
  fs.writeFileSync(path.join(companyBrand, 'company', '.env'), 'SENDGRID_API_KEY="company"\n');

  // The registry line the company brand's own run writes
  recordBrand({ id: 'fixture-co', root: companyBrand, name: 'fixture-co brand', url: 'https://fixture-co.com' });

  const child = stageBrand(dir, 'child-brand', 'fixture-co');

  const viaManager = loadBrand(child).config;
  const direct = loadConfig(child, undefined, { defaults: DEFAULTS }).config;

  assert.equal(viaManager.monitoring.providers.sentry.org, 'fixture-co', 'the company layer fills the gap');
  assert.equal(viaManager.brand.name, 'child-brand brand', 'the brand still wins over the company default');
  assert.equal(direct.company.name, 'fixture-co brand', "the child's company section carries the parent's facts");
});

// ─── The verb ────────────────────────────────────────────────────────────────

test('company: the CLI verb runs init in the cwd and names its surface otherwise', async (t) => {
  const dir = tmpdir();
  useHome(t, dir);
  const root = stageBrand(dir, 'fixture-co', 'self');
  const priorExitCode = process.exitCode;
  const cwd = process.cwd();

  process.chdir(root);
  t.after(() => process.chdir(cwd));

  await captureOutput(() => companyCommand({ _: ['company', 'init'] })).result;
  assert.equal(jetpack.exists(path.join(root, 'company', 'config', 'omega.json5')), 'file', '`omega company init` scaffolds the brand it runs in');

  const bogus = captureOutput(() => companyCommand({ _: ['company', 'adopt'] }));
  await bogus.result;
  assert.match(bogus.text, /Unknown company command/);
  assert.match(bogus.text, /init/);
  assert.equal(process.exitCode, 1, 'an unknown subcommand fails loudly');

  process.exitCode = priorExitCode;
});
