/**
 * Deploy staging — the two layers that make a functions upload self-contained.
 *
 * stage-functions (src/dist pillar): functions/ is GENERATED from the authored
 * app tree — src copy, derived manifest, composed brand⊕app config (#31), and
 * the app-root files that ride the artifact. Exercised on real temp trees.
 *
 * stage-local-packages: Cloud Build can't follow file: paths outside the
 * functions folder, and its buildpack runs `npm ci` (lockfile required) — such
 * deps pack into functions/omega_modules/, package.json respells, the lockfile
 * regenerates, and everything restores afterward. Exercised against REAL npm
 * on a throwaway package — no mocks.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');

const stageLocalPackages = require('../../dist/cli/utils/stage-local-packages.js');
const { stageFunctions } = require('../../dist/cli/utils/stage-functions.js');
const { loadConfig } = require('../helpers/_shared-config.js');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backend-stage-'));
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
      name: 'stage-functions-carries-the-composed-config-across-the-upload-boundary',
      async run({ assert }) {
        const tmp = makeTmp();

        // Brand monorepo shape under the src/dist pillar: authored app tree
        // (src/ + app-root manifest), NO app omega.json5 — the brand file's
        // targets section is the per-target home (cp121c), and the STAGE step
        // must carry the composed config across the upload boundary (#31).
        const brandRoot = path.join(tmp, 'acme');
        const appRoot = path.join(brandRoot, 'apps', 'backend');
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{
          // brand layer — must cross the upload boundary
          brand: { id: 'acme', name: 'Acme Corp', url: 'https://acme.test' },
          targets: { backend: { flavor: 'api' }, web: {} },
        }`);
        jetpack.write(path.join(appRoot, 'package.json'), JSON.stringify({
          name: 'acme-backend',
          private: true,
          engines: { node: '22' },
          // The relative file: dep is spelled from the APP ROOT — the staged
          // manifest must respell it one level deeper (dist/)
          dependencies: { 'firebase-admin': '^13.0.0', '@acme/lib': 'file:../../libs/lib' },
        }, null, 2));
        jetpack.write(path.join(appRoot, 'src', 'index.js'), 'module.exports = 1;\n');
        jetpack.write(path.join(appRoot, 'src', 'routes', 'ping', 'get.js'), 'module.exports = 2;\n');
        jetpack.write(path.join(appRoot, 'src', '.dotrc'), 'dotfiles ride the copy\n');
        jetpack.write(path.join(appRoot, 'src', 'public', '404.html'), 'CONSUMER 404\n');
        jetpack.write(path.join(appRoot, '.env'), 'FAKE_KEY="value"\n');
        // Runtime artifacts that must SURVIVE a re-stage
        jetpack.write(path.join(appRoot, 'dist', 'node_modules', 'marker.txt'), 'kept');
        jetpack.write(path.join(appRoot, 'dist', 'emulator.log'), 'kept');
        jetpack.write(path.join(appRoot, 'dist', 'stale-old-file.js'), 'wiped');

        const { distDir } = stageFunctions({ projectDir: appRoot });

        // src copied, derived manifest, stale content wiped, artifacts preserved
        assert.equal(jetpack.read(path.join(distDir, 'index.js')), 'module.exports = 1;\n');
        assert.equal(jetpack.read(path.join(distDir, 'routes', 'ping', 'get.js')), 'module.exports = 2;\n');
        assert.equal(jetpack.read(path.join(distDir, '.dotrc')), 'dotfiles ride the copy\n', 'dotfiles in src/ are copied');
        assert.equal(jetpack.exists(path.join(distDir, 'stale-old-file.js')), false, 'previous stage wiped');

        // public/: consumer override wins, template default fills the gap
        assert.equal(jetpack.read(path.join(distDir, 'public', '404.html')), 'CONSUMER 404\n', 'src/public override wins');
        assert.ok(jetpack.exists(path.join(distDir, 'public', 'index.html')), 'template default fills the gap');
        assert.equal(jetpack.exists(path.join(distDir, 'public', 'public')), false, 'src/public never double-nests');
        assert.equal(jetpack.read(path.join(distDir, 'node_modules', 'marker.txt')), 'kept', 'node_modules preserved');
        assert.equal(jetpack.read(path.join(distDir, 'emulator.log')), 'kept', 'logs preserved');
        assert.equal(jetpack.read(path.join(distDir, '.env')), 'FAKE_KEY="value"\n', '.env rides the artifact');
        const manifest = jetpack.read(path.join(distDir, 'package.json'), 'json');
        assert.equal(manifest.name, 'acme-backend-functions');
        assert.equal(manifest.main, 'index.js');
        assert.equal(manifest.engines.node, '22');
        assert.deepEqual(manifest.dependencies, {
          'firebase-admin': '^13.0.0',
          '@acme/lib': 'file:../../../libs/lib', // app-root-relative → dist-relative
        });
        assert.equal(manifest.scripts, undefined, 'scripts never ship in the artifact');

        // Simulate the upload: the staged folder ALONE, no brand parent —
        // the real loader must resolve brand values, not defaults
        assert.ok(jetpack.read(path.join(distDir, 'config', 'omega.json5')).startsWith('// Staged by `omega build`'), 'staged config carries the banner');
        const uploadDir = path.join(tmp, 'upload');
        jetpack.copy(distDir, uploadDir);
        const uploaded = loadConfig(uploadDir, 'backend', {
          defaults: { brand: { id: 'my-app', name: 'My Brand' } },
        });
        assert.equal(uploaded.config.brand.name, 'Acme Corp', 'brand layer crossed the boundary');
        assert.equal(uploaded.config.flavor, 'api', 'brand target section survived the flatten');
        assert.equal(uploaded.enabled, true);

        // Re-stage after a brand edit: the staged config NEVER feeds back in
        // as an app layer (the wipe runs before the compose) — no staleness
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{
          brand: { id: 'acme', name: 'Acme Corp RENAMED', url: 'https://acme.test' },
          targets: { backend: { flavor: 'api' }, web: {} },
        }`);
        stageFunctions({ projectDir: appRoot });
        const restaged = loadConfig(distDir, 'backend');
        assert.equal(restaged.config.brand.name, 'Acme Corp RENAMED', 'brand edit reflected on re-stage');

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-requires-the-authored-tree',
      async run({ assert }) {
        const tmp = makeTmp();

        // (The runner's assert has no .throws — capture manually.)
        const messageOf = (fn) => {
          try { fn(); return ''; } catch (e) { return e.message; }
        };

        // No package.json at the app root → the manifest moved (clear error)
        jetpack.write(path.join(tmp, 'src', 'index.js'), '// code');
        assert.ok(/manifest lives at the APP ROOT/.test(messageOf(() => stageFunctions({ projectDir: tmp }))), 'missing manifest names the app-root home');

        // Manifest but no src/ → instruct the src-first move
        jetpack.write(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', private: true }));
        jetpack.remove(path.join(tmp, 'src'));
        assert.ok(/backend apps are src-first/.test(messageOf(() => stageFunctions({ projectDir: tmp }))), 'missing src/ instructs the src-first move');

        jetpack.remove(tmp);
      },
    },
  ],
};
