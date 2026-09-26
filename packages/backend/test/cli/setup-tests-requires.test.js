/**
 * Test: setup-tests relative requires resolve (pure logic)
 *
 * The lazy requires in the setup tests' live-project branches only execute
 * during a real-project setup run, so a broken path ships silently and first
 * fails in a consumer's boot (the playground's full `omega dev` walk hit
 * `require('../index')`, a module that never existed). Every relative require
 * in the directory must resolve from its own location.
 *
 * The same blind spot hides a free variable inside a check's run(): nothing
 * offline ran functions-package's staged-manifest comparison, so its read of an
 * undefined `app` shipped ([#951](https://github.com/Omega-JS-Stack/omega/issues/951)).
 * That branch runs here over a real target manifest and its staged copy.
 *
 * Run: npx omega test backend:cli/setup-tests-requires
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const DIR = path.join(__dirname, '..', '..', 'dist', 'cli', 'commands', 'setup-tests');

module.exports = defineCases({
  description: 'Setup-tests relative requires resolve',
  type: 'group',
  tests: [
    {
      name: 'every-relative-require-in-setup-tests-resolves',
      async run({ assert }) {
        const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
        assert.equal(files.length > 10, true, `setup-tests directory found (${files.length} modules)`);

        for (const file of files) {
          const source = fs.readFileSync(path.join(DIR, file), 'utf8');

          for (const match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
            const target = match[1];
            let resolved = true;
            try {
              require.resolve(path.join(DIR, target));
            } catch (e) {
              resolved = false;
            }
            assert.equal(resolved, true, `${file} requires "${target}" which does not resolve`);
          }
        }
      },
    },
    {
      name: 'functions-package-compares-the-staged-deps-against-the-target-manifest',
      async run({ assert }) {
        const FunctionsPackageTest = require(path.join(DIR, 'functions-package.js'));
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-functions-package-'));
        const manifest = { name: 'app', version: '1.0.0', private: true, dependencies: { 'firebase-admin': '^13.0.0' } };

        fs.mkdirSync(path.join(root, 'functions'));
        fs.writeFileSync(path.join(root, 'functions', 'package.json'), JSON.stringify({
          main: 'index.js',
          engines: { node: '22' },
          dependencies: manifest.dependencies,
        }));

        const check = new FunctionsPackageTest({ package: manifest, main: { firebaseProjectPath: root, package: manifest } });

        assert.equal(await check.run(), true, 'a staged manifest carrying the target deps passes');
      },
    },
  ],
});
