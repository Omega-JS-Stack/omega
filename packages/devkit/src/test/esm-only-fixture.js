/**
 * The ONE ESM-only dependency every OMEGA target proves its bundle lane against
 * ([#906](https://github.com/Omega-JS-Stack/omega/issues/906)).
 *
 * `fixtures/esm-only-package/` is a real package (`"type": "module"`, no
 * CommonJS build) with one entry per environment, chosen by export condition:
 * the NODE entry opens a require of its own with
 * `createRequire(import.meta.url)`, the shape that threw in a packaged desktop
 * app, and the BROWSER entry touches no Node built-in. One package, so a target
 * asks for it by its own name and gets the half its bundle is built for.
 *
 * It is INSTALLED rather than pointed at: `installEsmOnlyFixture(projectRoot)`
 * copies it into the project's `node_modules`, which is where a bundler's normal
 * resolution looks and the only shape that is the same in this monorepo and in a
 * consumer running a framework's self-test off its packaged dist (desktop and
 * extension carry the directory there through `omega.vendorAssets`).
 */
const path = require('path');
const jetpack = require('fs-jetpack');

// The name a consumer entry imports, and what the fixture's two entries say
// about themselves. Exported because a test asserting the bundled copy ran must
// compare against the ONE spelling, not a retyped twin.
const FIXTURE_NAME = 'esm-only-fixture';
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'esm-only-package');
const NODE_MARKER = 'ESM_ONLY_FIXTURE_NODE';
const BROWSER_MARKER = 'ESM_ONLY_FIXTURE_BROWSER';

/**
 * Install the fixture into a project, the way npm installs a dependency.
 * @param {string} projectRoot - the project that will import it
 * @returns {string} where it landed (`<projectRoot>/node_modules/esm-only-fixture`)
 * @throws {Error} when the fixture is not where this module ships it: in a
 *   packaged framework that means the vendor step did not carry it, and a test
 *   that silently skipped the dependency would prove nothing
 */
function installEsmOnlyFixture(projectRoot) {
  if (!jetpack.exists(FIXTURE_DIR)) {
    throw new Error(`[devkit test] the ESM-only fixture is missing from ${FIXTURE_DIR}. A framework running this off its packaged dist needs the omega.vendorAssets entry that carries it`);
  }

  const destination = path.join(projectRoot, 'node_modules', FIXTURE_NAME);
  jetpack.copy(FIXTURE_DIR, destination, { overwrite: true });

  return destination;
}

module.exports = { installEsmOnlyFixture, FIXTURE_NAME, FIXTURE_DIR, NODE_MARKER, BROWSER_MARKER };
