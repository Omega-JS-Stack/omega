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
const expect = require('../../dist/vendor/devkit/test/expect.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

const { stageFunctions, envWatchInputs, watchAndStage } = require('../../dist/cli/utils/stage-functions.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/**
 * A backend target inside a brand monorepo whose brand names a COMPANY (#677):
 * the parent brand's company/ tree holds the shared .env, and the machine
 * registry (pointed at this fixture's own home) says where the parent is.
 */
function seedBrand({ companyEnv, brandEnv, brandEnvOverlays, brandConfig, brandConfigOverlays, targetEnv }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-stage-env-')));
  const parentRoot = path.join(root, 'parent');
  const companyRoot = path.join(parentRoot, 'company');
  const brandRoot = path.join(root, 'brand');
  const targetDir = path.join(brandRoot, 'targets', 'backend');

  jetpack.write(path.join(parentRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture-co', name: 'Fixture Co', url: 'https://fixture-co.test' },
    company: { id: 'self' },
  }));
  jetpack.write(path.join(companyRoot, '.env'), companyEnv || '');
  jetpack.write(path.join(root, 'home', 'brands.json'), JSON.stringify({ 'fixture-co': { root: parentRoot } }));
  process.env.OMEGA_HOME = path.join(root, 'home');
  jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    company: { id: 'fixture-co' },
    targets: { backend: { type: 'backend' } },
    ...(brandConfig || {}),
  }));
  // The config half of the same pair (#856): `omega.<environment>.json5` beside
  // the brand file, exactly where `.env.<environment>` sits beside the .env.
  for (const [environment, contents] of Object.entries(brandConfigOverlays || {})) {
    jetpack.write(path.join(brandRoot, 'config', `omega.${environment}.json5`), JSON.stringify(contents));
  }

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

/**
 * Wait until the watcher's log reports the re-stage a touch of `touchFile`
 * causes: proof that the FSEvents stream behind that directory is delivering.
 * A write landing before the stream arms is lost, not delayed, so the touch is
 * re-written every 250 ms until the line arrives.
 *
 * @param {string[]} lines - The array the watcher's `log` sink pushes into.
 * @param {string} touchFile - A stage input the watcher filters in.
 * @param {string} contents - Its current contents, so nothing staged changes.
 * @param {{ reason: string, timeoutMs?: number }} options - The reason the re-stage line names, and the window.
 */
async function waitUntilArmed(lines, touchFile, contents, { reason, timeoutMs = 5000 }) {
  const expected = `Re-staged dist/ (${reason} changed)`;
  const start = lines.length;
  const deadline = Date.now() + timeoutMs;
  let touchedAt = 0;

  while (Date.now() < deadline) {
    if (lines.slice(start).includes(expected)) return;

    if (Date.now() - touchedAt >= 250) {
      jetpack.write(touchFile, contents);
      touchedAt = Date.now();
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`The watcher never logged "${expected}" for ${touchFile} within ${timeoutMs} ms; it logged: ${JSON.stringify(lines.slice(start))}`);
}

module.exports = defineCases({
  description: 'Stage composes dist/.env from the cascade (brand root ← target override)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-brand-root-key-the-schema-names-reaches-dist-env',
      auth: 'none',

      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          companyEnv: 'ANTHROPIC_API_KEY="company-anthropic"\n',
          brandEnv: 'GH_TOKEN="brand-gh"\nCONNECTIONS_GOOGLE_CLIENT_ID="brand-oauth-id"\nCHROME_CLIENT_ID="brand-chrome-client"\nGOOGLE_ANALYTICS_SECRET_BACKEND="brand-stream"\n',
        });

        try {
          const env = stagedEnv(targetDir);

          expect(env.GH_TOKEN, 'a brand-root key the backend schema names must reach the artifact').toBe('brand-gh');
          expect(env.CONNECTIONS_GOOGLE_CLIENT_ID, 'the connections pattern family composes too (#678)').toBe('brand-oauth-id');
          expect(env.ANTHROPIC_API_KEY, 'the company layer fills the gaps').toBe('company-anthropic');
          expect(env.GOOGLE_ANALYTICS_SECRET, "the backend's own GA4 stream secret arrives renamed").toBe('brand-stream');
          expect(env.CHROME_CLIENT_ID, 'a key the schema names for the extension only never joins the functions upload').toBe(undefined);
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'a-value-firebase-would-decode-differently-is-refused-before-dist-env-is-written',
      auth: 'none',

      // Firebase's own .env reader turns the `\t` in C:\temp into a tab, so
      // the stage refuses the value by key, and the wipe before it means no
      // dist/.env is left on disk at all.
      async run() {
        const { root, targetDir } = seedBrand({ targetEnv: 'X="C:\\temp"\nSAFE_KEY="plain"\n' });

        try {
          expect(() => stageFunctions({ projectDir: targetDir })).toThrow((error) => /\bX\b/.test(error.message)
              && !error.message.includes('C:\\temp')
              && !error.message.includes('SAFE_KEY'));
          expect(jetpack.exists(path.join(targetDir, 'dist', '.env')), 'the refused stage must not write dist/.env').toBe(false);
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
      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'OMEGA_LICENSE_KEY="omg_live_brand"\nOMEGA_ADMIN_KEY="brand-admin"\n',
        });

        try {
          const env = stagedEnv(targetDir, { environment: 'production', licenseStatus: 'licensed' });

          expect(env.OMEGA_LICENSE_KEY, 'a runner-only key never lands in the .env the upload ships with').toBe(undefined);
          expect(env.OMEGA_LICENSE_STATUS, 'the VERDICT is what the artifact carries').toBe('licensed');
          expect(env.OMEGA_ADMIN_KEY, 'every `env` delivery still composes').toBe('brand-admin');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-target-env-wins-per-key',
      auth: 'none',

      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\nOPENAI_API_KEY="brand-openai"\n',
          targetEnv: 'GH_TOKEN="target-gh"\nSOME_BESPOKE_KEY="target-only"\n',
        });

        try {
          const env = stagedEnv(targetDir);

          expect(env.GH_TOKEN, "the target's own .env is the per-key override").toBe('target-gh');
          expect(env.OPENAI_API_KEY, 'keys it does not override still come from the brand root').toBe('brand-openai');
          expect(env.SOME_BESPOKE_KEY, 'a key the schema does not know passes through from the target layer').toBe('target-only');
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
      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'STRIPE_SECRET_KEY="sk_live_base"\nGH_TOKEN="brand-gh"\n',
          brandEnvOverlays: {
            development: 'STRIPE_SECRET_KEY="sk_test_dev"\n',
            testing: 'STRIPE_SECRET_KEY="sk_test_lane"\n',
          },
        });

        try {
          const local = stagedEnv(targetDir, { environment: 'development' });
          expect(local.STRIPE_SECRET_KEY, 'the emulator reads the development overlay').toBe('sk_test_dev');
          expect(local.GH_TOKEN, 'a key no overlay touches still comes from the base').toBe('brand-gh');

          const lane = stagedEnv(targetDir, { environment: 'testing' });
          expect(lane.STRIPE_SECRET_KEY, 'a test lane reads the testing overlay').toBe('sk_test_lane');

          const upload = stagedEnv(targetDir, { environment: 'production' });
          expect(upload.STRIPE_SECRET_KEY, 'the deploy composes base + production — no overlay exists, so the base ships').toBe('sk_live_base');
          expect(Object.keys(upload).filter((key) => key.endsWith('_DEV')).length, 'nothing named _DEV survives anywhere (#586)').toBe(0);
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'each-lane-stages-its-own-config-overlay',
      auth: 'none',

      // #856: the CONFIG overlay follows the same word the .env overlay above
      // it does. The compose runs on a machine whose ambient answer is
      // `development` (a terminal, a runner), so the lane names what the
      // artifact is FOR and the upload carries that environment's values only.
      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          brandConfig: { payment: { providers: { stripe: { publishableKey: 'pk_live_base' } } } },
          brandConfigOverlays: {
            development: { payment: { providers: { stripe: { publishableKey: 'pk_test_dev' } } } },
          },
        });

        const stagedConfig = (environment) => {
          stageFunctions({ projectDir: targetDir, environment });
          return JSON5.parse(jetpack.read(path.join(targetDir, 'dist', 'config', 'omega.json5')));
        };

        try {
          const upload = stagedConfig('production');
          expect(upload.payment.providers.stripe.publishableKey, 'the deploy upload carries the base value, never the development override').toBe('pk_live_base');

          const local = stagedConfig('development');
          expect(local.payment.providers.stripe.publishableKey, 'a local stage carries the development overlay, the same word its .env used').toBe('pk_test_dev');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'no-overlay-file-leaves-the-staged-env-exactly-as-it-was',
      auth: 'none',

      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'STRIPE_SECRET_KEY="sk_test_base"\nGH_TOKEN="brand-gh"\n',
        });

        try {
          const development = stagedEnv(targetDir, { environment: 'development' });
          const production = stagedEnv(targetDir, { environment: 'production' });

          expect(development, 'with no overlay authored, every environment stages the same artifact').toEqual(production);
          expect(production.STRIPE_SECRET_KEY).toBe('sk_test_base');
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
      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\nOMEGA_LICENSE_KEY="brand-license-key"\n',
        });

        try {
          const local = stagedEnv(targetDir, { environment: 'development' });
          expect(local.OMEGA_LICENSE_STATUS, 'a local stage resolves no verdict, so it stamps none').toBe(undefined);
          expect(local.OMEGA_LICENSE_KEY, 'and the KEY itself never rides the functions upload').toBe(undefined);

          const deploy = stagedEnv(targetDir, { environment: 'production', licenseStatus: 'keyless' });
          expect(deploy.OMEGA_LICENSE_STATUS, "the deploy's verdict is what the runtime payment gate reads").toBe('keyless');
          expect(deploy.OMEGA_LICENSE_KEY, 'still only the verdict — never the key').toBe(undefined);
          expect(deploy.GH_TOKEN, 'the composed cascade is otherwise untouched').toBe('brand-gh');

          const licensed = stagedEnv(targetDir, { environment: 'production', licenseStatus: 'licensed' });
          expect(licensed.OMEGA_LICENSE_STATUS).toBe('licensed');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-stage-reports-delivered-key-names-and-their-layer',
      auth: 'none',

      async run({ expect }) {
        const { root, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\n',
          targetEnv: 'OPENAI_API_KEY="target-openai"\n',
        });

        const lines = [];

        try {
          stageFunctions({ projectDir: targetDir, log: (message) => lines.push(message) });
          const output = lines.join('\n');

          expect(output, 'the log names the key and the layer it came from').toMatch(/GH_TOKEN \(brand\)/);
          expect(output, 'a target-layer key is reported as such').toMatch(/OPENAI_API_KEY \(target\)/);
          expect(output.includes('brand-gh'), 'a .env VALUE is never printed').toBe(false);
          expect(output.includes('target-openai'), 'a .env VALUE is never printed').toBe(false);
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-watcher-watches-the-brand-root-and-company-env',
      auth: 'none',

      async run({ expect }) {
        const { root, brandRoot, companyRoot, targetDir } = seedBrand({
          companyEnv: '',
          brandEnv: '',
        });

        try {
          const inputs = envWatchInputs(targetDir);
          const watched = inputs.map((input) => input.path);

          expect(watched, 'the brand-root and company .env are stage inputs, resolved through the chain — never hard-coded').toEqual([
            path.join(brandRoot, '.env'),
            path.join(companyRoot, '.env'),
          ]);
          expect(inputs.map((input) => input.layer)).toEqual(['brand', 'company']);
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
      async run({ expect }) {
        const { root, brandRoot, targetDir } = seedBrand({
          brandEnv: 'GH_TOKEN="brand-gh"\n',
          brandEnvOverlays: { development: 'GH_TOKEN="dev-first"\n' },
          targetEnv: 'SAFE_KEY="plain"\n',
        });

        stageFunctions({ projectDir: targetDir, environment: 'development' });
        expect(stagedValue(targetDir, 'GH_TOKEN'), 'the first stage reads the overlay').toBe('dev-first');

        // The fixture's own writes settle BEFORE the watch opens — macOS
        // replays recent FSEvents to a fresh recursive watcher, and a re-stage
        // from those would read the edit below without ever watching for it.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const lines = [];
        const watcher = watchAndStage({ projectDir: targetDir, environment: 'development', debounceMs: 20, log: (line) => lines.push(line) });

        try {
          await waitUntilArmed(lines, path.join(brandRoot, '.env'), 'GH_TOKEN="brand-gh"\n', { reason: 'brand .env' });
          jetpack.write(path.join(brandRoot, '.env.development'), 'GH_TOKEN="dev-second"\n');
          expect(await waitForStaged(targetDir, 'GH_TOKEN', 'dev-second'), 'a brand-root .env.development edit re-stages').toBe(true);

          await waitUntilArmed(lines, path.join(targetDir, '.env'), 'SAFE_KEY="plain"\n', { reason: '.env' });
          jetpack.write(path.join(targetDir, '.env.development'), 'GH_TOKEN="target-dev"\n');
          expect(await waitForStaged(targetDir, 'GH_TOKEN', 'target-dev'), "the target root's own .env.development is a stage input too").toBe(true);
        } finally {
          watcher.close();
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'the-armed-handshake-throws-when-nothing-ever-re-stages',
      auth: 'none',

      // An empty target fails every re-stage, so the watcher logs only
      // `Re-stage failed: ...`: the handshake has to throw, never return.
      async run({ expect }) {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-stage-env-dead-')));
        const lines = [];
        const watcher = watchAndStage({ projectDir: dir, environment: 'development', debounceMs: 20, log: (line) => lines.push(line) });

        try {
          await expect(waitUntilArmed(lines, path.join(dir, 'package.json'), '{}\n', { reason: 'package.json', timeoutMs: 800 }), 'a watcher that never re-stages fails the handshake by name')
            .rejects.toThrow((error) => error.message.includes(path.join(dir, 'package.json')));
        } finally {
          watcher.close();
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'a-standalone-target-has-no-brand-or-company-env-to-watch',
      auth: 'none',

      async run({ expect }) {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-stage-env-solo-')));

        try {
          expect(envWatchInputs(dir), 'nothing above a standalone target — nothing extra to watch').toEqual([]);
        } finally {
          jetpack.remove(dir);
        }
      },
    },
  ],
});
