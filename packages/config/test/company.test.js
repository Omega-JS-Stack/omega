/**
 * company.js — the ONE company-root discovery rule: a brand's
 * `.omega/company.json` stamp read through readCompanyRoot().
 *
 * The unstamped/malformed side of the contract is proven in env.test.js
 * ("malformed or rootless markers read as unstamped") because that suite
 * needs the same fixtures for the .env chain; this suite pins the marker
 * PATH constant and the stamped happy path — the parts nothing else asserts.
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * devkit test convention.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readCompanyRoot, COMPANY_MARKER } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function makeFixture(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

test('COMPANY_MARKER is the .omega/company.json stamp path', () => {
  assert.strictEqual(COMPANY_MARKER, path.join('.omega', 'company.json'));
});

test('a stamped brand resolves the company root its marker points at', (t) => {
  const root = makeFixture('company-stamped', {
    'brand/.omega/company.json': JSON.stringify({ root: '/srv/acme-company' }),
  });
  cleanup(t, root);

  assert.strictEqual(readCompanyRoot(path.join(root, 'brand')), '/srv/acme-company');
});

test('extra marker keys are ignored — only root is read', (t) => {
  const root = makeFixture('company-extra-keys', {
    'brand/.omega/company.json': JSON.stringify({
      root: '/srv/acme-company',
      stampedAt: '2026-07-28T00:00:00.000Z',
      version: 3,
    }),
  });
  cleanup(t, root);

  assert.strictEqual(readCompanyRoot(path.join(root, 'brand')), '/srv/acme-company');
});

test('a non-string root reads as unstamped', (t) => {
  const root = makeFixture('company-nonstring-root', {
    'a/.omega/company.json': JSON.stringify({ root: 42 }),
    'b/.omega/company.json': JSON.stringify({ root: ['/srv/acme'] }),
    'c/.omega/company.json': JSON.stringify({ root: null }),
  });
  cleanup(t, root);

  assert.strictEqual(readCompanyRoot(path.join(root, 'a')), null);
  assert.strictEqual(readCompanyRoot(path.join(root, 'b')), null);
  assert.strictEqual(readCompanyRoot(path.join(root, 'c')), null);
});

test('a directory where the marker should be reads as unstamped', (t) => {
  const root = makeFixture('company-marker-is-dir', {
    'brand/.omega/company.json/placeholder': 'not a marker file',
  });
  cleanup(t, root);

  assert.strictEqual(readCompanyRoot(path.join(root, 'brand')), null);
});
