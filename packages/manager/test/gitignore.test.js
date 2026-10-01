// Tests for src/lib/gitignore.js and the workspace `gitignore` op: the brand
// root and company root .gitignore speak the one marker engine, a Default
// section the framework rewrites on every manage and a Custom section kept
// verbatim. Real files in a temp dir, no mocks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ensureGitignore, renderBrandGitignore, renderCompanyGitignore } = require('../src/lib/gitignore.js');
const gitignoreOp = require('../src/services/workspace/ensure/gitignore.js');

const DEFAULT = '# ========== Default Values ==========';
const CUSTOM = '# ========== Custom Values ==========';
const EM_DASH = String.fromCharCode(0x2014);

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gitignore-'));
}

function readGitignore(root) {
  return fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
}

// The Default half's entries (comments and blanks dropped) and the Custom half.
function halves(contents) {
  const [head, custom] = contents.split(`${CUSTOM}\n`);
  const entries = head.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return { entries, custom };
}

// A brand born before the markers: the scaffold's old file plus the appender's
// blocks, em-dash headers and all.
const UNMARKED_BRAND = [
  '# Dependencies',
  'node_modules/',
  '',
  `# OMEGA manager state (derived data ${EM_DASH} never committed)`,
  '.omega/',
  '',
  '# Secrets',
  '.env',
  '',
  `# Run logs (truncated on every launch ${EM_DASH} never committed)`,
  'logs/',
  '',
  `# Secrets ${EM_DASH} the environment overlays beside .env`,
  '.env.*',
  '',
].join('\n');

// ─── The templates ───────────────────────────────────────────────────────────

test('gitignore: the brand template is the marked file: every framework entry under Default, Custom empty', () => {
  const contents = renderBrandGitignore();
  assert.equal(contents.split('\n')[0], DEFAULT);
  assert.ok(contents.endsWith(`\n\n${CUSTOM}\n`), 'the Custom section is only its marker line');
  assert.deepEqual(halves(contents), { entries: ['node_modules/', 'dist/', '.omega/', 'logs/', 'test/e2e/.logs/', '.env', '.env.*', '.DS_Store'], custom: '' });
  assert.equal(contents.includes(EM_DASH), false, 'no em dash');
});

test('gitignore: the company template is the marked file with the unshareable half', () => {
  const contents = renderCompanyGitignore();
  assert.equal(contents.split('\n')[0], DEFAULT);
  assert.deepEqual(halves(contents), { entries: ['.env', '.env.*', '.omega/'], custom: '' });
});

// ─── ensureGitignore ─────────────────────────────────────────────────────────

test('gitignore: a missing file is created from the template, then present', () => {
  const root = tmpdir();
  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'created');
  assert.equal(readGitignore(root), renderBrandGitignore());
  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'present');
});

test('gitignore: an unmarked brand file of framework lines only converges to the template', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), UNMARKED_BRAND);

  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'converged');
  assert.equal(readGitignore(root), renderBrandGitignore(), 'every old header and entry was the framework\'s');
  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'present', 'a second run writes nothing');
});

test('gitignore: an unmarked file keeps every consumer line under Custom, nothing duplicated', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest/e2e/.logs/\n\n# Omega manager state (durable IDs + per-run output)\n.omega/\n\n# my own\n*.log\n');

  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'converged');
  const contents = readGitignore(root);
  assert.equal(contents, `${renderBrandGitignore()}# my own\n*.log\n`);
  for (const entry of ['node_modules/', 'test/e2e/.logs/']) {
    assert.equal(contents.split('\n').filter((line) => line === entry).length, 1, entry);
  }
  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'present');
});

test('gitignore: a marked file heals its Default section and keeps the Custom section verbatim', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), `${DEFAULT}\nnode_modules/\nretired-by-the-framework/\n\n${CUSTOM}\nmy-secret-dir/\n`);

  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'healed');
  assert.equal(readGitignore(root), `${renderBrandGitignore()}my-secret-dir/\n`);
  assert.equal(ensureGitignore(root, renderBrandGitignore()), 'present');
});

test('gitignore: a dry run returns the verdict and writes nothing', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  assert.equal(ensureGitignore(root, renderBrandGitignore(), { dryRun: true }), 'converged');
  assert.equal(readGitignore(root), 'node_modules/\n');

  const empty = tmpdir();
  assert.equal(ensureGitignore(empty, renderBrandGitignore(), { dryRun: true }), 'created');
  assert.equal(fs.existsSync(path.join(empty, '.gitignore')), false);
});

// ─── The workspace op: the brand root and the company root ───────────────────

test('gitignore op: converges the brand root and the company root, each from its own template, then is a no-op', async () => {
  const brandRoot = tmpdir();
  const companyRoot = path.join(tmpdir(), 'company');
  fs.mkdirSync(companyRoot);
  fs.writeFileSync(path.join(brandRoot, '.gitignore'), UNMARKED_BRAND);
  fs.writeFileSync(path.join(companyRoot, '.gitignore'), '# Secrets: the shared .env and its per-environment overlays\n.env\n.env.*\n\n.omega/\nshared-scratch/\n');

  const logged = [];
  const log = console.log;
  console.log = (line) => logged.push(line);
  let result;
  try {
    result = await gitignoreOp({ brandRoot, companyRoot });
  } finally {
    console.log = log;
  }
  assert.deepEqual(result.output, { gitignore: { brand: 'converged', company: 'converged' } });
  assert.ok(logged.every((line) => !/undefined|Custom section kept/.test(line)), logged.join('\n'));
  assert.equal(readGitignore(brandRoot), renderBrandGitignore());
  assert.equal(readGitignore(companyRoot), `${renderCompanyGitignore()}shared-scratch/\n`);

  assert.equal(await gitignoreOp({ brandRoot, companyRoot }), null, 'a second run writes nothing');
});

test('gitignore op: a brand with no company heals the brand root alone', async () => {
  const brandRoot = tmpdir();
  const result = await gitignoreOp({ brandRoot, companyRoot: null });
  assert.deepEqual(result.output, { gitignore: { brand: 'created' } });
  assert.equal(readGitignore(brandRoot), renderBrandGitignore());
});

test('#971: the workspace op under --dry-run plans the heal and writes nothing', async () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');

  const result = await gitignoreOp({ brandRoot: root, options: { dryRun: true } });

  assert.equal(readGitignore(root), 'node_modules/\n');
  assert.deepEqual(result.output, { gitignore: { brand: 'planned' } });
});
