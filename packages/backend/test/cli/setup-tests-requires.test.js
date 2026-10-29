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

// Runs the functions-package check over a temp target whose staged manifest sits at dist/package.json
async function runFunctionsPackage(targetDependencies, stagedDependencies) {
  const FunctionsPackageTest = require(path.join(DIR, 'functions-package.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-functions-package-'));
  const manifest = { name: 'app', version: '1.0.0', private: true, dependencies: targetDependencies };

  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'package.json'), JSON.stringify({
    main: 'index.js',
    engines: { node: '22' },
    dependencies: stagedDependencies,
  }));

  const check = new FunctionsPackageTest({ package: manifest, main: { firebaseProjectPath: root, package: manifest } });

  return check.run();
}

module.exports = defineCases({
  description: 'Setup-tests relative requires resolve',
  type: 'group',
  tests: [
    {
      name: 'every-relative-require-in-setup-tests-resolves',
      async run({ expect }) {
        const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
        expect(files.length > 10, `setup-tests directory found (${files.length} modules)`).toBe(true);

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
            expect(resolved, `${file} requires "${target}" which does not resolve`).toBe(true);
          }
        }
      },
    },
    {
      name: 'functions-package-compares-the-staged-deps-against-the-target-manifest',
      async run({ expect }) {
        const dependencies = { 'firebase-admin': '^13.0.0' };

        expect(await runFunctionsPackage(dependencies, dependencies), 'a staged manifest carrying the target deps passes').toBe(true);
      },
    },
    {
      name: 'functions-package-passes-an-already-staged-linked-brand',
      async run({ expect }) {
        const target = { 'firebase-admin': '^13.0.0', '@omega.js/backend': 'file:../../packages/backend' };
        const staged = { 'firebase-admin': '^13.0.0', '@omega.js/backend': 'file:../../../packages/backend' };

        expect(await runFunctionsPackage(target, staged), 'a staged manifest carrying the rewritten file: spec passes').toBe(true);
      },
    },
    {
      name: 'functions-package-fails-when-the-staged-deps-differ',
      async run({ expect }) {
        const target = { 'firebase-admin': '^13.0.0' };
        const staged = { 'firebase-admin': '^12.0.0' };

        expect(await runFunctionsPackage(target, staged), 'a staged manifest whose deps drifted from the target fails').toBe(false);
      },
    },
  ],
});
