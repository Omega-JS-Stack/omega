/**
 * package.json#exports is the backend's whole public surface: every door
 * resolves BY PACKAGE NAME to the file the map names, the door set is the one
 * the sibling frameworks spell, and a path the map does not name is refused.
 * Doors resolve only; the root door would boot the framework runtime.
 *
 * Run: npx omega test backend:boot/exports
 */
const fs = require('fs');
const path = require('path');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const PACKAGE_ROOT = fs.realpathSync(path.join(__dirname, '..', '..'));
const pkg = require(path.join(PACKAGE_ROOT, 'package.json'));

const DOORS = [
  '.',
  './cli',
  './config',
  './ensure-target',
  './lib/email-constants',
  './lib/mcp-utils',
  './migrate',
  './package.json',
  './test',
];

// '.' is the bare package name; every other door appends its subpath
function specifier(door) {
  return door === '.' ? pkg.name : `${pkg.name}${door.slice(1)}`;
}

module.exports = defineCases({
  description: 'package.json#exports: every door resolves by package name',
  type: 'group',

  tests: [
    {
      name: 'the-map-opens-exactly-the-doors-the-siblings-spell',
      async run({ assert }) {
        assert.deepEqual(Object.keys(pkg.exports || {}).sort(), DOORS);
      },
    },
    ...Object.entries(pkg.exports || {}).map(([door, target]) => ({
      name: `${door} resolves to ${target}`,
      async run({ assert }) {
        assert.equal(require.resolve(specifier(door)), path.join(PACKAGE_ROOT, target));
      },
    })),
    {
      name: 'a-path-the-map-does-not-name-is-refused',
      async run({ assert }) {
        let code = null;
        try {
          require.resolve(`${pkg.name}/dist/vendor/config/env.js`);
        } catch (e) {
          code = e.code;
        }
        assert.equal(code, 'ERR_PACKAGE_PATH_NOT_EXPORTED');
      },
    },
    {
      name: 'the-test-door-hands-consumers-defineCases',
      async run({ assert }) {
        assert.equal(require(`${pkg.name}/test`).defineCases, defineCases);
      },
    },
    {
      name: 'the-config-door-carries-the-deploy-workflows-serializeEnv',
      async run({ assert }) {
        assert.equal(typeof require(`${pkg.name}/config`).serializeEnv, 'function');
      },
    },
  ],
});
