/**
 * `omega company init` / `omega company adopt` — the one-command company
 * workspace. Real files in temp dirs, no mocks: init scaffolds the whole
 * repo (config layer, .env template with NO values, the gitignore decisions,
 * the shared signing tree), a rerun is a byte-level no-op, adopt stamps a
 * brand with the marker shape the config layer already resolves, and the
 * adopted brand actually inherits the company layer through the REAL loader.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSON5 = require('json5');
const jetpack = require('fs-jetpack');
const { loadConfig } = require('@omega.js/config');

const { runCompanyInit, runCompanyAdopt } = require('../src/company-init.js');
const { isCompanyRoot, readCompanyMarker } = require('../src/lib/company.js');
const { ensureOmegaIgnored } = require('../src/lib/gitignore.js');
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

/** A minimal standalone brand monorepo (the company.test fixture shape). */
function stageBrand(parentDir, dirName) {
  const root = path.join(parentDir, dirName);
  jetpack.write(path.join(root, 'package.json'), JSON.stringify({ name: dirName, private: true, workspaces: ['targets/*'] }, null, 2));
  jetpack.write(
    path.join(root, 'config', 'omega.json5'),
    `{ brand: { id: '${dirName}', name: '${dirName} brand' }, targets: { web: {} } }`,
  );
  return root;
}

// ─── init ────────────────────────────────────────────────────────────────────

test('company init: one command scaffolds the whole workspace', () => {
  const root = tmpdir();

  const { result } = captureOutput(() => runCompanyInit(root));

  assert.deepEqual(result.created.sort(), [
    '.env',
    '.gitignore',
    path.join('.omega', 'certificates', 'apple', '.gitignore'),
    'README.md',
    path.join('config', 'omega.json5'),
  ].sort());
  assert.deepEqual(result.kept, []);

  // The config layer: a real `brands` key (what MAKES it a company root),
  // everything else commented out so nothing brand-specific is invented
  assert.equal(isCompanyRoot(root), true);
  const config = JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
  assert.deepEqual(config, { brands: { roots: ['./brands'] } });

  // The .env template carries placeholders only — no secrets, no values
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.match(env, /^# APPLE_API_ISSUER=$/m, 'the canonical groups render as commented placeholders');
  assert.equal(env.split('\n').filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).length, 0, 'not one key is set');

  // The shared signing tree + the default brands root exist and are empty
  for (const dir of ['brands', '.omega/certificates/apple/certificates', '.omega/certificates/apple/csr', '.omega/certificates/apple/profiles']) {
    assert.equal(jetpack.exists(path.join(root, dir)), 'dir', `${dir} is scaffolded`);
  }
  assert.equal(fs.readFileSync(path.join(root, '.omega', 'certificates', 'apple', '.gitignore'), 'utf8'), '*\n!.gitignore\n');

  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /company workspace/i);
});

test('company init: the gitignore keeps every unshareable thing out of git', () => {
  const root = tmpdir();

  captureOutput(() => runCompanyInit(root));

  const entries = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  // Secrets, the signing tree + run output, the logs, and the managed brands
  // (each its OWN repo) — the tracked surface is config + README + .gitignore
  assert.deepEqual(entries, ['node_modules/', '.omega/', 'logs/', '.env', 'brands/', '.DS_Store']);

  // The shared healer runCompany applies must find its entries already there
  assert.equal(ensureOmegaIgnored(root), 'present');
});

test('company init: a rerun fills gaps only — not one byte rewritten', () => {
  const root = tmpdir();
  captureOutput(() => runCompanyInit(root));

  // The operator's own edits (and their own files) must survive a rerun
  const configPath = path.join(root, 'config', 'omega.json5');
  fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace('{\n', '{\n  brand: { name: "Edited Co" },\n'));
  jetpack.write(path.join(root, '.omega', 'certificates', 'apple', 'AuthKey_ABC123.p8'), 'not-a-real-key');
  const before = snapshot(root);

  const { result } = captureOutput(() => runCompanyInit(root));

  assert.deepEqual(result.created, [], 'nothing was created the second time');
  assert.equal(result.kept.length, 5, 'every scaffolded file was kept');
  assert.deepEqual(result.dirs, [], 'the tree already existed');
  assert.deepEqual(snapshot(root), before, 'a rerun is a byte-level (and mtime-level) no-op');
});

test('company init: a missing piece is refilled without touching the rest', () => {
  const root = tmpdir();
  captureOutput(() => runCompanyInit(root));

  jetpack.remove(path.join(root, '.env'));
  jetpack.remove(path.join(root, '.omega'));
  const before = snapshot(root);

  const { result } = captureOutput(() => runCompanyInit(root));

  assert.deepEqual(result.created.sort(), ['.env', path.join('.omega', 'certificates', 'apple', '.gitignore')].sort());
  assert.deepEqual(result.dirs, ['.omega/certificates/apple/certificates', '.omega/certificates/apple/csr', '.omega/certificates/apple/profiles']);
  for (const [file, state] of before) {
    assert.deepEqual(snapshot(root).get(file), state, `${file} was left alone`);
  }
});

// ─── adopt ───────────────────────────────────────────────────────────────────

test('company adopt: one stamp is all a brand needs — and it is idempotent', () => {
  const root = tmpdir();
  captureOutput(() => runCompanyInit(root));
  const brandRoot = stageBrand(path.join(root, 'brands'), 'brand-a');

  const { result } = captureOutput(() => runCompanyAdopt(root, 'brands/brand-a'));

  assert.equal(result.stamped, true);
  assert.equal(result.managed, true, 'it lives under brands.roots, so company-wide runs walk it');
  // The EXISTING marker shape the config layer resolves — nothing new invented
  const markerPath = path.join(brandRoot, '.omega', 'company.json');
  assert.deepEqual(jetpack.read(markerPath, 'json'), { root });
  assert.deepEqual(readCompanyMarker(brandRoot), { companyRoot: root, stale: false });

  const mtime = fs.statSync(markerPath).mtimeMs;
  const rerun = captureOutput(() => runCompanyAdopt(root, 'brands/brand-a'));
  assert.equal(rerun.result.stamped, false);
  assert.equal(fs.statSync(markerPath).mtimeMs, mtime, 'a re-adopt rewrites nothing');
  assert.match(rerun.text, /already adopted/);
});

test('company adopt: the adopted brand inherits the company layer through the REAL loader', () => {
  const root = tmpdir();
  captureOutput(() => runCompanyInit(root));

  // Fill in the scaffolded skeleton the way an operator would
  const configPath = path.join(root, 'config', 'omega.json5');
  fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace(
    '{\n',
    '{\n  brand: { name: "Fixture Co" },\n  monitoring: { providers: { sentry: { org: "fixture-co" } } },\n',
  ));
  const brandRoot = stageBrand(path.join(root, 'brands'), 'brand-a');

  // Standalone before the stamp: no company layer anywhere (what `monitoring`
  // carries is the schema-default layer every config gets, #478)
  assert.equal(loadBrand(brandRoot).config.monitoring.providers?.sentry?.org, undefined);

  captureOutput(() => runCompanyAdopt(root, brandRoot));

  const viaManager = loadBrand(brandRoot).config;
  const direct = loadConfig(brandRoot, undefined, { defaults: DEFAULTS }).config;

  assert.equal(viaManager.monitoring.providers.sentry.org, 'fixture-co', 'the company fills the gap');
  assert.equal(viaManager.brand.name, 'brand-a brand', 'the brand still wins over the company default');
  assert.equal(direct.monitoring.providers.sentry.org, 'fixture-co', '@omega.js/config resolves the stamp on its own');
});

test('company adopt: a brand outside brands.roots is stamped, and told it is not in the fan-out', () => {
  const org = tmpdir('omega-company-org-');
  const root = path.join(org, 'company');
  captureOutput(() => runCompanyInit(root));
  const brandRoot = stageBrand(org, 'loose-brand');

  const { result, text } = captureOutput(() => runCompanyAdopt(root, brandRoot));

  assert.equal(result.stamped, true, 'the stamp still lands — brand-local runs layer the company');
  assert.equal(result.managed, false);
  assert.match(text, /outside this company's brands\.roots/);
});

test('company adopt: refuses anything that is not this company and a brand', () => {
  const root = tmpdir();
  captureOutput(() => runCompanyInit(root));
  const brandRoot = stageBrand(path.join(root, 'brands'), 'brand-a');
  const bare = tmpdir('omega-company-bare-');

  assert.throws(() => runCompanyAdopt(bare, brandRoot), /Not inside a company workspace/);
  assert.throws(() => runCompanyAdopt(root, 'brands/nope'), /Not a brand/);
  assert.throws(() => runCompanyAdopt(root, root), /one rung: company → brands/);
  assert.throws(() => runCompanyAdopt(root, undefined), /Usage: omega company adopt/);
});

// ─── The verb ────────────────────────────────────────────────────────────────

test('company: the CLI verb routes init/adopt and names its surface otherwise', async () => {
  const root = tmpdir();
  const priorExitCode = process.exitCode;

  await captureOutput(() => companyCommand({ _: ['company', 'init', root] })).result;
  assert.equal(isCompanyRoot(root), true, '`omega company init <path>` scaffolds the named dir');

  const bogus = captureOutput(() => companyCommand({ _: ['company', 'bogus'] }));
  await bogus.result;
  assert.match(bogus.text, /Unknown company command/);
  assert.match(bogus.text, /adopt <brand-path>/);
  assert.equal(process.exitCode, 1, 'an unknown subcommand fails loudly');

  process.exitCode = priorExitCode;
});
