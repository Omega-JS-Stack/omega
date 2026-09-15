/**
 * Owner-hook loader tests for @omega.js/config: call-site-mirroring nested
 * paths (config/hooks/<hookPath>.js), brand-over-company precedence through
 * the ONE inheritance rule (`company: { id }`, #677), absent-hook null, and
 * the loud failures (broken file, non-function export, malformed hook path).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * env cascade tests.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveHook, loadHook, recordBrand } = require('../src/index.js');

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

// The fixture's own machine home plus the parent brand's registry line: the
// company tree resolves from those two, the same way every consumer resolves it.
function useCompany(t, root, id = 'acme-co') {
  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(root, 'home');
  t.after(() => {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });

  recordBrand({ id, root: path.join(root, 'parent'), name: 'Acme Co', url: 'https://acme.test' });

  return path.join(root, 'parent', 'company');
}

// ─── Resolution ───

test('hooks: nested hook path resolves under the brand root', (t) => {
  const root = makeFixture('hooks-brand', {
    'brand/config/hooks/account/password.js': 'module.exports = () => "brand-pw";\n',
  });
  cleanup(t, root);
  const brandRoot = path.join(root, 'brand');

  assert.equal(resolveHook(brandRoot, 'account/password'), path.join(brandRoot, 'config', 'hooks', 'account', 'password.js'));
});

test('hooks: company hook applies when the brand has none, brand wins when both exist', (t) => {
  const root = makeFixture('hooks-precedence', {
    'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
    'parent/company/config/hooks/account/password.js': 'module.exports = ({ email }) => `company:${email}`;\n',
    'brand-a/config/omega.json5': `{ brand: { id: 'a' }, company: { id: 'acme-co' } }`,
    'brand-b/config/omega.json5': `{ brand: { id: 'b' }, company: { id: 'acme-co' } }`,
    'brand-b/config/hooks/account/password.js': 'module.exports = ({ email }) => `brand:${email}`;\n',
  });
  cleanup(t, root);
  const companyRoot = useCompany(t, root);
  const brandA = path.join(root, 'brand-a');
  const brandB = path.join(root, 'brand-b');

  // brand-a: no own hook, so the company's applies
  const fromCompany = loadHook(brandA, 'account/password');
  assert.equal(fromCompany.file, path.join(companyRoot, 'config', 'hooks', 'account', 'password.js'));
  assert.equal(fromCompany.fn({ email: 'x@y.z' }), 'company:x@y.z');

  // brand-b: its own hook shadows the company's
  const fromBrand = loadHook(brandB, 'account/password');
  assert.equal(fromBrand.file, path.join(brandB, 'config', 'hooks', 'account', 'password.js'));
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
    'brand/config/hooks/account/password.js': 'module.exports = { nope: true };\n',
  });
  cleanup(t, root);

  assert.throws(
    () => loadHook(path.join(root, 'brand'), 'account/password'),
    /account\/password.*must export a function/s,
  );
});

test('hooks: a hook that fails to load surfaces the require error, never silent fallback', (t) => {
  const root = makeFixture('hooks-broken', {
    'brand/config/hooks/account/password.js': 'this is not javascript {{{\n',
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
