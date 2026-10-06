/**
 * Deploy staging — the two layers that make a functions upload self-contained.
 *
 * stage-functions (src/dist pillar): functions/ is GENERATED from the authored
 * target tree — src copy, derived manifest, composed brand⊕local config (#31), and
 * the target-root files that ride the artifact. Exercised on real temp trees.
 *
 * The local-package PACK is `@omega.js/devkit/pack-local` since
 * [#872](https://github.com/Omega-JS-Stack/omega/issues/872) (every deploy lane
 * packs the same way), and its algorithm cases live with it in
 * `packages/devkit/test/pack-local.test.js`. What stays here is the DEPLOY-level
 * contract: a staging failure exits the verb nonzero, naming the package it
 * could not stage, instead of printing an ✗ that reads like a success.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const jetpack = require('fs-jetpack');

const { stageFunctions } = require('../../dist/cli/utils/stage-functions.js');
const { loadConfig } = require('../helpers/_shared-config.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const BACKEND_BIN = path.resolve(__dirname, '../../bin/omega');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backend-stage-'));
}

module.exports = defineCases({
  description: 'Deploy staging: the functions upload is self-contained',
  type: 'group',
  timeout: 120000,

  tests: [
    {
      // The exit code IS the contract: the observed #331 run printed the ✗ and
      // read as a success. Spawn the real bin — nothing else pins an exit code.
      name: 'deploy-exits-nonzero-when-staging-fails',
      async run({ expect }) {
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
        jetpack.write(path.join(targetRoot, 'config', 'omega.json5'), '{ brand: { id: \'exit-code\', name: \'Exit Code\' }, targets: { backend: { type: "backend" } } }');
        jetpack.write(path.join(targetRoot, 'firebase.json'), JSON.stringify({ functions: { source: 'dist' } }, null, 2));
        jetpack.dir(path.join(tmp, 'brokenpkg'));

        // `--direct` IS the staging lane (#872): the bare verb dispatches CI now.
        const run = spawnSync(process.execPath, [BACKEND_BIN, 'deploy', '--direct'], {
          cwd: targetRoot,
          encoding: 'utf8',
          env: { ...process.env, OMEGA_SKIP_FRESHNESS: '1' },
        });

        expect(run.status, `a failed staging exits nonzero (got ${run.status})`).not.toBe(0);
        expect(/brokenpkg/.test(run.stdout + run.stderr), 'the failure names the package it could not stage').toBeTruthy();

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-carries-the-composed-config-across-the-upload-boundary',
      async run({ expect }) {
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
          targets: { backend: { type: 'backend', flavor: 'api' }, web: { type: 'web' } },
        }`);
        jetpack.write(path.join(targetRoot, 'package.json'), JSON.stringify({
          name: 'acme-backend',
          private: true,
          license: 'UNLICENSED',
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
        expect(jetpack.read(path.join(distDir, 'index.js'))).toBe('module.exports = 1;\n');
        expect(jetpack.read(path.join(distDir, 'routes', 'ping', 'get.js'))).toBe('module.exports = 2;\n');
        expect(jetpack.read(path.join(distDir, '.dotrc')), 'dotfiles in src/ are copied').toBe('dotfiles ride the copy\n');
        expect(jetpack.exists(path.join(distDir, 'stale-old-file.js')), 'previous stage wiped').toBe(false);

        // public/: consumer override wins, template default fills the gap
        expect(jetpack.read(path.join(distDir, 'public', '404.html')), 'src/public override wins').toBe('CONSUMER 404\n');
        expect(jetpack.exists(path.join(distDir, 'public', 'index.html')), 'template default fills the gap').toBeTruthy();
        expect(jetpack.exists(path.join(distDir, 'public', 'public')), 'src/public never double-nests').toBe(false);
        expect(jetpack.read(path.join(distDir, 'node_modules', 'marker.txt')), 'node_modules preserved').toBe('kept');
        expect(jetpack.read(path.join(distDir, 'emulator.log')), 'logs preserved').toBe('kept');
        expect(jetpack.read(path.join(distDir, '.env')), '.env rides the artifact').toBe('FAKE_KEY="value"\n');
        const manifest = jetpack.read(path.join(distDir, 'package.json'), 'json');
        expect(manifest.name).toBe('acme-backend-functions');
        expect(manifest.main).toBe('index.js');
        expect(manifest.engines.node).toBe('22');
        // #884: the target's license rides into the artifact, so the uploaded
        // package states the same thing the target does
        expect(manifest.license, "the target manifest's license carries into the staged one").toBe('UNLICENSED');
        expect(manifest.dependencies).toEqual({
          'firebase-admin': '^13.0.0',
          '@acme/lib': 'file:../../../libs/lib', // target-root-relative → dist-relative
        });
        expect(manifest.scripts, 'scripts never ship in the artifact').toBe(undefined);

        // Simulate the upload: the staged folder ALONE, no brand parent —
        // the real loader must resolve brand values, not defaults
        expect(jetpack.read(path.join(distDir, 'config', 'omega.json5')).startsWith('// Staged by `omega build`'), 'staged config carries the banner').toBeTruthy();
        const uploadDir = path.join(tmp, 'upload');
        jetpack.copy(distDir, uploadDir);
        const uploaded = loadConfig(uploadDir, 'backend', {
          defaults: { brand: { id: 'my-app', name: 'My Brand' } },
        });
        expect(uploaded.config.brand.name, 'brand layer crossed the boundary').toBe('Acme Corp');
        expect(uploaded.config.flavor, 'brand target section survived the flatten').toBe('api');
        expect(uploaded.enabled).toBe(true);

        // Re-stage after a brand edit: the staged config NEVER feeds back in
        // as a local layer (the wipe runs before the compose) — no staleness
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{
          brand: { id: 'acme', name: 'Acme Corp RENAMED', url: 'https://acme.test' },
          targets: { backend: { type: 'backend', flavor: 'api' }, web: { type: 'web' } },
        }`);
        stageFunctions({ projectDir: targetRoot });
        const restaged = loadConfig(distDir, 'backend');
        expect(restaged.config.brand.name, 'brand edit reflected on re-stage').toBe('Acme Corp RENAMED');

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-composes-the-artifact-for-ONE-environment',
      async run({ expect }) {
        const tmp = makeTmp();
        const targetRoot = path.join(tmp, 'targets', 'backend');

        jetpack.write(path.join(tmp, 'config', 'omega.json5'), `{
          brand: { id: 'acme', name: 'Acme Corp', url: 'https://acme.test' },
          targets: { backend: { type: 'backend' } },
        }`);
        jetpack.write(path.join(targetRoot, 'package.json'), JSON.stringify({ name: 'acme-backend', private: true }));
        jetpack.write(path.join(targetRoot, 'src', 'index.js'), 'module.exports = 1;\n');

        // The base .env is the live account; `.env.development` overlays the
        // test credential a local run uses (#586). dist/.env is COMPOSED from
        // the cascade by schema (#678): keys only, no marker comments — a
        // verbatim copy is the OLD contract.
        jetpack.write(path.join(targetRoot, '.env'), [
          'STRIPE_SECRET_KEY="sk_live_fixture"',
          'OMEGA_ADMIN_KEY="fixture-admin-key"',
          '',
        ].join('\n'));
        jetpack.write(path.join(targetRoot, '.env.development'), 'STRIPE_SECRET_KEY="sk_test_fixture"\n');

        // A LOCAL stage composes base + development — the emulator gets the
        // test credential and never touches the live account
        const local = stageFunctions({ projectDir: targetRoot, environment: 'development' });
        const localStaged = jetpack.read(path.join(local.distDir, '.env'));
        expect(/^STRIPE_SECRET_KEY="sk_test_fixture"$/m.test(localStaged), 'the development overlay wins locally').toBe(true);
        expect(/^OMEGA_ADMIN_KEY="fixture-admin-key"$/m.test(localStaged), 'keys no overlay touches come from the base').toBe(true);

        // The DEPLOY stage composes base + production. No `.env.production`
        // exists, so the base ships — and the development overlay's value never
        // rides the upload, neither as a row nor as a value
        const deploy = stageFunctions({ projectDir: targetRoot, environment: 'production' });
        const staged = jetpack.read(path.join(deploy.distDir, '.env'));

        expect(/^STRIPE_SECRET_KEY="sk_live_fixture"$/m.test(staged), 'the deployed artifact carries the live key').toBe(true);
        expect(staged.includes('sk_test_fixture'), "another environment's value never rides the upload").toBe(false);
        expect(/_DEV=/.test(staged), 'the _DEV twins are gone from the mechanism entirely (#586)').toBe(false);
        expect(/^OMEGA_ADMIN_KEY="fixture-admin-key"$/m.test(staged), 'unrelated keys are untouched').toBe(true);

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-requires-the-authored-tree',
      async run({ expect }) {
        const tmp = makeTmp();

        // The message a call throws, or '' when it returns, for the regex checks below.
        const messageOf = (fn) => {
          try { fn(); return ''; } catch (e) { return e.message; }
        };

        // No package.json at the target root → the manifest moved (clear error)
        jetpack.write(path.join(tmp, 'src', 'index.js'), '// code');
        expect(/manifest lives at the TARGET ROOT/.test(messageOf(() => stageFunctions({ projectDir: tmp }))), 'missing manifest names the target-root home').toBeTruthy();

        // Manifest but no src/ → instruct the src-first move
        jetpack.write(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', private: true }));
        jetpack.remove(path.join(tmp, 'src'));
        expect(/backend targets are src-first/.test(messageOf(() => stageFunctions({ projectDir: tmp }))), 'missing src/ instructs the src-first move').toBeTruthy();

        jetpack.remove(tmp);
      },
    },

    {
      name: 'stage-functions-refuses-the-framework-package-itself',
      async run({ expect }) {
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

        expect(/@omega\.js\/backend framework package/.test(message), `refusal names the framework package: ${message}`).toBeTruthy();
        expect(/npm run prepare/.test(message), 'refusal names how the framework dist/ is built').toBeTruthy();
        expect(jetpack.read(path.join(tmp, 'dist', 'index.js')), 'refusal lands BEFORE the wipe — the prepared dist/ survives').toBe('// prepared output');

        jetpack.remove(tmp);
      },
    },
  ],
});
