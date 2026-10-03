// Unit tests for the ONE node_modules walk in src/local.js: resolvePackageDir
// (the installed entry, a link left a link) and resolvePackageRealDir (its
// real path). Real dirs and real symlinks in a throwaway tree, no mocks.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { resolvePackageDir, resolvePackageRealDir } = require('../src/local.js');

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-package-dir-')));
const NESTED = path.join(ROOT, 'apps', 'web', 'src');
const CHECKOUT = path.join(ROOT, 'checkout', 'linked');

/** Install a package manifest at dir. */
function install(dir, name, version) {
  jetpack.write(path.join(dir, 'package.json'), { name, version });
}

install(path.join(ROOT, 'node_modules', '@walk-test', 'hoisted'), '@walk-test/hoisted', '1.0.0');
install(path.join(ROOT, 'node_modules', '@walk-test', 'shadowed'), '@walk-test/shadowed', '1.0.0');
install(path.join(ROOT, 'apps', 'web', 'node_modules', '@walk-test', 'shadowed'), '@walk-test/shadowed', '2.0.0');
install(CHECKOUT, '@walk-test/linked', '3.0.0');
fs.symlinkSync(CHECKOUT, path.join(ROOT, 'node_modules', '@walk-test', 'linked'), 'dir');
jetpack.dir(NESTED);

module.exports = defineCases({
  type: 'group',
  description: 'resolve-package-dir',
  cleanup: () => jetpack.remove(ROOT),
  tests: [
    {
      name: 'a hoisted copy is found from a nested target',
      run: (ctx) => {
        const expected = path.join(ROOT, 'node_modules', '@walk-test', 'hoisted');
        ctx.expect(resolvePackageDir('@walk-test/hoisted', NESTED)).toBe(expected);
        ctx.expect(resolvePackageRealDir('@walk-test/hoisted', NESTED)).toBe(expected);
      },
    },

    {
      name: 'the nearest copy wins over a hoisted one',
      run: (ctx) => {
        const expected = path.join(ROOT, 'apps', 'web', 'node_modules', '@walk-test', 'shadowed');
        ctx.expect(resolvePackageDir('@walk-test/shadowed', NESTED)).toBe(expected);
        ctx.expect(resolvePackageRealDir('@walk-test/shadowed', NESTED)).toBe(expected);
      },
    },

    {
      name: 'a linked copy: resolvePackageDir keeps the link, resolvePackageRealDir follows it',
      run: (ctx) => {
        ctx.expect(resolvePackageDir('@walk-test/linked', NESTED)).toBe(path.join(ROOT, 'node_modules', '@walk-test', 'linked'));
        ctx.expect(resolvePackageRealDir('@walk-test/linked', NESTED)).toBe(CHECKOUT);
      },
    },

    {
      name: 'nothing installed returns null',
      run: (ctx) => {
        ctx.expect(resolvePackageDir('@walk-test/missing', NESTED)).toBe(null);
        ctx.expect(resolvePackageRealDir('@walk-test/missing', NESTED)).toBe(null);
      },
    },
  ],
});
