/**
 * package.json#exports is the router's whole public surface: every door
 * resolves BY PACKAGE NAME to the file the map names, the door set is the one
 * the sibling packages spell, and a path the map does not name is refused.
 * Resolve only: requiring the root or ./cli starts the stdio server.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_ROOT = fs.realpathSync(path.join(__dirname, '..'));
const pkg = require('../package.json');

// '.' is the bare package name; every other door appends its subpath
function specifier(door) {
  return door === '.' ? pkg.name : `${pkg.name}${door.slice(1)}`;
}

test('the map opens exactly the doors the siblings spell', () => {
  assert.deepEqual(Object.keys(pkg.exports || {}).sort(), ['.', './cli', './package.json']);
});

test('every door resolves by package name to the file the map names', () => {
  for (const [door, target] of Object.entries(pkg.exports)) {
    assert.equal(require.resolve(specifier(door)), path.join(PACKAGE_ROOT, target), door);
  }
});

test('a path the map does not name is refused', () => {
  assert.throws(
    () => require.resolve(`${pkg.name}/bin/mcp-router.js`),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
  );
});
