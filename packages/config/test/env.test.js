/**
 * .env cascade tests for @omega.js/config: chain resolution (local/brand/
 * company, the last through the brand's `company: { id }` and the machine
 * registry, #677), precedence (shell > local > brand > company), and loading
 * tolerances (missing files, a company that is not on this machine).
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * devkit test convention. Tests mutate process.env through dotenv, so every
 * test uses its own key prefix and clears its keys when done. A fixture that
 * names a company points OMEGA_HOME at its own temp home, so no test reads or
 * writes the developer's real registry.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { loadEnv, reloadEnv, resolveEnvChain, loadEnvChain, loadEnvRoots, recordBrand, composeTargetEnv, artifactEnvValues, ENV_ENVIRONMENTS, envEnvironment } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function makeFixture(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

function cleanup(t, root, envKeys = []) {
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    envKeys.forEach((key) => delete process.env[key]);
  });
}

// A fixture's own machine home, plus the registry line the parent brand's own
// run would have written (#677): the company layer resolves from those two.
function useCompany(t, root, { parentRoot = path.join(root, 'parent'), id = 'acme-co', register = true } = {}) {
  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(root, 'home');
  t.after(() => {
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });

  if (register) recordBrand({ id, root: parentRoot, name: 'Acme Co', url: 'https://acme.test' });

  return path.join(parentRoot, 'company');
}

// ─── deliverAs delivery (#678) ───

// The GA4 stream secrets are the schema's only `deliverAs` family: a brand
// holds one per stream (GOOGLE_ANALYTICS_SECRET_<TARGET>), a target only ever
// reads GOOGLE_ANALYTICS_SECRET. The backend gets the rename through
// composeTargetEnv's dist/.env; every other target gets it through loadEnv.

const GA_KEYS = ['GOOGLE_ANALYTICS_SECRET', 'GOOGLE_ANALYTICS_SECRET_EXTENSION', 'GOOGLE_ANALYTICS_SECRET_BACKEND'];

function clearGaKeys() {
  GA_KEYS.forEach((key) => delete process.env[key]);
}

// ─── reloadEnv: a delivered name inherits its SOURCE key's ownership (#724) ───

// A rename CONSUMES its source key, so after the boot load nothing can see that
// the value came from the shell — the delivered name has to carry that ownership
// itself, or the reload drops a shell value (gone entirely when no file declares
// the source name, replaced by the file's when one does).
//
// THE SHELL: exported before this file reads its first `.env`, so the cascade's
// ownership snapshot counts the source name as shell-owned forever, exactly as a
// real `export GOOGLE_ANALYTICS_SECRET_WEB=…` would be. Each case re-sets it
// because delivery consumed it, the way the shell still holds it.
const WEB_SOURCE_KEY = 'GOOGLE_ANALYTICS_SECRET_WEB';
process.env[WEB_SOURCE_KEY] = 'shell-web-stream';

module.exports = defineCases({
  type: 'group',
  description: 'env',
  cleanup: () => { delete process.env[WEB_SOURCE_KEY]; },
  tests: [
    // ─── Full cascade ───

    {
      name: 'local in a brand with a company: shell > local .env > brand .env > company .env',
      run: (ctx) => {
        const root = makeFixture('env-full', {
          'parent/config/omega.json5': `{ brand: { id: 'acme-co', name: 'Acme Co' }, company: { id: 'self' } }`,
          'parent/company/.env': 'ENVT1_B=company\nENVT1_C=company\nENVT1_S=company\n',
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' } }`,
          'brand/.env': 'ENVT1_A=brand\nENVT1_B=brand\nENVT1_S=brand\n',
          'brand/targets/site/.env': 'ENVT1_A=local\nENVT1_S=local\n',
        });
        cleanup(ctx, root, ['ENVT1_A', 'ENVT1_B', 'ENVT1_C', 'ENVT1_S']);

        const brandRoot = path.join(root, 'brand');
        const companyRoot = useCompany(ctx, root);

        process.env.ENVT1_S = 'shell';

        const { chain, loaded } = loadEnv(path.join(brandRoot, 'targets', 'site'));

        ctx.expect(chain).toEqual({
          local: path.join(brandRoot, 'targets', 'site', '.env'),
          brand: path.join(brandRoot, '.env'),
          company: path.join(companyRoot, '.env'),
        });
        ctx.expect(loaded).toEqual([chain.local, chain.brand, chain.company]);

        ctx.expect(process.env.ENVT1_A).toBe('local');      // local beats brand
        ctx.expect(process.env.ENVT1_B).toBe('brand');    // brand beats company
        ctx.expect(process.env.ENVT1_C).toBe('company');  // company fills the gaps
        ctx.expect(process.env.ENVT1_S).toBe('shell');    // shell beats every file
      },
    },

    {
      name: 'backend functions dir: functions/.env is the local layer, brand discovered through the functions/ normalization',
      run: (ctx) => {
        const root = makeFixture('env-functions', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ENVT2_X=brand\nENVT2_Y=brand\n',
          'brand/targets/backend/functions/.env': 'ENVT2_X=functions\n',
        });
        cleanup(ctx, root, ['ENVT2_X', 'ENVT2_Y']);

        const functionsDir = path.join(root, 'brand', 'targets', 'backend', 'functions');
        const { chain, loaded } = loadEnv(functionsDir);

        ctx.expect(chain.local).toBe(path.join(functionsDir, '.env'));
        ctx.expect(chain.brand).toBe(path.join(root, 'brand', '.env'));
        ctx.expect(chain.company).toBe(null);
        ctx.expect(loaded.length).toBe(2);

        ctx.expect(process.env.ENVT2_X).toBe('functions');
        ctx.expect(process.env.ENVT2_Y).toBe('brand');
      },
    },

    {
      name: 'backend dist dir: dist/.env is the local layer, brand discovered through the dist/ normalization',
      run: (ctx) => {
        // `omega test` resolves the cascade from the staged dist/ (the runner's
        // functions dir for the run). Without the dist/ normalization the walk
        // looked for targets/ one level too low, so the brand layer came back null and
        // the run died on a missing secret that was sitting at the brand root —
        // exactly where the D15 cascade says to keep it
        // ([#257](https://github.com/Omega-JS-Stack/omega/issues/257)).
        const root = makeFixture('env-dist', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ENVT2D_X=brand\nENVT2D_Y=brand\n',
          'brand/targets/backend/dist/.env': 'ENVT2D_X=dist\n',
        });
        cleanup(ctx, root, ['ENVT2D_X', 'ENVT2D_Y']);

        const distDir = path.join(root, 'brand', 'targets', 'backend', 'dist');
        const { chain, loaded } = loadEnv(distDir);

        ctx.expect(chain.local).toBe(path.join(distDir, '.env'));
        ctx.expect(chain.brand).toBe(path.join(root, 'brand', '.env'));
        ctx.expect(chain.company).toBe(null);
        ctx.expect(loaded.length).toBe(2);

        ctx.expect(process.env.ENVT2D_X).toBe('dist');
        ctx.expect(process.env.ENVT2D_Y).toBe('brand');
      },
    },

    // ─── Partial chains ───

    {
      name: 'standalone project: local .env only; a project with no .env at all loads nothing and never throws',
      run: (ctx) => {
        const root = makeFixture('env-standalone', {
          'proj/.env': 'ENVT3_X=local\n',
          'bare/README.md': 'no env here',
        });
        cleanup(ctx, root, ['ENVT3_X']);

        const withEnv = loadEnv(path.join(root, 'proj'));
        ctx.expect(withEnv.chain.brand).toBe(null);
        ctx.expect(withEnv.chain.company).toBe(null);
        ctx.expect(withEnv.loaded).toEqual([path.join(root, 'proj', '.env')]);
        ctx.expect(process.env.ENVT3_X).toBe('local');

        const bare = loadEnv(path.join(root, 'bare'));
        ctx.expect(bare.loaded).toEqual([]);
      },
    },

    {
      name: 'brand root as startDir (the manager shape): its own .env is the local layer, its company.id supplies the company layer',
      run: (ctx) => {
        const root = makeFixture('env-brand-root', {
          'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
          'parent/company/.env': 'ENVT4_B=company\nENVT4_C=company\n',
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' } }`,
          'brand/.env': 'ENVT4_B=brand\n',
        });
        cleanup(ctx, root, ['ENVT4_B', 'ENVT4_C']);

        const brandRoot = path.join(root, 'brand');
        const companyRoot = useCompany(ctx, root);

        const { chain } = loadEnv(brandRoot);

        ctx.expect(chain.local).toBe(path.join(brandRoot, '.env'));
        ctx.expect(chain.brand).toBe(null);
        ctx.expect(chain.company).toBe(path.join(companyRoot, '.env'));

        ctx.expect(process.env.ENVT4_B).toBe('brand');
        ctx.expect(process.env.ENVT4_C).toBe('company');
      },
    },

    // ─── Company tolerances (#677) ───

    {
      name: 'a company that is not on this machine: no company layer, the rest loads',
      run: (ctx) => {
        const root = makeFixture('env-company-missing', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'ghost-env-co' } }`,
          'brand/targets/site/.env': 'ENVT5_X=local\n',
        });
        cleanup(ctx, root, ['ENVT5_X']);
        useCompany(ctx, root, { register: false });

        const { chain, loaded } = loadEnv(path.join(root, 'brand', 'targets', 'site'));

        ctx.expect(chain.company).toBe(null);
        ctx.expect(loaded).toEqual([chain.local]);
        ctx.expect(process.env.ENVT5_X).toBe('local');
      },
    },

    {
      name: 'a registry line pointing at a vanished root: no company layer, loading is silent',
      run: (ctx) => {
        const root = makeFixture('env-vanished', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' } }`,
          'brand/targets/site/.env': 'ENVT5B_X=local\n',
        });
        cleanup(ctx, root, ['ENVT5B_X']);
        useCompany(ctx, root, { parentRoot: path.join(root, 'parent-gone') });

        const { chain, loaded } = loadEnv(path.join(root, 'brand', 'targets', 'site'));

        ctx.expect(chain.company).toBe(null);
        ctx.expect(loaded).toEqual([chain.local]);
        ctx.expect(process.env.ENVT5B_X).toBe('local');
      },
    },

    // ─── loadEnvChain directly ───

    {
      name: 'loadEnvChain: explicit paths load strongest-first, nulls and missing files skip, shell still wins',
      run: (ctx) => {
        const root = makeFixture('env-chain', {
          'one/.env': 'ENVT6_X=one\nENVT6_S=one\n',
          'two/.env': 'ENVT6_X=two\nENVT6_Y=two\n',
        });
        cleanup(ctx, root, ['ENVT6_X', 'ENVT6_Y', 'ENVT6_S']);

        process.env.ENVT6_S = 'shell';

        const loaded = loadEnvChain([
          path.join(root, 'one', '.env'),
          null,
          path.join(root, 'missing', '.env'),
          path.join(root, 'two', '.env'),
        ]);

        ctx.expect(loaded).toEqual([path.join(root, 'one', '.env'), path.join(root, 'two', '.env')]);
        ctx.expect(process.env.ENVT6_X).toBe('one');   // first file wins
        ctx.expect(process.env.ENVT6_Y).toBe('two');   // later files fill gaps
        ctx.expect(process.env.ENVT6_S).toBe('shell'); // shell beats all files
      },
    },

    // ─── loadEnvRoots: the known-layers loader (the manager's walks) ───

    {
      name: 'loadEnvRoots: each root contributes .env + its named overlay, strongest root first',
      run: (ctx) => {
        const root = makeFixture('env-roots', {
          'brand/.env': 'ENVT16_X=brand\nENVT16_Y=brand\n',
          'brand/.env.production': 'ENVT16_X=brand-production\n',
          'brand/.env.development': 'ENVT16_X=brand-development\n',
          'company/.env': 'ENVT16_X=company\nENVT16_Y=company\nENVT16_Z=company\n',
          'company/.env.production': 'ENVT16_Z=company-production\n',
        });
        cleanup(ctx, root, ['ENVT16_X', 'ENVT16_Y', 'ENVT16_Z']);

        const loaded = loadEnvRoots(
          [path.join(root, 'brand'), null, path.join(root, 'company')],
          { environment: 'production' },
        );

        ctx.expect(loaded).toEqual([
          path.join(root, 'brand', '.env.production'),
          path.join(root, 'brand', '.env'),
          path.join(root, 'company', '.env.production'),
          path.join(root, 'company', '.env'),
        ]);
        ctx.expect(process.env.ENVT16_X).toBe('brand-production'); // the strongest root's overlay
        ctx.expect(process.env.ENVT16_Y).toBe('brand');            // its base still beats the company layer
        ctx.expect(process.env.ENVT16_Z).toBe('company-production'); // a gap the company overlay fills
      },
    },

    // ─── resolveEnvChain is read-only ───

    {
      name: 'resolveEnvChain resolves paths without touching process.env',
      run: (ctx) => {
        const root = makeFixture('env-resolve-only', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ENVT7_X=brand\n',
          'brand/targets/site/.env': 'ENVT7_X=local\n',
        });
        cleanup(ctx, root, ['ENVT7_X']);

        const chain = resolveEnvChain(path.join(root, 'brand', 'targets', 'site'));

        ctx.expect(chain.brand).toBe(path.join(root, 'brand', '.env'));
        ctx.expect(process.env.ENVT7_X).toBe(undefined);
      },
    },

    // ─── Empty file-layer values never claim a key (dogfood friction #20) ───

    {
      name: 'empty local-layer values (KEY= / KEY="") never shadow the brand layer; shell empties still win',
      run: (ctx) => {
        const root = makeFixture('env-empty', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ENVT9_A=brand-real\nENVT9_B=brand-real\nENVT9_S=brand-real\n',
          'brand/targets/site/.env': 'ENVT9_A=\nENVT9_B=""\nENVT9_S=""\nENVT9_ONLY=""\n',
        });
        cleanup(ctx, root, ['ENVT9_A', 'ENVT9_B', 'ENVT9_S', 'ENVT9_ONLY']);

        process.env.ENVT9_S = '';

        loadEnv(path.join(root, 'brand', 'targets', 'site'));

        ctx.expect(process.env.ENVT9_A, 'unquoted-empty local line must not shadow the brand value').toBe('brand-real');
        ctx.expect(process.env.ENVT9_B, 'quoted-empty local line must not shadow the brand value').toBe('brand-real');
        ctx.expect(process.env.ENVT9_S, 'a deliberately empty SHELL var still beats every file').toBe('');
        ctx.expect(process.env.ENVT9_ONLY, 'empty in every layer = key stays unset').toBe(undefined);
      },
    },

    // ─── composeTargetEnv: the dist/.env composition (#678) ───

    {
      name: 'composeTargetEnv: the schema filters the company + brand layers by target',
      run: (ctx) => {
        const root = makeFixture('env-compose-filter', {
          'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
          'parent/company/.env': 'ANTHROPIC_API_KEY=company-anthropic\n',
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' } }`,
          'brand/.env': 'GH_TOKEN=brand-gh\nCHROME_CLIENT_ID=brand-chrome-client\nANTHROPIC_API_KEY=brand-anthropic\nACME_WEBHOOK_KEY=brand-custom\n',
        });
        cleanup(ctx, root);

        const brandRoot = path.join(root, 'brand');
        useCompany(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(brandRoot, 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values.GH_TOKEN, 'a key the schema names for backend is delivered').toBe('brand-gh');
        ctx.expect(sources.GH_TOKEN).toBe('brand');
        ctx.expect(values.ANTHROPIC_API_KEY, 'the brand layer beats the company layer').toBe('brand-anthropic');
        ctx.expect(sources.ANTHROPIC_API_KEY).toBe('brand');
        ctx.expect(values.CHROME_CLIENT_ID, 'a key the schema names for the extension only never reaches the backend').toBe(undefined);
        // #835: the filter is on DECLARED keys only. A key the schema does not know
        // is the consumer's own, has no target of its own to be filtered by, and
        // rides down to every target (a consumer who wants one on a single target
        // puts it in that target's own .env, which already passes unfiltered).
        ctx.expect(values.ACME_WEBHOOK_KEY, "a key the schema does not know is the consumer's own and rides down").toBe('brand-custom');
        ctx.expect(sources.ACME_WEBHOOK_KEY).toBe('brand');
      },
    },

    {
      name: 'composeTargetEnv: a custom brand-root key reaches every target, from the base .env and the overlay (#835)',
      run: (ctx) => {
        const root = makeFixture('env-compose-custom', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ACME_WEBHOOK_KEY=base-custom\nACME_PARTNER_ID=base-partner\nCSC_KEY_PASSWORD=desktop-only\n',
          'brand/.env.production': 'ACME_WEBHOOK_KEY=production-custom\n',
        });
        cleanup(ctx, root);

        for (const [target, dir] of [['backend', 'backend'], ['web', 'website'], ['desktop', 'desktop'], ['extension', 'extension']]) {
          const { values, sources } = composeTargetEnv({
            targetDir: path.join(root, 'brand', 'targets', dir),
            target,
            environment: 'production',
          });

          ctx.expect(values.ACME_WEBHOOK_KEY, `${target}: the production overlay wins for a custom key too`).toBe('production-custom');
          ctx.expect(values.ACME_PARTNER_ID, `${target}: a custom key set only in the base .env still composes`).toBe('base-partner');
          ctx.expect(sources.ACME_WEBHOOK_KEY).toBe('brand');
        }

        // And the declared half is untouched: a key the schema targets at desktop
        // stays there.
        const web = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'website'),
          target: 'web',
          environment: 'production',
        });

        ctx.expect(web.values.CSC_KEY_PASSWORD, 'a DECLARED key is still filtered by the target it names').toBe(undefined);
      },
    },

    {
      name: 'composeTargetEnv: the company layer fills the gaps the brand layer leaves',
      run: (ctx) => {
        const root = makeFixture('env-compose-company', {
          'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
          'parent/company/.env': 'ANTHROPIC_API_KEY=company-anthropic\nCHROME_CLIENT_ID=company-chrome-client\n',
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' } }`,
          'brand/.env': 'GH_TOKEN=brand-gh\n',
        });
        cleanup(ctx, root);

        const brandRoot = path.join(root, 'brand');
        useCompany(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(brandRoot, 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values.ANTHROPIC_API_KEY).toBe('company-anthropic');
        ctx.expect(sources.ANTHROPIC_API_KEY).toBe('company');
        ctx.expect(values.CHROME_CLIENT_ID, 'the company layer is filtered by the same schema').toBe(undefined);
      },
    },

    {
      name: 'composeTargetEnv: the target layer wins per key, and an empty value never claims one',
      run: (ctx) => {
        const root = makeFixture('env-compose-override', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'GH_TOKEN=brand-gh\nOPENAI_API_KEY=brand-openai\n',
          'brand/targets/backend/.env': 'GH_TOKEN=target-gh\nOPENAI_API_KEY=""\n',
        });
        cleanup(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values.GH_TOKEN, "the target's own .env is the per-key override").toBe('target-gh');
        ctx.expect(sources.GH_TOKEN).toBe('target');
        ctx.expect(values.OPENAI_API_KEY, 'an empty target value never claims the key').toBe('brand-openai');
        ctx.expect(sources.OPENAI_API_KEY).toBe('brand');
      },
    },

    {
      name: 'composeTargetEnv: the target layer passes through unfiltered — placement IS the targeting',
      run: (ctx) => {
        const root = makeFixture('env-compose-passthrough', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'SOME_BESPOKE_KEY=brand-value\n',
          'brand/targets/backend/.env': 'SOME_BESPOKE_KEY=target-value\nCHROME_CLIENT_ID=target-chrome-client\n',
        });
        cleanup(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values.SOME_BESPOKE_KEY, 'a key the schema does not know still passes through').toBe('target-value');
        ctx.expect(sources.SOME_BESPOKE_KEY).toBe('target');
        ctx.expect(values.CHROME_CLIENT_ID, 'an extension-named key placed in the backend .env by hand is delivered').toBe('target-chrome-client');
      },
    },

    {
      name: 'composeTargetEnv: a pattern entry composes (CONNECTIONS_<PROVIDER>_CLIENT_*)',
      run: (ctx) => {
        const root = makeFixture('env-compose-pattern', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'CONNECTIONS_GOOGLE_CLIENT_ID=brand-client-id\nCONNECTIONS_GOOGLE_CLIENT_SECRET=brand-client-secret\n',
        });
        cleanup(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values.CONNECTIONS_GOOGLE_CLIENT_ID).toBe('brand-client-id');
        ctx.expect(values.CONNECTIONS_GOOGLE_CLIENT_SECRET).toBe('brand-client-secret');
        ctx.expect(sources.CONNECTIONS_GOOGLE_CLIENT_ID).toBe('brand');
      },
    },

    {
      name: 'composeTargetEnv: deliverAs renames the per-target GA4 secret on delivery',
      run: (ctx) => {
        const root = makeFixture('env-compose-deliver-as', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'GOOGLE_ANALYTICS_SECRET_BACKEND=backend-stream\nGOOGLE_ANALYTICS_SECRET_WEB=web-stream\n',
        });
        cleanup(ctx, root);

        const backend = composeTargetEnv({ targetDir: path.join(root, 'brand', 'targets', 'backend'), target: 'backend' });

        ctx.expect(backend.values.GOOGLE_ANALYTICS_SECRET, "the backend's stream secret arrives under the runtime name").toBe('backend-stream');
        ctx.expect(backend.sources.GOOGLE_ANALYTICS_SECRET).toBe('brand');
        ctx.expect(backend.values.GOOGLE_ANALYTICS_SECRET_BACKEND, 'the brand-level name never ships').toBe(undefined);
        ctx.expect(backend.values.GOOGLE_ANALYTICS_SECRET_WEB, "another target's stream secret never ships").toBe(undefined);

        const web = composeTargetEnv({ targetDir: path.join(root, 'brand', 'targets', 'website'), target: 'web' });
        ctx.expect(web.values.GOOGLE_ANALYTICS_SECRET, 'each target gets its own stream secret').toBe('web-stream');
      },
    },

    {
      name: 'composeTargetEnv: a runtime-group key in the brand root never composes',
      run: (ctx) => {
        const root = makeFixture('env-compose-runtime', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'CLAUDE_CODE_OAUTH_TOKEN=brand-token\nGOOGLE_ANALYTICS_SECRET=brand-secret\n',
        });
        cleanup(ctx, root);

        const { values } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values.CLAUDE_CODE_OAUTH_TOKEN, 'the runtime group is resolved some other way, never composed').toBe(undefined);
        ctx.expect(values.GOOGLE_ANALYTICS_SECRET, 'the runtime name is delivered by deliverAs, never from a brand key of the same name').toBe(undefined);
      },
    },

    {
      name: 'composeTargetEnv: no .env anywhere composes nothing and never throws',
      run: (ctx) => {
        const root = makeFixture('env-compose-empty', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
        });
        cleanup(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values).toEqual({});
        ctx.expect(sources).toEqual({});
      },
    },

    {
      name: 'loadEnv with a target: the brand-level GA4 secret lands under the runtime name',
      run: (ctx) => {
        const root = makeFixture('env-deliver-load', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'GOOGLE_ANALYTICS_SECRET_EXTENSION=ext-stream\n',
        });
        cleanup(ctx, root, GA_KEYS);
        clearGaKeys();

        loadEnv(path.join(root, 'brand', 'targets', 'extension'), { target: 'extension' });

        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET, 'the extension reads the one runtime name').toBe('ext-stream');
        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET_EXTENSION, 'the brand-level name is consumed by the rename').toBe(undefined);
      },
    },

    {
      name: 'loadEnv with a target: a value already under the delivered name wins',
      run: (ctx) => {
        const root = makeFixture('env-deliver-explicit', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'GOOGLE_ANALYTICS_SECRET_EXTENSION=ext-stream\n',
        });
        cleanup(ctx, root, GA_KEYS);
        clearGaKeys();

        process.env.GOOGLE_ANALYTICS_SECRET = 'shell-secret';
        loadEnv(path.join(root, 'brand', 'targets', 'extension'), { target: 'extension' });

        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET, 'an explicit answer is never overridden').toBe('shell-secret');
      },
    },

    {
      name: 'loadEnv without a target: nothing is renamed',
      run: (ctx) => {
        const root = makeFixture('env-deliver-none', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'GOOGLE_ANALYTICS_SECRET_EXTENSION=ext-stream\n',
        });
        cleanup(ctx, root, GA_KEYS);
        clearGaKeys();

        loadEnv(path.join(root, 'brand', 'targets', 'extension'));

        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET_EXTENSION, 'the cascade still loads the brand-level name').toBe('ext-stream');
        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET, 'no target, no rename').toBe(undefined);
      },
    },

    {
      name: 'composeTargetEnv: the target layer renames too, and overrides the brand',
      run: (ctx) => {
        const root = makeFixture('env-deliver-target-layer', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'GOOGLE_ANALYTICS_SECRET_BACKEND=brand-stream\n',
          'brand/targets/backend/.env': 'GOOGLE_ANALYTICS_SECRET_BACKEND=target-stream\n',
        });
        cleanup(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
        });

        ctx.expect(values.GOOGLE_ANALYTICS_SECRET, "the target's own answer wins").toBe('target-stream');
        ctx.expect(sources.GOOGLE_ANALYTICS_SECRET).toBe('target');
        ctx.expect(values.GOOGLE_ANALYTICS_SECRET_BACKEND, 'one key ships, under the delivered name').toBe(undefined);
      },
    },

    {
      name: 'reloadEnv: a shell-set source key keeps the delivered name, with no file declaring it',
      run: (ctx) => {
        const root = makeFixture('env-deliver-reload-shell', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ENVT17_X=brand\n',
        });
        cleanup(ctx, root, [...GA_KEYS, WEB_SOURCE_KEY, 'ENVT17_X']);
        clearGaKeys();

        process.env[WEB_SOURCE_KEY] = 'shell-web-stream';
        const websiteDir = path.join(root, 'brand', 'targets', 'website');

        loadEnv(websiteDir, { target: 'web' });
        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET, 'the boot load delivers the shell value, or the case proves nothing').toBe('shell-web-stream');

        reloadEnv(websiteDir, { target: 'web' });

        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET, "a delivered name inherits its source key's SHELL ownership — a reload never drops it").toBe('shell-web-stream');
      },
    },

    {
      name: 'reloadEnv: a shell-set source key still beats the file that declares the same name',
      run: (ctx) => {
        const root = makeFixture('env-deliver-reload-shell-vs-file', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': `${WEB_SOURCE_KEY}=file-web-stream\n`,
        });
        cleanup(ctx, root, [...GA_KEYS, WEB_SOURCE_KEY]);
        clearGaKeys();

        process.env[WEB_SOURCE_KEY] = 'shell-web-stream';
        const websiteDir = path.join(root, 'brand', 'targets', 'website');

        loadEnv(websiteDir, { target: 'web' });
        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET, 'the shell beats the file at boot, or the case proves nothing').toBe('shell-web-stream');

        reloadEnv(websiteDir, { target: 'web' });

        ctx.expect(process.env.GOOGLE_ANALYTICS_SECRET, 'the reload re-reads the file, and the shell keeps winning').toBe('shell-web-stream');
      },
    },

    // ─── Environment overlays (#586) ───

    // `.env.<environment>` overlays the `.env` beside it, the widespread standard.
    // The environment names are exactly what envEnvironment() returns — one
    // vocabulary with the runtime's own (`development` | `testing` | `production`).

    {
      name: 'envEnvironment(): one vocabulary — the named input wins, then production, else development, and no signal is production',
      run: (ctx) => {
        const saved = { OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT, OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE, ENVIRONMENT: process.env.ENVIRONMENT, FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR, TERM_PROGRAM: process.env.TERM_PROGRAM };
        ctx.after(() => {
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        });

        const only = (vars) => {
          for (const key of Object.keys(saved)) delete process.env[key];
          Object.assign(process.env, vars);
          return envEnvironment();
        };

        // The one input (#817) wins outright: the ambient answer is the PRODUCER of
        // OMEGA_ENVIRONMENT, so once a lane has named one, the sniff never contradicts it.
        ctx.expect(only({ OMEGA_ENVIRONMENT: 'development', ENVIRONMENT: 'production' }), 'the named input wins over every sniff').toBe('development');
        ctx.expect(only({ OMEGA_ENVIRONMENT: 'testing', ENVIRONMENT: 'production' }), 'a test run is named by the one input, and it wins over every sniff').toBe('testing');
        ctx.expect(only({ OMEGA_ENVIRONMENT: 'staging' }), 'a fourth word is not an input, so the sniff answers').toBe('production');

        // The retired test-mode flag names nothing: the remaining sniffs answer.
        ctx.expect(only({ OMEGA_TEST_MODE: 'true', ENVIRONMENT: 'production' }), 'the retired flag is not a testing signal').toBe('production');
        ctx.expect(only({ OMEGA_TEST_MODE: 'true', FUNCTIONS_EMULATOR: 'true' }), 'the retired flag yields to the development signals').toBe('development');
        ctx.expect(only({ OMEGA_TEST_MODE: 'true' }), 'the retired flag alone is no signal, so production').toBe('production');

        ctx.expect(only({ ENVIRONMENT: 'production' })).toBe('production');
        ctx.expect(only({ ENVIRONMENT: 'development' })).toBe('development');
        ctx.expect(only({ FUNCTIONS_EMULATOR: 'true' })).toBe('development');
        ctx.expect(only({}), 'no signal is production — a deployed function carries none').toBe('production');

        // The list every overlay suffix and every scaffolded file is spelled from
        ctx.expect(ENV_ENVIRONMENTS).toEqual(['development', 'testing', 'production']);
        for (const vars of [{ ENVIRONMENT: 'development' }, { ENVIRONMENT: 'production' }, { OMEGA_ENVIRONMENT: 'testing' }]) {
          ctx.expect(ENV_ENVIRONMENTS.includes(only(vars)), 'the resolver can only ever answer a name from the list').toBeTruthy();
        }
      },
    },

    {
      name: 'loadEnv: .env.<environment> overlays the .env beside it, at every layer',
      run: (ctx) => {
        const root = makeFixture('env-overlay-load', {
          'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
          'parent/company/.env': 'ENVO1_C=company\nENVO1_B=company\nENVO1_L=company\n',
          'parent/company/.env.development': 'ENVO1_C=company-dev\n',
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' } }`,
          'brand/.env': 'ENVO1_B=brand\nENVO1_L=brand\n',
          'brand/.env.development': 'ENVO1_B=brand-dev\n',
          'brand/targets/site/.env': 'ENVO1_L=local\n',
          'brand/targets/site/.env.development': 'ENVO1_L=local-dev\n',
        });
        cleanup(ctx, root, ['ENVO1_C', 'ENVO1_B', 'ENVO1_L']);

        const brandRoot = path.join(root, 'brand');
        useCompany(ctx, root);

        const { loaded } = loadEnv(path.join(brandRoot, 'targets', 'site'), { environment: 'development' });

        ctx.expect(process.env.ENVO1_L, "the local layer's overlay beats its own base").toBe('local-dev');
        ctx.expect(process.env.ENVO1_B, 'a brand overlay beats the brand base — and still loses to a stronger layer').toBe('brand-dev');
        ctx.expect(process.env.ENVO1_C).toBe('company-dev');
        ctx.expect(loaded, 'each layer contributes its overlay first, then its base').toEqual([
          path.join(brandRoot, 'targets', 'site', '.env.development'),
          path.join(brandRoot, 'targets', 'site', '.env'),
          path.join(brandRoot, '.env.development'),
          path.join(brandRoot, '.env'),
          path.join(root, 'parent', 'company', '.env.development'),
          path.join(root, 'parent', 'company', '.env'),
        ]);
      },
    },

    {
      name: 'loadEnv: only the RUNNING environment overlays — another environment file is never read',
      run: (ctx) => {
        const root = makeFixture('env-overlay-other', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ENVO2_K=base\n',
          'brand/.env.production': 'ENVO2_K=production\n',
          'brand/.env.testing': 'ENVO2_K=testing\n',
        });
        cleanup(ctx, root, ['ENVO2_K']);

        const { loaded } = loadEnv(path.join(root, 'brand', 'targets', 'site'), { environment: 'development' });

        ctx.expect(process.env.ENVO2_K, "a development run never reads another environment's file").toBe('base');
        ctx.expect(loaded).toEqual([path.join(root, 'brand', '.env')]);
      },
    },

    {
      name: 'loadEnv: no overlay file leaves the chain exactly as it was',
      run: (ctx) => {
        const root = makeFixture('env-overlay-absent', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'ENVO3_K=base\n',
        });
        cleanup(ctx, root, ['ENVO3_K']);

        const { chain, loaded } = loadEnv(path.join(root, 'brand', 'targets', 'site'), { environment: 'development' });

        ctx.expect(loaded, 'a missing overlay skips silently').toEqual([path.join(root, 'brand', '.env')]);
        ctx.expect(chain, 'the chain shape is the three base layers, unchanged').toEqual({
          local: path.join(root, 'brand', 'targets', 'site', '.env'),
          brand: path.join(root, 'brand', '.env'),
          company: null,
        });
        ctx.expect(process.env.ENVO3_K).toBe('base');
      },
    },

    {
      name: 'composeTargetEnv: the environment overlay overrides the base within each layer',
      run: (ctx) => {
        const root = makeFixture('env-overlay-compose', {
          'parent/config/omega.json5': `{ brand: { id: 'acme-co' }, company: { id: 'self' } }`,
          'parent/company/.env': 'GH_TOKEN=company\nOMEGA_ADMIN_KEY=company\n',
          'parent/company/.env.testing': 'GH_TOKEN=company-testing\n',
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'acme-co' } }`,
          'brand/.env': 'OMEGA_ADMIN_KEY=brand\nOMEGA_WEBHOOK_KEY=brand\n',
          'brand/.env.testing': 'OMEGA_ADMIN_KEY=brand-testing\n',
          'brand/targets/backend/.env': 'OMEGA_WEBHOOK_KEY=target\n',
          'brand/targets/backend/.env.testing': 'OMEGA_WEBHOOK_KEY=target-testing\n',
        });
        cleanup(ctx, root);

        const brandRoot = path.join(root, 'brand');
        useCompany(ctx, root);

        const { values, sources } = composeTargetEnv({
          targetDir: path.join(brandRoot, 'targets', 'backend'),
          target: 'backend',
          environment: 'testing',
        });

        ctx.expect(values.GH_TOKEN).toBe('company-testing');
        ctx.expect(sources.GH_TOKEN, 'an overlay is its layer, not a layer of its own').toBe('company');
        ctx.expect(values.OMEGA_ADMIN_KEY, "the brand's overlay beats the brand base and the company layer").toBe('brand-testing');
        ctx.expect(values.OMEGA_WEBHOOK_KEY).toBe('target-testing');
        ctx.expect(sources.OMEGA_WEBHOOK_KEY).toBe('target');
      },
    },

    {
      name: "composeTargetEnv: another environment's overlay never rides the artifact",
      run: (ctx) => {
        const root = makeFixture('env-overlay-compose-other', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'OMEGA_ADMIN_KEY=base\n',
          'brand/.env.development': 'OMEGA_ADMIN_KEY=development\n',
          'brand/.env.production': 'OMEGA_ADMIN_KEY=production\n',
        });
        cleanup(ctx, root);

        const deployed = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
          environment: 'production',
        });
        ctx.expect(deployed.values.OMEGA_ADMIN_KEY, 'a deploy composes base + production').toBe('production');

        const local = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
          environment: 'development',
        });
        ctx.expect(local.values.OMEGA_ADMIN_KEY, 'the emulator composes base + development').toBe('development');
      },
    },

    {
      name: 'composeTargetEnv: the schema still filters an overlay — an unclaimed key never rides down',
      run: (ctx) => {
        const root = makeFixture('env-overlay-compose-filter', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'OMEGA_ADMIN_KEY=base\n',
          'brand/.env.development': 'OMEGA_ADMIN_KEY=dev\nCSC_KEY_PASSWORD=desktop-only\n',
        });
        cleanup(ctx, root);

        const { values } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
          environment: 'development',
        });

        ctx.expect(values.OMEGA_ADMIN_KEY).toBe('dev');
        ctx.expect(values.CSC_KEY_PASSWORD, 'an overlay is filtered by the schema exactly like the base').toBe(undefined);
      },
    },

    {
      name: 'composeTargetEnv: the backend composes the license key for the PUBLISHER, and the artifact never carries it (#872)',
      run: (ctx) => {
        const root = makeFixture('env-compose-license', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
          'brand/.env': 'OMEGA_LICENSE_KEY=omg_live_fixture\nOMEGA_ADMIN_KEY=admin\n',
        });
        cleanup(ctx, root);

        const { values } = composeTargetEnv({
          targetDir: path.join(root, 'brand', 'targets', 'backend'),
          target: 'backend',
          environment: 'production',
        });

        // The precheck publishes this value as the repo secret the composed workflow
        // injects, so the runner's `omega deploy --direct` can run the license check
        // where the deploy now runs. That is the ONLY reason it composes at all.
        ctx.expect(values.OMEGA_LICENSE_KEY).toBe('omg_live_fixture');

        // The .env the functions upload ships with is the narrower set: a `ci`
        // delivery is a runner-env key, never an artifact line.
        const shipped = artifactEnvValues('backend', values);
        ctx.expect(shipped.OMEGA_LICENSE_KEY, 'a shipped .env with the license key in it is the one thing #320 forbids').toBe(undefined);
        ctx.expect(shipped.OMEGA_ADMIN_KEY, 'every `env` delivery still rides').toBe('admin');
      },
    },
  ],
});
