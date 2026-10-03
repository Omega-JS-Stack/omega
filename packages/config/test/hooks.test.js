/**
 * Owner-hook loader tests for @omega.js/config: call-site-mirroring nested
 * paths (config/hooks/<hookPath>.js), brand-over-company precedence through
 * the ONE inheritance rule (`company: { id }`, #677), absent-hook null, and
 * the loud failures (broken file, non-function export, malformed hook path).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * env cascade tests.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'hooks',
  tests: [
    // ─── Resolution ───

    {
      name: 'hooks: nested hook path resolves under the brand root',
      run: (ctx) => {
        const root = makeFixture('hooks-brand', {
          'brand/config/hooks/account/password.js': 'module.exports = () => "brand-pw";\n',
        });
        cleanup(ctx, root);
        const brandRoot = path.join(root, 'brand');

        ctx.expect(resolveHook(brandRoot, 'account/password')).toBe(path.join(brandRoot, 'config', 'hooks', 'account', 'password.js'));
      },
    },

    {
      name: 'hooks: company hook applies when the brand has none, brand wins when both exist',
      run: (ctx) => {
        const root = makeFixture('hooks-precedence', {
          'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
          'parent/company/config/hooks/account/password.js': 'module.exports = ({ email }) => `company:${email}`;\n',
          'brand-a/config/omega.json5': `{ brand: { id: 'a' }, company: { id: 'acme-co' } }`,
          'brand-b/config/omega.json5': `{ brand: { id: 'b' }, company: { id: 'acme-co' } }`,
          'brand-b/config/hooks/account/password.js': 'module.exports = ({ email }) => `brand:${email}`;\n',
        });
        cleanup(ctx, root);
        const companyRoot = useCompany(ctx, root);
        const brandA = path.join(root, 'brand-a');
        const brandB = path.join(root, 'brand-b');

        // brand-a: no own hook, so the company's applies
        const fromCompany = loadHook(brandA, 'account/password');
        ctx.expect(fromCompany.file).toBe(path.join(companyRoot, 'config', 'hooks', 'account', 'password.js'));
        ctx.expect(fromCompany.fn({ email: 'x@y.z' })).toBe('company:x@y.z');

        // brand-b: its own hook shadows the company's
        const fromBrand = loadHook(brandB, 'account/password');
        ctx.expect(fromBrand.file).toBe(path.join(brandB, 'config', 'hooks', 'account', 'password.js'));
        ctx.expect(fromBrand.fn({ email: 'x@y.z' })).toBe('brand:x@y.z');
      },
    },

    {
      name: 'hooks: absent everywhere returns null (callers fall through to defaults)',
      run: (ctx) => {
        const root = makeFixture('hooks-absent', {
          'brand/config/omega.json5': `{ brand: { id: 'a' } }`,
        });
        cleanup(ctx, root);

        ctx.expect(resolveHook(path.join(root, 'brand'), 'account/password')).toBe(null);
        ctx.expect(loadHook(path.join(root, 'brand'), 'account/password')).toBe(null);
      },
    },

    // ─── Loud failures ───

    {
      name: 'hooks: a hook that exports a non-function throws with the file named',
      run: (ctx) => {
        const root = makeFixture('hooks-nonfn', {
          'brand/config/hooks/account/password.js': 'module.exports = { nope: true };\n',
        });
        cleanup(ctx, root);

        ctx.expect(() => loadHook(path.join(root, 'brand'), 'account/password')).toThrow(/account\/password.*must export a function/s);
      },
    },

    {
      name: 'hooks: a hook that fails to load surfaces the require error, never silent fallback',
      run: (ctx) => {
        const root = makeFixture('hooks-broken', {
          'brand/config/hooks/account/password.js': 'this is not javascript {{{\n',
        });
        cleanup(ctx, root);

        ctx.expect(() => loadHook(path.join(root, 'brand'), 'account/password')).toThrow(/Hook account\/password failed to load/);
      },
    },

    {
      name: 'hooks: malformed hook paths are rejected (traversal, absolute, casing)',
      run: (ctx) => {
        for (const bad of ['../evil', '/etc/passwd', 'Account/Password', 'account//password', '']) {
          ctx.expect(() => resolveHook('/tmp', bad)).toThrow(/Invalid hook path/);
        }
      },
    },
  ],
});
