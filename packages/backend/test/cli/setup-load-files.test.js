/**
 * Test: the target checks' loadFiles() reads remoteconfig.template.json from
 * the TARGET ROOT ([#280](https://github.com/Omega-JS-Stack/omega/issues/280)).
 *
 * The read pointed at `${projectPath}/functions/`, a pre-src/dist layout path
 * where nothing lives anymore, while the check that WRITES the file
 * (setup-tests/remoteconfig-template-file.js) puts it at the target root — so
 * `self.remoteconfigJSON` came back `{}` no matter what the file said.
 *
 * loadFiles() is plain file reads against a seeded temp directory — no
 * project, no emulator.
 *
 * Run: npx omega test backend:cli/setup-load-files
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const { loadFiles: loadTargetFiles } = require('../../dist/cli/utils/target-checks.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const REMOTECONFIG = {
  conditions: [],
  parameters: {
    omega_test_parameter: { defaultValue: { value: 'seeded' } },
  },
};

// A temp target root outside any brand tree: no omega.json5 above it, so
// loadFiles() resolves an empty config and only the file reads run.
function seedTarget() {
  const targetPath = jetpack.tmpDir({ prefix: 'omega-setup-load-files-' }).path();

  jetpack.write(path.join(targetPath, 'package.json'), JSON.stringify({ name: 'seeded-app' }, null, 2));
  jetpack.write(path.join(targetPath, 'remoteconfig.template.json'), JSON.stringify(REMOTECONFIG, null, 2));

  return targetPath;
}

function loadFiles(targetPath) {
  return loadTargetFiles({ firebaseProjectPath: targetPath, argv: {}, options: {} });
}

module.exports = defineCases({
  description: 'target checks: loadFiles() reads the target-root remoteconfig template',
  type: 'group',
  timeout: 10000,

  tests: [
    {
      name: 'remoteconfig-template-loads-from-the-target-root',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget();

        try {
          const main = loadFiles(targetPath);

          assert.deepEqual(main.remoteconfigJSON, REMOTECONFIG, 'the target-root remoteconfig.template.json must be loaded, not an empty object');
          assert.equal(main.package.name, 'seeded-app', 'the target manifest still loads from the same root');
        } finally {
          jetpack.remove(targetPath);
        }
      },
    },
  ],
});
