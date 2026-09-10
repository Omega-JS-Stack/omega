/**
 * Test: the deploy lane LOADS the .env cascade before it resolves the license
 * ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)).
 *
 * A backend deploy runs straight from the CLI, so the key never rides the
 * artifact — it comes out of this process's environment. But nothing else in
 * the CLI boot loads a .env: without the lane's own load, a brand whose
 * OMEGA_LICENSE_KEY sits in the brand-root .env resolved `keyless`, baked
 * OMEGA_LICENSE_STATUS=keyless into dist/.env, and gated every payment
 * provider in production behind one gray log line.
 *
 * The lane is driven for real up to the license call and stopped there by a
 * sentinel: nothing here stages, spawns firebase, or reaches the network.
 *
 * Run: npx omega test backend:cli/deploy-license-env
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Thrown from the license seam: the deploy stops there, so nothing is staged
// and firebase is never spawned.
class ResolvedHere extends Error {}

/** A brand root holding the key, with a backend target under targets/. */
function makeBrand() {
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-license-')));
  const projectDir = path.join(brandRoot, 'targets', 'backend');

  jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'lane', name: 'Lane' },
    // NOT a demo-* project: a demo id short-circuits the check before the key
    // is ever read, which would prove nothing.
    cloud: { config: { projectId: 'lane-live' } },
    targets: { backend: {} },
  }, null, 2));
  jetpack.write(path.join(brandRoot, '.env'), 'OMEGA_LICENSE_KEY="brand-root-key"\n');
  jetpack.dir(projectDir);

  return { projectDir, cleanup: () => jetpack.remove(brandRoot) };
}

module.exports = defineCases({
  description: 'The deploy lane loads the .env cascade before the license check (#320)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the-deploy-lane-resolves-the-license-with-the-brand-root-key',
      auth: 'none',

      async run({ assert }) {
        const { projectDir, cleanup } = makeBrand();
        const license = require('../../dist/vendor/devkit/license.js');
        const attachLogFile = require('../../dist/cli/utils/attach-log-file');
        const deployPath = require.resolve('../../dist/cli/commands/deploy.js');
        const realResolve = license.resolveLicenseStamp;
        const savedKey = process.env.OMEGA_LICENSE_KEY;
        const seen = [];

        try {
          delete process.env.OMEGA_LICENSE_KEY;

          // The stamp reads its key from process.env — so what the environment
          // carries AT THE CALL is the whole question. Patched before the
          // command is required: deploy.js destructures the function at load.
          license.resolveLicenseStamp = () => {
            seen.push(process.env.OMEGA_LICENSE_KEY);
            throw new ResolvedHere();
          };
          delete require.cache[deployPath];
          const DeployCommand = require(deployPath);

          const command = new DeployCommand({ firebaseProjectPath: projectDir, argv: {}, options: {} });
          command.log = () => {};

          try {
            await command.execute();
          } catch (error) {
            if (!(error instanceof ResolvedHere)) throw error;
          }

          assert.deepEqual(seen, ['brand-root-key'],
            'the cascade is loaded first, so the brand root\'s key is the one the verdict answers for');
        } finally {
          await attachLogFile.detach();
          license.resolveLicenseStamp = realResolve;
          delete require.cache[deployPath];
          if (savedKey === undefined) delete process.env.OMEGA_LICENSE_KEY;
          else process.env.OMEGA_LICENSE_KEY = savedKey;
          cleanup();
        }
      },
    },
  ],
});
