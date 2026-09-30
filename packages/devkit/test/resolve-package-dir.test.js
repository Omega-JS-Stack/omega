// Unit tests for the ONE node_modules walk in src/local.js: resolvePackageDir
// (the installed entry, a link left a link) and resolvePackageRealDir (its
// real path). Real dirs and real symlinks in a throwaway tree, no mocks.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { resolvePackageDir, resolvePackageRealDir } = require('../src/local.js');

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-package-dir-')));
const NESTED = path.join(ROOT, 'apps', 'web', 'src');
const CHECKOUT = path.join(ROOT, 'checkout', 'linked');

after(() => jetpack.remove(ROOT));

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

test('a hoisted copy is found from a nested target', () => {
  const expected = path.join(ROOT, 'node_modules', '@walk-test', 'hoisted');
  assert.equal(resolvePackageDir('@walk-test/hoisted', NESTED), expected);
  assert.equal(resolvePackageRealDir('@walk-test/hoisted', NESTED), expected);
});

test('the nearest copy wins over a hoisted one', () => {
  const expected = path.join(ROOT, 'apps', 'web', 'node_modules', '@walk-test', 'shadowed');
  assert.equal(resolvePackageDir('@walk-test/shadowed', NESTED), expected);
  assert.equal(resolvePackageRealDir('@walk-test/shadowed', NESTED), expected);
});

test('a linked copy: resolvePackageDir keeps the link, resolvePackageRealDir follows it', () => {
  assert.equal(resolvePackageDir('@walk-test/linked', NESTED), path.join(ROOT, 'node_modules', '@walk-test', 'linked'));
  assert.equal(resolvePackageRealDir('@walk-test/linked', NESTED), CHECKOUT);
});

test('nothing installed returns null', () => {
  assert.equal(resolvePackageDir('@walk-test/missing', NESTED), null);
  assert.equal(resolvePackageRealDir('@walk-test/missing', NESTED), null);
});
