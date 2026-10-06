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
      async run({ expect }) {
        expect(Object.keys(pkg.exports || {}).sort()).toEqual(DOORS);
      },
    },
    ...Object.entries(pkg.exports || {}).map(([door, target]) => ({
      name: `${door} resolves to ${target}`,
      async run({ expect }) {
        expect(require.resolve(specifier(door))).toBe(path.join(PACKAGE_ROOT, target));
      },
    })),
    {
      name: 'a-path-the-map-does-not-name-is-refused',
      async run({ expect }) {
        let code = null;
        try {
          require.resolve(`${pkg.name}/dist/vendor/config/env.js`);
        } catch (e) {
          code = e.code;
        }
        expect(code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
      },
    },
    {
      name: 'the-test-door-hands-consumers-defineCases-and-expect',
      async run({ expect }) {
        const door = require(`${pkg.name}/test`);

        expect(door.defineCases).toBe(defineCases);
        expect(typeof door.expect).toBe('function');
        expect(door.expect).toBe(require('../../dist/vendor/devkit/test/expect.js'));
      },
    },
    {
      name: 'the-config-door-carries-the-deploy-workflows-serializeEnv',
      async run({ expect }) {
        expect(typeof require(`${pkg.name}/config`).serializeEnv).toBe('function');
      },
    },
  ],
});
