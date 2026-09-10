// Tests for src/lib/gitignore.js — the idempotent .gitignore healer the
// workspace service (brand roots) and runCompany (company roots) share. Real
// files in a temp dir, no mocks. #197 added `logs/`: a brand scaffolded before
// the run-log lane exists on disk without it, so the healer is what gets every
// EXISTING root there.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ensureOmegaIgnored } = require('../src/lib/gitignore.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gitignore-'));
}

function readGitignore(root) {
  return fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
}

function entryCount(contents, entry) {
  return contents.split('\n').filter((line) => line.trim() === entry).length;
}

test('gitignore: a missing .gitignore is created with every entry', () => {
  const root = tmpdir();

  assert.equal(ensureOmegaIgnored(root), 'added');

  const contents = readGitignore(root);
  assert.equal(entryCount(contents, '.omega/'), 1);
  assert.equal(entryCount(contents, 'logs/'), 1);
  assert.equal(entryCount(contents, '.env.*'), 1);
});

// #586 — the environment overlays are new secret files at the brand root. Every
// brand born before them lists `.env` and nothing else, so the heal is the only
// thing standing between a `.env.production` and a public commit.
test('gitignore: a brand that predates the environment overlays gains .env.*', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), [
    '# Secrets',
    '.env',
    '',
    '# OMEGA manager state (derived data — never committed)',
    '.omega/',
    '',
    '# Run logs (truncated on every launch — never committed)',
    'logs/',
    '',
  ].join('\n'));

  assert.equal(ensureOmegaIgnored(root), 'added');

  const contents = readGitignore(root);
  assert.equal(entryCount(contents, '.env.*'), 1, 'the overlays are ignored');
  assert.equal(entryCount(contents, '.env'), 1, "the base's own line is untouched");
  assert.equal(entryCount(contents, '.omega/'), 1, 'nothing already present is duplicated');

  assert.equal(ensureOmegaIgnored(root), 'present', 'a second heal is a no-op');
});

test('gitignore: an existing brand missing logs/ gains it, keeping what it had', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), [
    '# Dependencies',
    'node_modules/',
    '',
    '# OMEGA manager state (derived data — never committed)',
    '.omega/',
    '',
  ].join('\n'));

  assert.equal(ensureOmegaIgnored(root), 'added');

  const contents = readGitignore(root);
  assert.equal(entryCount(contents, 'logs/'), 1, 'the run-log lane is now ignored');
  assert.equal(entryCount(contents, '.omega/'), 1, 'the entry it already had is not duplicated');
  assert.match(contents, /node_modules\//, 'the brand’s own entries survive');
});

test('gitignore: a root that already has every entry is untouched', () => {
  const root = tmpdir();
  const before = [
    'node_modules/',
    '.omega/',
    'logs/',
    '.env.*',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, '.gitignore'), before);

  assert.equal(ensureOmegaIgnored(root), 'present');
  assert.equal(readGitignore(root), before, 'not one byte rewritten');
});

test('gitignore: slashless aliases satisfy every entry', () => {
  const root = tmpdir();
  const before = '.omega\nlogs\n.env*\n';
  fs.writeFileSync(path.join(root, '.gitignore'), before);

  assert.equal(ensureOmegaIgnored(root), 'present');
  assert.equal(readGitignore(root), before);
});

test('gitignore: a second run adds nothing (idempotent)', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/');

  ensureOmegaIgnored(root);
  const afterFirst = readGitignore(root);

  assert.equal(ensureOmegaIgnored(root), 'present');
  assert.equal(readGitignore(root), afterFirst);
});
