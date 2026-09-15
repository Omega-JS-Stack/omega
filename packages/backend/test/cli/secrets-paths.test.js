/**
 * Test: the backend's readers of the brand secrets folder resolve the devkit
 * path ([#897](https://github.com/Omega-JS-Stack/omega/issues/897)).
 *
 * `.omega/secrets/service-account.json` has ONE spelling,
 * `SERVICE_ACCOUNT_REL` in @omega.js/devkit/service-account. The setup check
 * that reads the key used to type the path itself, so a rename of the folder
 * would have moved the writer and left the check looking at the old place.
 *
 * Offline by construction: the brand is a temp dir holding a throwaway JSON
 * file, and nothing but the path resolution runs.
 *
 * Run: npx omega test backend:cli/secrets-paths
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const ServiceAccountTest = require('../../dist/cli/commands/setup-tests/service-account.js');
const { SERVICE_ACCOUNT_REL } = require('../../dist/vendor/devkit/service-account.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** A brand root with a backend target under it, and the minted key in its ONE home. */
function seedBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-secrets-paths-')));
  const targetDir = path.join(root, 'targets', 'backend');

  jetpack.write(path.join(root, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    targets: { backend: { type: 'backend' } },
  }));
  jetpack.dir(targetDir);
  jetpack.write(path.join(root, SERVICE_ACCOUNT_REL), JSON.stringify({ project_id: 'fixture-project' }));

  return { root, targetDir };
}

module.exports = defineCases({
  description: 'Backend secrets paths',
  type: 'group',
  tests: [
    {
      name: 'the-service-account-check-reads-the-devkit-path',
      async run({ assert }) {
        const { root, targetDir } = seedBrand();
        const check = new ServiceAccountTest({ main: { firebaseProjectPath: targetDir } });

        assert.equal(check.resolveSaPath(), path.join(root, SERVICE_ACCOUNT_REL));

        jetpack.remove(root);
      },
    },
  ],
});
