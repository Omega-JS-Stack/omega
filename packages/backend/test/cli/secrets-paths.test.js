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
const ProjectIdConsistencyTest = require('../../dist/cli/commands/setup-tests/project-id-consistency.js');
const { SERVICE_ACCOUNT_REL } = require('../../dist/vendor/devkit/service-account.js');
const { writeJson } = require('../../dist/vendor/devkit/write-json.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** A brand root with a backend target under it, and (unless `withKey` is false) the minted key in its ONE home. */
function seedBrand({ withKey = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-secrets-paths-')));
  const targetDir = path.join(root, 'targets', 'backend');

  jetpack.write(path.join(root, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    targets: { backend: { type: 'backend' } },
  }));
  jetpack.dir(targetDir);
  if (withKey) {
    writeJson(path.join(root, SERVICE_ACCOUNT_REL), { project_id: 'fixture-project' });
  }

  return { root, targetDir };
}

module.exports = defineCases({
  description: 'Backend secrets paths',
  type: 'group',
  tests: [
    {
      name: 'the-service-account-check-reads-the-devkit-path',
      async run({ expect }) {
        const { root, targetDir } = seedBrand();
        const check = new ServiceAccountTest({ main: { firebaseProjectPath: targetDir } });

        expect(check.resolveSaPath()).toBe(path.join(root, SERVICE_ACCOUNT_REL));

        jetpack.remove(root);
      },
    },

    {
      name: 'the-project-id-check-reads-the-brand-root-key-through-the-same-resolver',
      async run({ expect }) {
        // No key at the target root, one at the brand's secrets home: the
        // project-id check reads the same file the service-account check does.
        const { root, targetDir } = seedBrand();
        const check = new ProjectIdConsistencyTest({ main: { firebaseProjectPath: targetDir } });

        try {
          const sources = check.getProjectIdSources();

          expect(sources.serviceAccount.exists, 'the brand-root key is found').toBe(true);
          expect(sources.serviceAccount.projectId, 'and its project id is the one read').toBe('fixture-project');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'with-no-key-anywhere-the-write-default-is-the-target-root',
      async run({ expect }) {
        // Nothing to read, so the check names where its fix would write.
        const { root, targetDir } = seedBrand({ withKey: false });
        const check = new ServiceAccountTest({ main: { firebaseProjectPath: targetDir } });
        const sources = new ProjectIdConsistencyTest({ main: { firebaseProjectPath: targetDir } }).getProjectIdSources();

        try {
          expect(check.resolveSaPath(), 'the target-root path is the write default').toBe(path.join(targetDir, 'service-account.json'));
          expect(sources.serviceAccount, 'the project-id check reads nothing').toEqual({ exists: false, projectId: null });
        } finally {
          jetpack.remove(root);
        }
      },
    },
  ],
});
