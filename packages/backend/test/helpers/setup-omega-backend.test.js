/**
 * Test: cli/commands/setup-tests/omega-backend.js, the framework version check
 *
 * The check reads the @omega.js/backend the target RESOLVES (walking up
 * node_modules, so workspace hoisting and file: links both count), never the
 * manifest pin ([#965](https://github.com/Omega-JS-Stack/omega/issues/965)).
 * A resolved monorepo checkout passes whatever the manifest says; a registry
 * copy behind latest WARNS naming `npx omega update`. The check never installs
 * and never exits: `omega update` is the one updater.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const OmegaBackendTest = require('../../dist/cli/commands/setup-tests/omega-backend.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const PKG = '@omega.js/backend';

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// A check instance around a target dir whose manifest pins `pinned`, with the
// registry lookup stubbed to `latest` and every side effect armed to throw.
function makeInstance(targetDir, pinned, latest) {
  const manifest = { name: 'version-app', dependencies: { [PKG]: pinned } };
  writeJSON(path.join(targetDir, 'package.json'), manifest);

  const instance = new OmegaBackendTest({ main: { package: manifest, firebaseProjectPath: targetDir }, package: manifest });
  instance.getPkgVersion = async () => latest;
  instance.installPkg = async () => {
    throw new Error('the version check must never install');
  };
  return instance;
}

// Run the check with process.exit armed to throw: a check that exits mid-run
// is exactly the #965 bug.
async function runGuarded(instance) {
  const realExit = process.exit;
  process.exit = (code) => {
    throw new Error(`the version check must never exit (code ${code})`);
  };

  try {
    return await instance.run();
  } finally {
    process.exit = realExit;
  }
}

// <tmp>/brands/x/targets/backend with the package installed as a REAL
// registry-shaped copy under the target's own node_modules
function registryTree(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-check-'));
  const targetDir = path.join(root, 'brands', 'x', 'targets', 'backend');
  writeJSON(path.join(targetDir, 'node_modules', PKG, 'package.json'), { name: PKG, version });
  return { root, targetDir };
}

module.exports = defineCases({
  description: 'Setup check: using updated @omega.js/backend (resolution, never the manifest)',
  type: 'group',

  tests: [
    {
      name: 'monorepo-checkout-passes-whatever-the-manifest-pins',
      async run({ assert }) {
        // A monorepo root the way devkit's isMonorepoRoot detects one: named
        // "omega" with a packages/devkit workspace
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-check-'));
        writeJSON(path.join(root, 'package.json'), { name: 'omega', private: true });
        writeJSON(path.join(root, 'packages', 'devkit', 'package.json'), { name: '@omega.js/devkit' });
        writeJSON(path.join(root, 'packages', 'backend', 'package.json'), { name: PKG, version: '0.52.0' });

        const targetDir = path.join(root, 'brands', 'x', 'targets', 'backend');
        fs.mkdirSync(path.join(targetDir, 'node_modules', '@omega.js'), { recursive: true });
        fs.symlinkSync(path.join(root, 'packages', 'backend'), path.join(targetDir, 'node_modules', PKG), 'dir');

        const instance = makeInstance(targetDir, '0.51.0', '0.53.0');
        const result = await runGuarded(instance);

        assert.equal(result, true, 'a resolved monorepo checkout passes even with the manifest pin and the checkout behind latest');

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'registry-copy-behind-latest-warns-and-never-installs',
      async run({ assert }) {
        const { root, targetDir } = registryTree('0.51.0');
        const instance = makeInstance(targetDir, '^0.51.0', '0.52.0');
        const result = await runGuarded(instance);

        assert.equal(result, 'warn', 'behind latest is a warn, never a fail that runs a fix');
        const warning = instance.getWarning().join('\n');
        assert.match(warning, /0\.51\.0/, 'the warning names the resolved version');
        assert.match(warning, /0\.52\.0/, 'the warning names the latest');
        assert.match(warning, /npx omega update/, 'the warning names the one updater');
        // The harness assert carries no rejects(), so the rejection is caught by hand
        const fixError = await instance.fix().then(() => null, (error) => error);
        assert.ok(fixError, 'the check carries no fix of its own');
        assert.match(fixError.message, /No automatic fix/, 'fix() is the BaseTest default, never an install');

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'registry-copy-at-latest-passes',
      async run({ assert }) {
        const { root, targetDir } = registryTree('0.52.0');
        // The manifest pin is stale on purpose: resolution answers, not the pin
        const instance = makeInstance(targetDir, '0.40.0', '0.52.0');
        const result = await runGuarded(instance);

        assert.equal(result, true, 'the resolved copy at latest passes');

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'unresolved-package-warns-naming-omega-update',
      async run({ assert }) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-check-'));
        const targetDir = path.join(root, 'targets', 'backend');
        const instance = makeInstance(targetDir, '^0.52.0', '0.52.0');
        const result = await runGuarded(instance);

        assert.equal(result, 'warn', 'nothing resolved is a warn');
        assert.match(instance.getWarning().join('\n'), /npx omega update/, 'the warning names the one updater');

        fs.rmSync(root, { recursive: true, force: true });
      },
    },
  ],
});
