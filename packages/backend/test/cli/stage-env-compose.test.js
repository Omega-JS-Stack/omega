/**
 * Test: `dist/.env` is COMPOSED from the env cascade on every stage
 * ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
 *
 * The brand root's .env is the one file humans and the manager edit; the
 * target's own .env is an optional per-key override. Before this, the stage
 * copied the target .env verbatim and only a `manage` run pushed brand keys
 * into it — so two Google keys added to the playground root .env never
 * reached the deployed artifact.
 *
 * Also pinned here: the watcher's env inputs (the brand-root and company .env
 * paths). The watch itself is fs.watch on real directories — this asserts the
 * PATH RESOLUTION it wires up, which is the part that can silently be wrong.
 *
 * Run: npx omega test backend:cli/stage-env-compose
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const { stageFunctions, envWatchInputs, watchAndStage } = require('../../dist/cli/utils/stage-functions.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/**
 * A backend target inside a brand monorepo, with a company root above it:
 * <root>/company/.env, <root>/brand/.env, <root>/brand/targets/backend/.
 */
function seedBrand({ companyEnv, brandEnv, brandEnvOverlays, targetEnv }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-stage-env-')));
  const companyRoot = path.join(root, 'company');
  const brandRoot = path.join(root, 'brand');
  const targetDir = path.join(brandRoot, 'targets', 'backend');

  jetpack.write(path.join(companyRoot, '.env'), companyEnv || '');
  jetpack.write(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));
  jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    targets: { backend: {} },
  }));

  jetpack.write(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }));
  jetpack.write(path.join(targetDir, 'src', 'index.js'), '// fixture backend entry\n');
  if (brandEnv !== undefined) jetpack.write(path.join(brandRoot, '.env'), brandEnv);
  for (const [environment, contents] of Object.entries(brandEnvOverlays || {})) {
    jetpack.write(path.join(brandRoot, `.env.${environment}`), contents);
  }
  if (targetEnv !== undefined) jetpack.write(path.join(targetDir, '.env'), targetEnv);

  return { root, brandRoot, companyRoot, targetDir };
}

/** The staged dist/.env, parsed. */
function stagedEnv(targetDir, options) {
  stageFunctions({ projectDir: targetDir, ...options });
  return require('dotenv').parse(jetpack.read(path.join(targetDir, 'dist', '.env')) || '');
}

/** One key out of the dist/.env sitting on disk right now (no re-stage). */
function stagedValue(targetDir, key) {
  return require('dotenv').parse(jetpack.read(path.join(targetDir, 'dist', '.env')) || '')[key];
}

/** Poll the staged dist/.env until `key` reads `value` (the watcher's re-stage), or give up. */
async function waitForStaged(targetDir, key, value, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (stagedValue(targetDir, key) === value) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return false;
}

module.exports = defineCases({
  description: 'Stage composes dist/.env from the cascade (brand root ← target override)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-brand-root-key-the-schema-names-reaches-dist-env',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          companyEnv: 'ANTHROPIC_API_KEY="company-anthropic"\n',
          brandEnv: 'GH_TOKEN="brand-gh"\nCONNECTIONS_GOOGLE_CLIENT_ID="brand-oauth-id"\nRECAPTCHA_SITE_KEY="brand-site-key"\nGOOGLE_ANALYTICS_SECRET_BACKEND="brand-stream"\n',
        });

        try {
          const env = stagedEnv(targetDir);

          assert.equal(env.GH_TOKEN, 'brand-gh', 'a brand-root key the backend schema names must reach the artifact');
          assert.equal(env.CONNECTIONS_GOOGLE_CLIENT_ID, 'brand-oauth-id', 'the connections pattern family composes too (#678)');
          assert.equal(env.ANTHROPIC_API_KEY, 'company-anthropic', 'the company layer fills the gaps');
          assert.equal(env.GOOGLE_ANALYTICS_SECRET, 'brand-stream', "the backend's own GA4 stream secret arrives renamed");
          assert.equal(env.RECAPTCHA_SITE_KEY, undefined, 'a key the schema names for web only never joins the functions upload');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-license-key-rides-the-deploy-process-never-the-upload',
      auth: 'none',

      // #320 + #872: the backend deploy runs on a runner now, so the license
      // key is delivered to this target (`ci`) and the composer resolves it,
      // which is how the precheck publishes it as the repo secret the workflow
      // injects. The ARTIFACT is the narrower half: a functions upload carrying
      // the brand's license key is the one thing #320 forbids.
      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'OMEGA_LICENSE_KEY="omg_live_brand"\nOMEGA_ADMIN_KEY="brand-admin"\n',
        });

        try {
          const env = stagedEnv(targetDir, { environment: 'production', licenseStatus: 'licensed' });

          assert.equal(env.OMEGA_LICENSE_KEY, undefined, 'a runner-only key never lands in the .env the upload ships with');
          assert.equal(env.OMEGA_LICENSE_STATUS, 'licensed', 'the VERDICT is what the artifact carries');
          assert.equal(env.OMEGA_ADMIN_KEY, 'brand-admin', 'every `env` delivery still composes');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-target-env-wins-per-key',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\nOPENAI_API_KEY="brand-openai"\n',
          targetEnv: 'GH_TOKEN="target-gh"\nSOME_BESPOKE_KEY="target-only"\n',
        });

        try {
          const env = stagedEnv(targetDir);

          assert.equal(env.GH_TOKEN, 'target-gh', "the target's own .env is the per-key override");
          assert.equal(env.OPENAI_API_KEY, 'brand-openai', 'keys it does not override still come from the brand root');
          assert.equal(env.SOME_BESPOKE_KEY, 'target-only', 'a key the schema does not know passes through from the target layer');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'each-lane-stages-its-own-environment-overlay',
      auth: 'none',

      // #586: one key, one flat artifact — a deploy composes base + production,
      // the emulator base + development, a test lane base + testing. No other
      // environment's file ever rides along.
      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'STRIPE_SECRET_KEY="sk_live_base"\nGH_TOKEN="brand-gh"\n',
          brandEnvOverlays: {
            development: 'STRIPE_SECRET_KEY="sk_test_dev"\n',
            testing: 'STRIPE_SECRET_KEY="sk_test_lane"\n',
          },
        });

        try {
          const local = stagedEnv(targetDir, { environment: 'development' });
          assert.equal(local.STRIPE_SECRET_KEY, 'sk_test_dev', 'the emulator reads the development overlay');
          assert.equal(local.GH_TOKEN, 'brand-gh', 'a key no overlay touches still comes from the base');

          const lane = stagedEnv(targetDir, { environment: 'testing' });
          assert.equal(lane.STRIPE_SECRET_KEY, 'sk_test_lane', 'a test lane reads the testing overlay');

          const upload = stagedEnv(targetDir, { environment: 'production' });
          assert.equal(upload.STRIPE_SECRET_KEY, 'sk_live_base', 'the deploy composes base + production — no overlay exists, so the base ships');
          assert.equal(Object.keys(upload).filter((key) => key.endsWith('_DEV')).length, 0, 'nothing named _DEV survives anywhere (#586)');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'no-overlay-file-leaves-the-staged-env-exactly-as-it-was',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'STRIPE_SECRET_KEY="sk_test_base"\nGH_TOKEN="brand-gh"\n',
        });

        try {
          const development = stagedEnv(targetDir, { environment: 'development' });
          const production = stagedEnv(targetDir, { environment: 'production' });

          assert.deepEqual(development, production, 'with no overlay authored, every environment stages the same artifact');
          assert.equal(production.STRIPE_SECRET_KEY, 'sk_test_base');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'only-a-deploy-stamps-the-license-verdict-into-the-artifact',
      auth: 'none',

      // #320: OMEGA_LICENSE_STATUS is the one COMPUTED key in dist/.env — the
      // deploy's license verdict, which no cascade layer supplies. Every local
      // lane stages without it, and an artifact with no status behaves exactly
      // as it did before the gate existed.
      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\nOMEGA_LICENSE_KEY="brand-license-key"\n',
        });

        try {
          const local = stagedEnv(targetDir, { environment: 'development' });
          assert.equal(local.OMEGA_LICENSE_STATUS, undefined, 'a local stage resolves no verdict, so it stamps none');
          assert.equal(local.OMEGA_LICENSE_KEY, undefined, 'and the KEY itself never rides the functions upload');

          const deploy = stagedEnv(targetDir, { environment: 'production', licenseStatus: 'keyless' });
          assert.equal(deploy.OMEGA_LICENSE_STATUS, 'keyless', "the deploy's verdict is what the runtime payment gate reads");
          assert.equal(deploy.OMEGA_LICENSE_KEY, undefined, 'still only the verdict — never the key');
          assert.equal(deploy.GH_TOKEN, 'brand-gh', 'the composed cascade is otherwise untouched');

          const licensed = stagedEnv(targetDir, { environment: 'production', licenseStatus: 'licensed' });
          assert.equal(licensed.OMEGA_LICENSE_STATUS, 'licensed');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-stage-reports-delivered-key-names-and-their-layer',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\n',
          targetEnv: 'OPENAI_API_KEY="target-openai"\n',
        });

        const lines = [];

        try {
          stageFunctions({ projectDir: targetDir, log: (message) => lines.push(message) });
          const output = lines.join('\n');

          assert.match(output, /GH_TOKEN \(brand\)/, 'the log names the key and the layer it came from');
          assert.match(output, /OPENAI_API_KEY \(target\)/, 'a target-layer key is reported as such');
          assert.equal(output.includes('brand-gh'), false, 'a .env VALUE is never printed');
          assert.equal(output.includes('target-openai'), false, 'a .env VALUE is never printed');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-watcher-watches-the-brand-root-and-company-env',
      auth: 'none',

      async run({ assert }) {
        const { root, brandRoot, companyRoot, targetDir } = seedBrand({
          companyEnv: '',
          brandEnv: '',
        });

        try {
          const inputs = envWatchInputs(targetDir);
          const watched = inputs.map((input) => input.path);

          assert.deepEqual(watched, [
            path.join(brandRoot, '.env'),
            path.join(companyRoot, '.env'),
          ], 'the brand-root and company .env are stage inputs, resolved through the chain — never hard-coded');
          assert.deepEqual(inputs.map((input) => input.layer), ['brand', 'company']);
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'an-overlay-edit-re-stages-like-a-plain-env-edit',
      auth: 'none',

      // #586: the overlay is a first-class layer, so it is a first-class WATCH
      // input — a `.env.development` edit at the brand root (or in the target's
      // own root) has to reach a running dev server exactly like a `.env` edit.
      async run({ assert }) {
        const { root, brandRoot, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\n',
          brandEnvOverlays: { development: 'GH_TOKEN="dev-first"\n' },
        });

        stageFunctions({ projectDir: targetDir, environment: 'development' });
        assert.equal(stagedValue(targetDir, 'GH_TOKEN'), 'dev-first', 'the first stage reads the overlay');

        // The fixture's own writes settle BEFORE the watch opens — macOS
        // replays recent FSEvents to a fresh recursive watcher, and a re-stage
        // from those would read the edit below without ever watching for it.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const watcher = watchAndStage({ projectDir: targetDir, environment: 'development', debounceMs: 20 });

        try {
          jetpack.write(path.join(brandRoot, '.env.development'), 'GH_TOKEN="dev-second"\n');
          assert.equal(await waitForStaged(targetDir, 'GH_TOKEN', 'dev-second'), true,
            'a brand-root .env.development edit re-stages');

          jetpack.write(path.join(targetDir, '.env.development'), 'GH_TOKEN="target-dev"\n');
          assert.equal(await waitForStaged(targetDir, 'GH_TOKEN', 'target-dev'), true,
            "the target root's own .env.development is a stage input too");
        } finally {
          watcher.close();
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'a-standalone-target-has-no-brand-or-company-env-to-watch',
      auth: 'none',

      async run({ assert }) {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-stage-env-solo-')));

        try {
          assert.deepEqual(envWatchInputs(dir), [], 'nothing above a standalone target — nothing extra to watch');
        } finally {
          jetpack.remove(dir);
        }
      },
    },
  ],
});
