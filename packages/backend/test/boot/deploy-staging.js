/**
 * Deploy staging — local file: dependencies become deployable tarballs.
 *
 * Cloud Build can't follow file: paths outside the functions folder, and its
 * buildpack runs `npm ci` (lockfile required). stage-local-packages packs such
 * deps into functions/omega_modules/, respells package.json, regenerates the
 * lockfile against that shape, and restores everything afterward. Exercised
 * against REAL npm on a throwaway package — no mocks.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');

const stageLocalPackages = require('../../dist/cli/utils/stage-local-packages.js');
const stageResolvedConfig = require('../../dist/cli/utils/stage-resolved-config.js');
const { loadConfig } = require('@omega.js/config');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bem-stage-'));
}

module.exports = {
  description: 'Deploy staging — local file: deps pack into the functions upload',
  type: 'group',
  timeout: 120000,

  tests: [
    {
      name: 'stages-outside-file-deps-and-restores',
      async run({ assert }) {
        const tmp = makeTmp();

        // A tiny real package OUTSIDE the functions dir...
        const pkgDir = path.join(tmp, 'fakepkg');
        jetpack.write(path.join(pkgDir, 'package.json'), JSON.stringify({
          name: '@omega.js/fakepkg',
          version: '1.0.0',
          private: true,
          main: 'index.js',
        }, null, 2));
        jetpack.write(path.join(pkgDir, 'index.js'), 'module.exports = 1;\n');

        // ...referenced the way the monorepo's functions dirs do it
        const functionsPath = path.join(tmp, 'functions');
        jetpack.write(path.join(functionsPath, 'package.json'), JSON.stringify({
          name: 'test-functions',
          version: '0.0.1',
          private: true,
          dependencies: { '@omega.js/fakepkg': 'file:../fakepkg' },
        }, null, 2) + '\n');

        const staging = await stageLocalPackages({ functionsPath });

        // Staged: tarball vendored inside, dep respelled, lockfile matches
        assert.deepEqual(staging.staged, ['@omega.js/fakepkg']);
        const stagedPkg = jetpack.read(path.join(functionsPath, 'package.json'), 'json');
        assert.equal(stagedPkg.dependencies['@omega.js/fakepkg'], 'file:omega_modules/omega.js-fakepkg-1.0.0.tgz');
        assert.equal(jetpack.exists(path.join(functionsPath, 'omega_modules', 'omega.js-fakepkg-1.0.0.tgz')), 'file');

        const lock = jetpack.read(path.join(functionsPath, 'package-lock.json'), 'json');
        assert.ok(lock, 'lockfile generated for the staged shape');
        assert.ok(lock.packages['node_modules/@omega.js/fakepkg'], 'lockfile resolves the staged tarball');

        // Restore: original shape back verbatim, staging artifacts gone
        await staging.restore();
        const restored = jetpack.read(path.join(functionsPath, 'package.json'), 'json');
        assert.equal(restored.dependencies['@omega.js/fakepkg'], 'file:../fakepkg');
        assert.equal(jetpack.exists(path.join(functionsPath, 'package-lock.json')), false, 'lockfile absent again (none existed before)');
        assert.equal(jetpack.exists(path.join(functionsPath, 'omega_modules')), false, 'staging dir removed');

        jetpack.remove(tmp);
      },
    },

    {
      name: 'no-op-when-no-outside-file-deps',
      async run({ assert }) {
        const tmp = makeTmp();

        const functionsPath = path.join(tmp, 'functions');
        jetpack.write(path.join(functionsPath, 'package.json'), JSON.stringify({
          name: 'fns',
          version: '1.0.0',
          private: true,
          dependencies: { 'firebase-admin': '^13.0.0' },
        }, null, 2));

        const staging = await stageLocalPackages({ functionsPath });

        assert.deepEqual(staging.staged, []);
        assert.equal(jetpack.exists(path.join(functionsPath, 'omega_modules')), false, 'nothing staged');
        await staging.restore(); // harmless no-op

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stages-resolved-config-across-the-upload-boundary-and-restores',
      async run({ assert }) {
        const tmp = makeTmp();

        // Brand monorepo shape: brand layer above a slim targets-only app file
        // (the exact shape that served "My Brand" from production — #31)
        const brandRoot = path.join(tmp, 'acme');
        const functionsPath = path.join(brandRoot, 'apps', 'api', 'functions');
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{
          // brand layer — must cross the upload boundary
          brand: { id: 'acme', name: 'Acme Corp', url: 'https://acme.test' },
          targets: { backend: {}, web: {} },
        }`);
        const appConfigPath = path.join(functionsPath, 'config', 'omega.json5');
        const originalAppSource = `{ targets: { backend: { flavor: 'api' } } }\n`;
        jetpack.write(appConfigPath, originalAppSource);

        const staging = await stageResolvedConfig({ functionsPath });
        assert.equal(staging.staged, true);
        assert.ok(jetpack.read(appConfigPath).startsWith('// Composed by `omega deploy`'), 'staged file carries the banner');

        // Simulate the upload: the functions folder ALONE, no brand parent —
        // the real loader must now resolve brand values, not defaults
        const uploadDir = path.join(tmp, 'upload');
        jetpack.copy(functionsPath, uploadDir);
        const uploaded = loadConfig(uploadDir, 'backend', {
          defaults: { brand: { id: 'my-app', name: 'My Brand' } },
        });
        assert.equal(uploaded.config.brand.name, 'Acme Corp', 'brand layer crossed the boundary');
        assert.equal(uploaded.config.flavor, 'api', 'app target section survived the flatten');
        assert.equal(uploaded.enabled, true);

        // Restore: original bytes back verbatim
        await staging.restore();
        assert.equal(jetpack.read(appConfigPath), originalAppSource);

        jetpack.remove(tmp);
      },
    },

    {
      name: 'config-staging-no-op-without-a-brand-layer',
      async run({ assert }) {
        const tmp = makeTmp();

        const functionsPath = path.join(tmp, 'functions');
        const appConfigPath = path.join(functionsPath, 'config', 'omega.json5');
        const source = `{ brand: { id: 'solo', name: 'Solo' }, targets: { backend: {} } }\n`;
        jetpack.write(appConfigPath, source);

        const staging = await stageResolvedConfig({ functionsPath });

        assert.equal(staging.staged, false);
        assert.equal(jetpack.read(appConfigPath), source, 'self-contained file untouched');
        await staging.restore(); // harmless no-op

        jetpack.remove(tmp);
      },
    },
  ],
};
