/**
 * Deploy staging — the two layers that make a functions upload self-contained.
 *
 * stage-functions (src/dist pillar): functions/ is GENERATED from the authored
 * target tree — src copy, derived manifest, composed brand⊕local config (#31), and
 * the target-root files that ride the artifact. Exercised on real temp trees.
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
const { spawnSync } = require('child_process');
const jetpack = require('fs-jetpack');

const stageLocalPackages = require('../../dist/cli/utils/stage-local-packages.js');
const { stageFunctions } = require('../../dist/cli/utils/stage-functions.js');
const { loadConfig } = require('../helpers/_shared-config.js');

const BACKEND_BIN = path.resolve(__dirname, '../../bin/omega-backend');

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
        jetpack.write(path.join(functionsPath, 'package.json'), `${JSON.stringify({
          name: 'test-functions',
          version: '0.0.1',
          private: true,
          dependencies: { '@omega.js/fakepkg': 'file:../fakepkg' },
        }, null, 2)}\n`);

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
      // #331: the lane packed only the framework package itself. @omega.js/client
      // is a REAL runtime dependency of @omega.js/backend (never vendored) and is
      // unpublished under the publish latch — so regenerating the lock against the
      // staged shape asked the REGISTRY for it and 404'd, and no deploy ran.
      name: 'packs-linked-omega-deps-transitively-so-the-lock-never-asks-the-registry',
      async run({ assert }) {
        const tmp = makeTmp();

        // A local @omega.js package that exists NOWHERE but this disk — the
        // registry-404 shape (client under the publish latch)
        const depDir = path.join(tmp, 'workspace', 'faketransitive');
        jetpack.write(path.join(depDir, 'package.json'), JSON.stringify({
          name: '@omega.js/faketransitive',
          version: '0.1.0',
          private: true,
          main: 'index.js',
        }, null, 2));
        jetpack.write(path.join(depDir, 'index.js'), 'module.exports = 1;\n');

        // The framework package: declares it by REGISTRY spec (that is how
        // @omega.js/backend spells @omega.js/client) and resolves it through a
        // node_modules SYMLINK — the local-era shape npm workspaces / `mgr i local` make
        const pkgDir = path.join(tmp, 'fakeframework');
        jetpack.write(path.join(pkgDir, 'package.json'), JSON.stringify({
          name: '@omega.js/fakeframework',
          version: '1.0.0',
          private: true,
          main: 'index.js',
          dependencies: { '@omega.js/faketransitive': '^0.1.0' },
        }, null, 2));
        jetpack.write(path.join(pkgDir, 'index.js'), 'module.exports = 2;\n');
        jetpack.dir(path.join(pkgDir, 'node_modules', '@omega.js'));
        fs.symlinkSync(depDir, path.join(pkgDir, 'node_modules', '@omega.js', 'faketransitive'), 'dir');

        const functionsPath = path.join(tmp, 'functions');
        jetpack.write(path.join(functionsPath, 'package.json'), `${JSON.stringify({
          name: 'test-functions',
          version: '0.0.1',
          private: true,
          dependencies: { '@omega.js/fakeframework': 'file:../fakeframework' },
        }, null, 2)}\n`);

        const staging = await stageLocalPackages({ functionsPath });

        // BOTH packages ride the upload — the linked one too
        assert.deepEqual(staging.staged, ['@omega.js/fakeframework', '@omega.js/faketransitive']);
        assert.equal(jetpack.exists(path.join(functionsPath, 'omega_modules', 'omega.js-fakeframework-1.0.0.tgz')), 'file');
        assert.equal(jetpack.exists(path.join(functionsPath, 'omega_modules', 'omega.js-faketransitive-0.1.0.tgz')), 'file');

        // The framework tarball still declares `^0.1.0` internally — only an
        // override redirects that NESTED resolution to the packed artifact
        const stagedPkg = jetpack.read(path.join(functionsPath, 'package.json'), 'json');
        assert.equal(stagedPkg.dependencies['@omega.js/fakeframework'], 'file:omega_modules/omega.js-fakeframework-1.0.0.tgz');
        assert.equal(stagedPkg.overrides['@omega.js/faketransitive'], 'file:omega_modules/omega.js-faketransitive-0.1.0.tgz');

        // The lock npm ci will read: resolved from the tarball, never the registry
        const lock = jetpack.read(path.join(functionsPath, 'package-lock.json'), 'json');
        const locked = lock.packages['node_modules/@omega.js/faketransitive'];
        assert.ok(locked, 'the linked dependency is in the lockfile');
        assert.equal(locked.resolved, 'file:omega_modules/omega.js-faketransitive-0.1.0.tgz');

        // Restore: the override is staging-only, gone with everything else
        await staging.restore();
        const restored = jetpack.read(path.join(functionsPath, 'package.json'), 'json');
        assert.equal(restored.dependencies['@omega.js/fakeframework'], 'file:../fakeframework');
        assert.equal(restored.overrides, undefined, 'staging overrides never survive the restore');
        assert.equal(jetpack.exists(path.join(functionsPath, 'omega_modules')), false, 'staging dir removed');

        jetpack.remove(tmp);
      },
    },

    {
      // #331's second half: a failed staging must stop the deploy loudly — throw
      // (never a swallowed ✗), and leave the functions folder exactly as found.
      name: 'staging-failure-throws-and-restores-the-functions-folder',
      async run({ assert }) {
        const tmp = makeTmp();

        const pkgDir = path.join(tmp, 'fakepkg');
        jetpack.write(path.join(pkgDir, 'package.json'), JSON.stringify({
          name: '@omega.js/fakepkg',
          version: '1.0.0',
          private: true,
          main: 'index.js',
        }, null, 2));
        jetpack.write(path.join(pkgDir, 'index.js'), 'module.exports = 1;\n');

        // The pack succeeds, then the LOCK REGEN fails (a file: spec pointing at
        // a tarball that does not exist) — the failure lands AFTER the manifest
        // was respelled on disk, which is exactly where the 404 landed
        const functionsPath = path.join(tmp, 'functions');
        const original = `${JSON.stringify({
          name: 'test-functions',
          version: '0.0.1',
          private: true,
          dependencies: {
            '@omega.js/fakepkg': 'file:../fakepkg',
            'never-here': 'file:missing-tarball.tgz',
          },
        }, null, 2)}\n`;
        jetpack.write(path.join(functionsPath, 'package.json'), original);

        let message = '';
        try {
          await stageLocalPackages({ functionsPath });
        } catch (e) {
          message = e.message;
        }

        assert.ok(message, 'a failing staging step throws — the deploy stops');
        assert.ok(/staging failed/i.test(message), `the error names the staging lane: ${message}`);
        assert.equal(jetpack.read(path.join(functionsPath, 'package.json')), original, 'manifest restored verbatim');
        assert.equal(jetpack.exists(path.join(functionsPath, 'omega_modules')), false, 'no half-staged tarballs left behind');
        assert.equal(jetpack.exists(path.join(functionsPath, 'package-lock.json')), false, 'no half-written lockfile left behind');

        jetpack.remove(tmp);
      },
    },

    {
      // The exit code IS the contract: the observed #331 run printed the ✗ and
      // read as a success. Spawn the real bin — nothing else pins an exit code.
      name: 'deploy-exits-nonzero-when-staging-fails',
      async run({ assert }) {
        const tmp = makeTmp();

        const targetRoot = path.join(tmp, 'app');
        jetpack.write(path.join(targetRoot, 'package.json'), JSON.stringify({
          name: 'exit-code-backend',
          version: '0.0.1',
          private: true,
          engines: { node: '22' },
          // A local dep whose directory carries no package.json — staging fails
          // before npm is ever reached, so the exit code is all this measures
          dependencies: { '@omega.js/brokenpkg': 'file:../brokenpkg' },
        }, null, 2));
        jetpack.write(path.join(targetRoot, 'src', 'index.js'), 'module.exports = 1;\n');
        jetpack.write(path.join(targetRoot, 'config', 'omega.json5'), '{ brand: { id: \'exit-code\', name: \'Exit Code\' }, targets: { backend: {} } }');
        jetpack.write(path.join(targetRoot, 'firebase.json'), JSON.stringify({ functions: { source: 'dist' } }, null, 2));
        jetpack.dir(path.join(tmp, 'brokenpkg'));

        const run = spawnSync(process.execPath, [BACKEND_BIN, 'deploy'], {
          cwd: targetRoot,
          encoding: 'utf8',
          env: { ...process.env, OMEGA_SKIP_FRESHNESS: '1' },
        });

        assert.notEqual(run.status, 0, `a failed staging exits nonzero (got ${run.status})`);
        assert.ok(/brokenpkg/.test(run.stdout + run.stderr), 'the failure names the package it could not stage');

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-carries-the-composed-config-across-the-upload-boundary',
      async run({ assert }) {
        const tmp = makeTmp();

        // Brand monorepo shape under the src/dist pillar: authored target tree
        // (src/ + target-root manifest), NO local omega.json5 — the brand file's
        // targets section is the per-target home (cp121c), and the STAGE step
        // must carry the composed config across the upload boundary (#31).
        const brandRoot = path.join(tmp, 'acme');
        const targetRoot = path.join(brandRoot, 'targets', 'backend');
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{
          // brand layer — must cross the upload boundary
          brand: { id: 'acme', name: 'Acme Corp', url: 'https://acme.test' },
          targets: { backend: { flavor: 'api' }, web: {} },
        }`);
        jetpack.write(path.join(targetRoot, 'package.json'), JSON.stringify({
          name: 'acme-backend',
          private: true,
          engines: { node: '22' },
          // The relative file: dep is spelled from the TARGET ROOT — the staged
          // manifest must respell it one level deeper (dist/)
          dependencies: { 'firebase-admin': '^13.0.0', '@acme/lib': 'file:../../libs/lib' },
        }, null, 2));
        jetpack.write(path.join(targetRoot, 'src', 'index.js'), 'module.exports = 1;\n');
        jetpack.write(path.join(targetRoot, 'src', 'routes', 'ping', 'get.js'), 'module.exports = 2;\n');
        jetpack.write(path.join(targetRoot, 'src', '.dotrc'), 'dotfiles ride the copy\n');
        jetpack.write(path.join(targetRoot, 'src', 'public', '404.html'), 'CONSUMER 404\n');
        jetpack.write(path.join(targetRoot, '.env'), 'FAKE_KEY="value"\n');
        // Runtime artifacts that must SURVIVE a re-stage
        jetpack.write(path.join(targetRoot, 'dist', 'node_modules', 'marker.txt'), 'kept');
        jetpack.write(path.join(targetRoot, 'dist', 'emulator.log'), 'kept');
        jetpack.write(path.join(targetRoot, 'dist', 'stale-old-file.js'), 'wiped');

        const { distDir } = stageFunctions({ projectDir: targetRoot });

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
          '@acme/lib': 'file:../../../libs/lib', // target-root-relative → dist-relative
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
        // as a local layer (the wipe runs before the compose) — no staleness
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{
          brand: { id: 'acme', name: 'Acme Corp RENAMED', url: 'https://acme.test' },
          targets: { backend: { flavor: 'api' }, web: {} },
        }`);
        stageFunctions({ projectDir: targetRoot });
        const restaged = loadConfig(distDir, 'backend');
        assert.equal(restaged.config.brand.name, 'Acme Corp RENAMED', 'brand edit reflected on re-stage');

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-strips-dev-only-keys-from-the-deploy-artifact',
      async run({ assert }) {
        const tmp = makeTmp();
        const targetRoot = path.join(tmp, 'targets', 'backend');

        jetpack.write(path.join(tmp, 'config', 'omega.json5'), `{
          brand: { id: 'acme', name: 'Acme Corp', url: 'https://acme.test' },
          targets: { backend: {} },
        }`);
        jetpack.write(path.join(targetRoot, 'package.json'), JSON.stringify({ name: 'acme-backend', private: true }));
        jetpack.write(path.join(targetRoot, 'src', 'index.js'), 'module.exports = 1;\n');

        // The .env disperse composes: the live payment secrets AND their dev
        // twins, which the local emulator reads and no deploy may ever upload
        const authored = [
          '# ========== Default Values ==========',
          'STRIPE_SECRET_KEY="sk_live_fixture"',
          'STRIPE_SECRET_KEY_DEV="sk_test_fixture"',
          '# STRIPE_WEBHOOK_SECRET_DEV=',
          'CHARGEBEE_API_KEY_DEV="test_fixture"',
          'OMEGA_ADMIN_KEY="fixture-admin-key"',
          '',
        ].join('\n');
        jetpack.write(path.join(targetRoot, '.env'), authored);

        // A LOCAL stage carries the file verbatim — the emulator needs the twins
        const local = stageFunctions({ projectDir: targetRoot });
        assert.equal(jetpack.read(path.join(local.distDir, '.env')), authored, 'a local stage is a verbatim copy');

        // The DEPLOY stage drops every dev-only row and nothing else
        const deploy = stageFunctions({ projectDir: targetRoot, deploy: true });
        const staged = jetpack.read(path.join(deploy.distDir, '.env'));

        assert.equal(/^STRIPE_SECRET_KEY_DEV=/m.test(staged), false, 'the Stripe dev twin never rides the artifact');
        assert.equal(/^CHARGEBEE_API_KEY_DEV=/m.test(staged), false, 'the Chargebee dev twin never rides the artifact');
        assert.equal(/^STRIPE_SECRET_KEY="sk_live_fixture"$/m.test(staged), true, 'the live key still rides it');
        assert.equal(/^OMEGA_ADMIN_KEY="fixture-admin-key"$/m.test(staged), true, 'unrelated keys are untouched');
        assert.equal(staged.includes('# ========== Default Values =========='), true, 'the section markers survive');
        assert.equal(staged.includes('sk_test_fixture'), false, 'no dev VALUE survives either');

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

        // No package.json at the target root → the manifest moved (clear error)
        jetpack.write(path.join(tmp, 'src', 'index.js'), '// code');
        assert.ok(/manifest lives at the TARGET ROOT/.test(messageOf(() => stageFunctions({ projectDir: tmp }))), 'missing manifest names the target-root home');

        // Manifest but no src/ → instruct the src-first move
        jetpack.write(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', private: true }));
        jetpack.remove(path.join(tmp, 'src'));
        assert.ok(/backend targets are src-first/.test(messageOf(() => stageFunctions({ projectDir: tmp }))), 'missing src/ instructs the src-first move');

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-refuses-the-framework-package-itself',
      async run({ assert }) {
        const tmp = makeTmp();

        // The framework package's own shape: a package.json named
        // @omega.js/backend beside a src/ dir — which is exactly what a target
        // root looks like to the stage. `npx omega emulator` from inside the
        // framework (no target context to dispatch to) walked straight in, wiped
        // the framework's OWN dist/ and then died on the missing omega.json5,
        // leaving the CLI unbootable until `npm run prepare` (#308).
        jetpack.write(path.join(tmp, 'package.json'), JSON.stringify({ name: '@omega.js/backend', private: true }));
        jetpack.write(path.join(tmp, 'src', 'index.js'), '// framework source');
        jetpack.write(path.join(tmp, 'dist', 'index.js'), '// prepared output');

        const messageOf = (fn) => {
          try { fn(); return ''; } catch (e) { return e.message; }
        };
        const message = messageOf(() => stageFunctions({ projectDir: tmp }));

        assert.ok(/@omega\.js\/backend framework package/.test(message), `refusal names the framework package: ${message}`);
        assert.ok(/npm run prepare/.test(message), 'refusal names how the framework dist/ is built');
        assert.equal(jetpack.read(path.join(tmp, 'dist', 'index.js')), '// prepared output', 'refusal lands BEFORE the wipe — the prepared dist/ survives');

        jetpack.remove(tmp);
      },
    },
  ],
};
