/**
 * Test: cli/commands/setup-tests manifest discipline (cp195 journey catches)
 *
 * 1. Fixes that WRITE the target manifest fresh-read it first — an npm-driven
 *    fix earlier in the run rewrote the file, and writing the boot-time
 *    snapshot erased those installs (the project-scripts fix clobbered
 *    firebase-admin/firebase-functions; the next setup's re-install then
 *    raced the monorepo watch through the file: link and killed the boot).
 * 2. Dependency-install fixes run npm with --ignore-scripts — a bare
 *    install in a file:-linked brand re-runs the LINKED framework's prepare
 *    inside the monorepo (it rmdir'd @omega.js/backend's own dist mid-run).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const BaseTest = require('../../dist/cli/commands/setup-tests/base-test.js');
const NpmProjectScriptsTest = require('../../dist/cli/commands/setup-tests/npm-project-scripts.js');
const frameworkPackage = require('../../package.json');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A minimal instance around a temp target dir: `stale` is the boot-time
// in-memory manifest; the DISK manifest then diverges (npm added a dep)
function makeInstance(TestClass, dir, stale) {
  const context = { main: { package: stale, firebaseProjectPath: dir }, package: stale };
  const instance = new TestClass(context);
  return instance;
}

module.exports = defineCases({
  description: 'Setup manifest sync (fresh-read writes, --ignore-scripts installs)',
  type: 'group',

  tests: [
    {
      name: 'project-scripts-fix-preserves-npm-added-deps',
      async run({ assert }) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-sync-'));
        const stale = { name: 'sync-app', dependencies: { '@omega.js/backend': '*' } };
        // Disk moved on: an npm fix added firebase-admin after boot
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
          ...stale,
          dependencies: { ...stale.dependencies, 'firebase-admin': '^13.0.0' },
        }, null, 2));

        const instance = makeInstance(NpmProjectScriptsTest, dir, stale);
        await instance.fix();

        const written = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        assert.equal(written.dependencies['firebase-admin'], '^13.0.0',
          'the npm-added dep must survive a manifest-writing fix');
        assert.equal(written.scripts.setup, frameworkPackage.projectScripts.setup,
          'the fix still lands every projectScript');
        assert.equal(instance.self.package.dependencies['firebase-admin'], '^13.0.0',
          'the shared in-memory manifest resyncs to disk truth');

        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'manifest-writing-fix-keeps-the-trailing-newline',
      async run({ assert }) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-sync-'));
        const manifest = { name: 'newline-app', scripts: {} };
        // ensure-target's byte contract: npm's shape, trailing newline included
        fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

        const instance = makeInstance(NpmProjectScriptsTest, dir, manifest);
        await instance.fix();

        const bytes = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
        assert.equal(bytes.endsWith('\n'), true,
          'a setup-test fix keeps the trailing newline every sibling writer writes');
        assert.equal(bytes.endsWith('\n\n'), false, 'exactly one, never a growing tail');

        fs.rmSync(dir, { recursive: true, force: true });
      },
    },

    {
      name: 'install-command-carries-ignore-scripts',
      async run({ assert }) {
        const instance = makeInstance(BaseTest, os.tmpdir(), {});

        assert.equal(
          instance.buildInstallCommand('firebase-functions', '@^7.2.5'),
          'npm i firebase-functions@^7.2.5 --ignore-scripts',
        );
        assert.equal(
          instance.buildInstallCommand('some-tool', null, 'dev'),
          'npm i some-tool@latest --save-dev --ignore-scripts',
        );
      },
    },

    {
      name: 'readTargetManifest-refreshes-in-place-keeping-object-identity',
      async run({ assert }) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-sync-'));
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fresh', dependencies: { x: '1' } }));

        const stale = { name: 'stale', scripts: { gone: 'yes' } };
        const instance = makeInstance(BaseTest, dir, stale);
        const returned = instance.readTargetManifest();

        assert.equal(returned === stale, true, 'same object identity — every context view stays live');
        assert.equal(stale.name, 'fresh', 'contents come from disk');
        assert.equal(stale.scripts, undefined, 'stale keys are gone');
        assert.equal(stale.dependencies.x, '1', 'disk keys are present');

        fs.rmSync(dir, { recursive: true, force: true });
      },
    },
  ],
});
