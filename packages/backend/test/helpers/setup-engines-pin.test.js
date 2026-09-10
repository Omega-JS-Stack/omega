/**
 * Test: cli/utils/ensure-target.js — the engines.node stamp
 * The engines.node stamp derives from the FRAMEWORK's pinned Cloud Functions
 * runtime (`omega.functionsRuntime` — engines.node is the dev floor `>=22`,
 * not a version) — never the ambient process. The scaffold must produce the
 * same app under any shell Node (cp195 journey catch: an ambient-24 run
 * stamped 24 against the v22/* .nvmrc default and `omega dev` died on the
 * Manager.init version mismatch).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const { ensureTarget } = require('../../dist/cli/utils/ensure-target.js');
const frameworkPackage = require('../../package.json');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// ensureTarget() against a bare manifest in a temp dir runs the REAL stamp
function runScaffoldPackageJson(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engines-pin-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));

  ensureTarget({ projectDir: dir });

  const written = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return written;
}

module.exports = defineCases({
  description: 'ensureTarget engines.node pin (framework SSOT, never ambient)',
  type: 'group',

  tests: [
    {
      name: 'fresh-app-gets-the-framework-pin',
      async run({ assert }) {
        const frameworkMajor = String(parseInt(frameworkPackage.omega.functionsRuntime, 10));
        const written = runScaffoldPackageJson({ name: 'pin-test-app' });

        assert.equal(written.engines.node, frameworkMajor,
          `engines.node must be the framework's pinned runtime (${frameworkMajor}), independent of the node running the scaffold (${process.versions.node})`);
      },
    },

    {
      name: 'existing-engines-survive-untouched',
      async run({ assert }) {
        const written = runScaffoldPackageJson({ name: 'pin-test-app', engines: { node: '20' } });

        assert.equal(written.engines.node, '20', 'a consumer-authored engines.node is never overwritten');
      },
    },

    {
      name: 'nvmrc-lockstep-fix-writes-the-same-major',
      async run({ assert }) {
        // The nvmrc target check heals .nvmrc to `v<engines.node>/*` — with
        // engines stamped from the framework pin, both files must agree
        const frameworkMajor = String(parseInt(frameworkPackage.omega.functionsRuntime, 10));
        const written = runScaffoldPackageJson({ name: 'pin-test-app' });

        assert.equal(`v${written.engines.node}/*`, `v${frameworkMajor}/*`,
          '.nvmrc heal target (v<engines>/*) matches the framework pin');
      },
    },
  ],
});
