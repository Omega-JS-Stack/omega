/**
 * Test: cli/commands/setup.js scaffoldPackageJson
 * The engines.node stamp derives from the FRAMEWORK's pinned Cloud Functions
 * runtime — never the ambient process. Setup must produce the same app under
 * any shell Node (cp195 journey catch: an ambient-24 setup stamped 24 against
 * the v22/* .nvmrc default and `omega dev` died on the Manager.init version
 * mismatch).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const SetupCommand = require('../../src/cli/commands/setup.js');
const frameworkPackage = require('../../package.json');

// scaffoldPackageJson touches only self.package/self.firebaseProjectPath and
// ui.status — a bare prototype instance with those stubbed runs the REAL code
function runScaffoldPackageJson(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engines-pin-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));

  const command = Object.create(SetupCommand.prototype);
  command.main = { package: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')), firebaseProjectPath: dir };
  command.ui = { status: () => {} };
  command.scaffoldPackageJson();

  const written = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return written;
}

module.exports = {
  description: 'Setup engines.node pin (framework SSOT, never ambient)',
  type: 'group',

  tests: [
    {
      name: 'fresh-app-gets-the-framework-pin',
      async run({ assert }) {
        const frameworkMajor = String(parseInt(frameworkPackage.engines.node, 10));
        const written = runScaffoldPackageJson({ name: 'pin-test-app' });

        assert.equal(written.engines.node, frameworkMajor,
          `engines.node must be the framework's pinned runtime (${frameworkMajor}), independent of the node running setup (${process.versions.node})`);
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
        // The nvmrc setup test heals .nvmrc to `v<engines.node>/*` — with
        // engines stamped from the framework pin, both files must agree
        const frameworkMajor = String(parseInt(frameworkPackage.engines.node, 10));
        const written = runScaffoldPackageJson({ name: 'pin-test-app' });

        assert.equal(`v${written.engines.node}/*`, `v${frameworkMajor}/*`,
          '.nvmrc heal target (v<engines>/*) matches the framework pin');
      },
    },
  ],
};
