/**
 * Test: an ESM-only dependency loads in the functions runtime
 * ([#906](https://github.com/Omega-JS-Stack/omega/issues/906))
 *
 * Every other OMEGA target BUNDLES, and the issue was a bundler bug: esbuild
 * rewrites `import.meta` to `{}` in CommonJS output, so a dependency opening a
 * require of its own with `createRequire(import.meta.url)` was handed
 * `undefined`. @omega.js/backend never bundles (`stage-functions` copies
 * `src/**` into `dist/**` 1:1), so its half of the promise is the plain one:
 * the CommonJS functions tree can depend on a package that ships ESM ONLY,
 * because Node 22 requires an ES module synchronously.
 *
 * The dependency is the ONE fixture every target proves this with, installed
 * into a staged tree the way npm installs one.
 *
 * Run: npx omega test backend:cli/esm-only-dependency
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { installEsmOnlyFixture, FIXTURE_NAME, NODE_MARKER } = require('../../dist/vendor/devkit/test/esm-only-fixture.js');

/**
 * A staged functions tree: a CommonJS module that pulls the dependency in by
 * bare name, exactly as a consumer's `src/**` file would, beside the installed
 * package.
 * @returns {string} the module to require
 */
function stageFunctionsTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backend-esm-only-')));

  jetpack.write(path.join(root, 'package.json'), JSON.stringify({ name: 'staged-functions', version: '1.0.0' }));
  jetpack.write(path.join(root, 'index.js'), [
    `const fixture = require(${JSON.stringify(FIXTURE_NAME)});`,
    'module.exports = { fileUrl: fixture.fileUrl, viaRequire: fixture.viaRequire, marker: fixture.marker };',
    '',
  ].join('\n'));

  installEsmOnlyFixture(root);

  return path.join(root, 'index.js');
}

module.exports = defineCases({
  description: 'An ESM-only dependency loads in the CommonJS functions runtime (#906)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-commonjs-function-requires-an-esm-only-package',
      async run({ assert }) {
        const entry = stageFunctionsTree();
        try {
          const loaded = require(entry);

          assert.equal(loaded.marker, NODE_MARKER);
          // Unbundled, `import.meta.url` is the dependency's own file, and the
          // require it opens from it works.
          assert.ok(loaded.fileUrl.startsWith('file://'), `import.meta.url answered a file URL, got ${loaded.fileUrl}`);
          assert.equal(loaded.viaRequire, true);
        } finally {
          delete require.cache[entry];
          jetpack.remove(path.dirname(entry));
        }
      },
    },
  ],
});
