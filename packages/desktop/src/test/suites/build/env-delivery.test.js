// The env schema is the ONE declaration of how a key reaches the desktop app
// ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)): the build
// workflow's env block, the bundle task's bake, and `omega push-secrets` all read
// `delivery: { desktop: … }` and nothing else. Each used to carry its own
// hand-kept list — the workflow's was 21 lines a human maintained across four
// job/step blocks, and a key added to one never reached the others.
//
// Offline by construction: ensureTarget scaffolds into a temp consumer whose
// peer deps are already satisfied (nothing installs), and the composed env
// comes from files in a temp brand.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const { publishSecretKeys, bakeKeys, renderSecretsBlock, WORKFLOW_OWNED_KEYS } = require('@omega.js/config/env-delivery');

const SRC = path.join(__dirname, '..', '..', '..');
const Manager = require(path.join(SRC, 'build.js'));
const { ensureTarget } = require(path.join(SRC, 'commands', 'lib', 'ensure-target.js'));
const bundleTask = require(path.join(SRC, 'gulp', 'tasks', 'bundle.js'));
const pushSecrets = require(path.join(SRC, 'commands', 'push-secrets.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

const package = Manager.getPackage('main');

/** A consumer whose peer deps are already satisfied — the steady state. */
function stageConsumer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-env-delivery-'));
  const devDependencies = { [package.name]: `^${package.version}` };
  for (const [name, ver] of Object.entries(package.peerDependencies || {})) {
    devDependencies[name] = ver;
  }
  jetpack.write(path.join(tmp, 'package.json'), `${JSON.stringify({ name: 'staged-app', version: '1.0.0', devDependencies }, null, 2)}\n`);
  return tmp;
}

/** A brand root with a targets/desktop target under it. */
function tmpBrand(brandEnv) {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-brand-'));
  jetpack.write(path.join(brand, 'config', 'omega.json5'), '{ brand: { id: "b" } }');
  if (brandEnv !== undefined) fs.writeFileSync(path.join(brand, '.env'), brandEnv);

  const target = path.join(brand, 'targets', 'desktop');
  fs.mkdirSync(target, { recursive: true });

  return { brand, target };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'env delivery (#627) — the workflow block, the bake list, and push-secrets from ONE schema',
  tests: [
    {
      name: 'the build workflow renders the schema block — every CI key, no hand list, no token left',
      run: async (ctx) => {
        const tmp = stageConsumer();

        try {
          await ensureTarget({ projectDir: tmp });
          const workflow = jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml'));

          ctx.expect(workflow.includes('{{ githubSecrets }}')).toBe(false);
          ctx.expect(workflow).toContain(`  ${renderSecretsBlock('desktop', { indent: '  ' })}\n`);

          for (const key of publishSecretKeys('desktop').filter((k) => !WORKFLOW_OWNED_KEYS.includes(k))) {
            // Once each: the workflow-level env is the ONE place a secret is
            // named, so a job or step never restates one.
            ctx.expect(workflow.split(`${key}: \${{ secrets.${key} }}`).length - 1).toBe(1);
          }

          // The two DELIBERATE step-level overrides survive: the mac signing
          // assets are decoded to files, so those two names are paths there,
          // not the base64 secrets the workflow env carries.
          ctx.expect(workflow).toContain('CSC_LINK:         config/certs/dev-id.p12');
          ctx.expect(workflow).toContain('APPLE_API_KEY:    config/certs/AuthKey.p8');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the bundle bake is exactly the schema\'s bake list, valued from the build env',
      run: (ctx) => {
        ctx.expect(bundleTask.BAKED_KEYS).toEqual(bakeKeys('desktop'));
        ctx.expect(bundleTask.BAKED_KEYS).toEqual(['GOOGLE_ANALYTICS_SECRET']);

        // A key with a value is replaced in the bundle; an unset one leaves the
        // `process.env` reference intact, so local dev still reads it live.
        ctx.expect(bundleTask.bakeDefinitions({ GOOGLE_ANALYTICS_SECRET: 'fixture-mp-secret' }))
          .toEqual({ 'process.env.GOOGLE_ANALYTICS_SECRET': '"fixture-mp-secret"' });
        ctx.expect(bundleTask.bakeDefinitions({})).toEqual({});

        // A key the schema does NOT bake never reaches a shipped artifact.
        ctx.expect(bundleTask.bakeDefinitions({ CSC_KEY_PASSWORD: 'nope' })).toEqual({});
      },
    },
    {
      name: 'the bake REFUSES a configured stream with no secret in build mode, warns in development (#626)',
      run: (ctx) => {
        // A packaged app ships no `.env` and a CI runner has none either, so a
        // GA4 stream id with no Measurement Protocol secret used to bundle no
        // replacement at all and ship an app that sent no events, silently.
        const configured = { analytics: { providers: { google: { id: 'G-FIXTURE' } } } };
        const quiet = { log() {}, warn() {}, error() {} };
        let thrown = null;
        try {
          bundleTask.bakeDefinitions({}, { config: configured, mode: { build: true }, logger: quiet });
        } catch (e) {
          thrown = e;
        }

        ctx.expect(thrown === null).toBe(false);
        // The BRAND-level key a human sets, and the config path that owes it.
        ctx.expect(thrown.message).toContain('GOOGLE_ANALYTICS_SECRET_DESKTOP');
        ctx.expect(thrown.message).toContain('analytics.providers.google.id');

        // A publish run is a build for this purpose.
        let onPublish = null;
        try {
          bundleTask.bakeDefinitions({}, { config: configured, mode: { publish: true }, logger: quiet });
        } catch (e) {
          onPublish = e;
        }
        ctx.expect(onPublish === null).toBe(false);

        // Development warns and keeps going — a half-configured brand is a
        // normal step on the way to a configured one.
        const said = [];
        const loud = { log() {}, warn: (m) => said.push(m), error() {} };
        ctx.expect(bundleTask.bakeDefinitions({}, { config: configured, mode: { build: false, publish: false }, logger: loud })).toEqual({});
        ctx.expect(said.join('\n')).toContain('GOOGLE_ANALYTICS_SECRET_DESKTOP');

        // The secret under its DELIVERED name settles the rule and bakes.
        ctx.expect(bundleTask.bakeDefinitions({ GOOGLE_ANALYTICS_SECRET: 'shh' }, { config: configured, mode: { build: true }, logger: quiet }))
          .toEqual({ 'process.env.GOOGLE_ANALYTICS_SECRET': '"shh"' });

        // No stream configured, nothing owed.
        ctx.expect(bundleTask.bakeDefinitions({}, { config: {}, mode: { build: true }, logger: quiet })).toEqual({});
      },
    },
    {
      name: 'push-secrets pushes the schema DELIVERY set — a key CI never reads stays home',
      run: (ctx) => {
        const { brand, target } = tmpBrand([
          'GH_TOKEN=brand-token',
          'APPLE_TEAM_ID=BRANDTEAM',
          'GOOGLE_ANALYTICS_SECRET_DESKTOP=desktop-stream',
          'OMEGA_ADMIN_KEY=backend-only',
          'MY_CUSTOM_THING=custom',
          '',
        ].join('\n'));

        try {
          const keys = Object.keys(pushSecrets.collectEnvSecrets(target));
          ctx.expect(keys.sort()).toEqual(['APPLE_TEAM_ID', 'GH_TOKEN', 'GOOGLE_ANALYTICS_SECRET']);
          ctx.expect(keys.every((key) => publishSecretKeys('desktop').includes(key))).toBe(true);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },
  ],
});
