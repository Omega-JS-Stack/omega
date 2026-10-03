/**
 * package.json#exports is the router's whole public surface: every door
 * resolves BY PACKAGE NAME to the file the map names, the door set is the one
 * the sibling packages spell, and a path the map does not name is refused.
 * Resolve only: requiring the root or ./cli starts the stdio server.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_ROOT = fs.realpathSync(path.join(__dirname, '..'));
const pkg = require('../package.json');

// '.' is the bare package name; every other door appends its subpath
function specifier(door) {
  return door === '.' ? pkg.name : `${pkg.name}${door.slice(1)}`;
}

module.exports = defineCases({
  type: 'group',
  description: 'exports',
  tests: [
    {
      name: 'the map opens exactly the doors the siblings spell',
      run: (ctx) => {
        ctx.expect(Object.keys(pkg.exports || {}).sort()).toEqual(['.', './cli', './package.json']);
      },
    },

    {
      name: 'every door resolves by package name to the file the map names',
      run: (ctx) => {
        for (const [door, target] of Object.entries(pkg.exports)) {
          ctx.expect(require.resolve(specifier(door)), door).toBe(path.join(PACKAGE_ROOT, target));
        }
      },
    },

    {
      name: 'a path the map does not name is refused',
      run: (ctx) => {
        ctx.expect(() => require.resolve(`${pkg.name}/bin/mcp-router.js`)).toThrow({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
      },
    },
  ],
});
