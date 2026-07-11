/**
 * Owner-hook loader tests for @omega.js/config — call-site-mirroring nested
 * paths (.omega/hooks/<hookPath>.js), brand-over-company precedence via the
 * .omega/company.json marker, absent-hook null, and the loud failures
 * (broken file, non-function export, malformed hook path).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * env cascade tests.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveHook, loadHook } = require('../src/index.js');

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

function stampCompany(brandRoot, companyRoot) {
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));
}

// ─── Resolution ───

test('hooks: nested hook path resolves under the brand root', (t) => {
  const root = makeFixture('hooks-brand', {
    'brand/.omega/hooks/account/password.js': 'module.exports = () => "brand-pw";\n',
  });
  cleanup(t, root);
  const brandRoot = path.join(root, 'brand');

  assert.equal(resolveHook(brandRoot, 'account/password'), path.join(brandRoot, '.omega', 'hooks', 'account', 'password.js'));
});

test('hooks: company hook applies when the brand has none, brand wins when both exist', (t) => {
  const root = makeFixture('hooks-precedence', {
    'company/.omega/hooks/account/password.js': 'module.exports = ({ email }) => `company:${email}`;\n',
    'brand-a/config/omega.json5': `{ brand: { id: 'a' } }`,
    'brand-b/config/omega.json5': `{ brand: { id: 'b' } }`,
    'brand-b/.omega/hooks/account/password.js': 'module.exports = ({ email }) => `brand:${email}`;\n',
  });
  cleanup(t, root);
  const companyRoot = path.join(root, 'company');
  const brandA = path.join(root, 'brand-a');
  const brandB = path.join(root, 'brand-b');
  stampCompany(brandA, companyRoot);
  stampCompany(brandB, companyRoot);

  // brand-a: no own hook → the company's
  const fromCompany = loadHook(brandA, 'account/password');
  assert.equal(fromCompany.file, path.join(companyRoot, '.omega', 'hooks', 'account', 'password.js'));
  assert.equal(fromCompany.fn({ email: 'x@y.z' }), 'company:x@y.z');

  // brand-b: its own hook shadows the company's
  const fromBrand = loadHook(brandB, 'account/password');
  assert.equal(fromBrand.file, path.join(brandB, '.omega', 'hooks', 'account', 'password.js'));
  assert.equal(fromBrand.fn({ email: 'x@y.z' }), 'brand:x@y.z');
});

test('hooks: absent everywhere returns null (callers fall through to defaults)', (t) => {
  const root = makeFixture('hooks-absent', {
    'brand/config/omega.json5': `{ brand: { id: 'a' } }`,
  });
  cleanup(t, root);

  assert.equal(resolveHook(path.join(root, 'brand'), 'account/password'), null);
  assert.equal(loadHook(path.join(root, 'brand'), 'account/password'), null);
});

// ─── Loud failures ───

test('hooks: a hook that exports a non-function throws with the file named', (t) => {
  const root = makeFixture('hooks-nonfn', {
    'brand/.omega/hooks/account/password.js': 'module.exports = { nope: true };\n',
  });
  cleanup(t, root);

  assert.throws(
    () => loadHook(path.join(root, 'brand'), 'account/password'),
    /account\/password.*must export a function/s,
  );
});

test('hooks: a hook that fails to load surfaces the require error, never silent fallback', (t) => {
  const root = makeFixture('hooks-broken', {
    'brand/.omega/hooks/account/password.js': 'this is not javascript {{{\n',
  });
  cleanup(t, root);

  assert.throws(
    () => loadHook(path.join(root, 'brand'), 'account/password'),
    /Hook account\/password failed to load/,
  );
});

test('hooks: malformed hook paths are rejected (traversal, absolute, casing)', () => {
  for (const bad of ['../evil', '/etc/passwd', 'Account/Password', 'account//password', '']) {
    assert.throws(() => resolveHook('/tmp', bad), /Invalid hook path/);
  }
});
