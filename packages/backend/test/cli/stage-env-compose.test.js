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

const { stageFunctions, envWatchInputs } = require('../../src/cli/utils/stage-functions.js');

/**
 * A backend target inside a brand monorepo, with a company root above it:
 * <root>/company/.env, <root>/brand/.env, <root>/brand/targets/backend/.
 */
function seedBrand({ companyEnv, brandEnv, targetEnv }) {
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
  if (targetEnv !== undefined) jetpack.write(path.join(targetDir, '.env'), targetEnv);

  return { root, brandRoot, companyRoot, targetDir };
}

/** The staged dist/.env, parsed. */
function stagedEnv(targetDir, options) {
  stageFunctions({ projectDir: targetDir, ...options });
  return require('dotenv').parse(jetpack.read(path.join(targetDir, 'dist', '.env')) || '');
}

module.exports = {
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
          brandEnv: 'GH_TOKEN="brand-gh"\nOAUTH2_GOOGLE_CLIENT_ID="brand-oauth-id"\nRECAPTCHA_SITE_KEY="brand-site-key"\nGOOGLE_ANALYTICS_SECRET_BACKEND="brand-stream"\n',
        });

        try {
          const env = stagedEnv(targetDir);

          assert.equal(env.GH_TOKEN, 'brand-gh', 'a brand-root key the backend schema names must reach the artifact');
          assert.equal(env.OAUTH2_GOOGLE_CLIENT_ID, 'brand-oauth-id', 'the OAuth2 pattern family composes too (#678)');
          assert.equal(env.ANTHROPIC_API_KEY, 'company-anthropic', 'the company layer fills the gaps');
          assert.equal(env.GOOGLE_ANALYTICS_SECRET, 'brand-stream', "the backend's own GA4 stream secret arrives renamed");
          assert.equal(env.RECAPTCHA_SITE_KEY, undefined, 'a key the schema names for web only never joins the functions upload');
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
      name: 'a-deploy-stage-still-strips-the-dev-rows',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'STRIPE_SECRET_KEY="sk_test_base"\nSTRIPE_SECRET_KEY_DEV="sk_test_dev"\n',
        });

        try {
          const local = stagedEnv(targetDir);
          assert.equal(local.STRIPE_SECRET_KEY_DEV, 'sk_test_dev', 'a local stage keeps the dev twin — the emulator reads it');

          const upload = stagedEnv(targetDir, { deploy: true });
          assert.equal(upload.STRIPE_SECRET_KEY, 'sk_test_base', 'the base key still ships');
          assert.equal(upload.STRIPE_SECRET_KEY_DEV, undefined, 'a deploy stage drops every _DEV row (#586)');
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
};
