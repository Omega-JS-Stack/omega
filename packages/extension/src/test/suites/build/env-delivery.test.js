// The env schema is the ONE declaration of how a key reaches the extension
// ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)): the publish
// workflow's secrets block, the build's bake list, and `omega deploy`'s
// secrets step all read `delivery: { extension: … }` and nothing else.
// Before this, each of the three carried its own hand-kept list and they drifted
// (the #582 fix had to be made in the workflow by hand, one key at a time).
//
// Offline by construction: the scaffold writes into a temp dir, the `gh`
// boundary is injected, and a checkout is a real `git init` with a real
// `origin` in that temp dir (the origin gate reads it, #934): no network, no
// remote.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const { publishSecretKeys, bakeKeys, renderSecretsBlock, WORKFLOW_OWNED_KEYS } = require('@omega.js/config/env-delivery');

const SRC = path.join(__dirname, '..', '..', '..');
const { scaffoldDefaults } = require(path.join(SRC, 'gulp', 'tasks', 'defaults.js'));
// The bake seam is the BUNDLE's since #743 — the snapshot is baked into every
// emitted bundle, so the schema's bake list and its guard live with it.
const bundleTask = require(path.join(SRC, 'gulp', 'tasks', 'bundle.js'));
const { publishTargetSecrets } = require('@omega.js/devkit/target-secrets');
const { STEPS } = require(path.join(SRC, 'commands', 'lib', 'deploy-precheck.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

const quiet = { log() {}, warn() {}, error() {} };

/** A temp target dir, optionally with a local-level .env. */
function tmpTarget(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-env-delivery-'));
  if (env !== undefined) fs.writeFileSync(path.join(tmp, '.env'), env);
  return tmp;
}

/**
 * Declare the brand's org, the publish precondition. Secrets belong to the
 * SOURCE repo (#883), which derives as `<brand.id>-omega` under it.
 */
function declareRepo(dir, org) {
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), [
    '{',
    "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
    `  repo: { provider: 'github', org: '${org}' },`,
    '  targets: { extension: { type: "extension" } },',
    '}',
  ].join('\n'));
}

/**
 * A real checkout AT `dir` (a standalone target is its own brand root): `git
 * init`, plus an `origin` when one is given. The publisher's origin gate reads
 * the brand root's own `.git` and remote
 * ([#934](https://github.com/Omega-JS-Stack/omega/issues/934)), so a fixture is
 * a repo, never a stubbed answer. Re-running it on the same dir re-inits
 * harmlessly and adds the origin the first call left out.
 *
 * @param {string} dir - The directory to make a checkout.
 * @param {string} [remote] - The `origin` url; omitted, the checkout has none.
 * @returns {void}
 */
function checkout(dir, remote) {
  execFileSync('git', ['-C', dir, 'init', '-q']);
  if (remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'env delivery (#627): the workflow block, the bake list, and the secrets publish from ONE schema',
  tests: [
    {
      name: 'the publish workflow renders the schema block — every CI key, no token left (#627, #582)',
      run: (ctx) => {
        const tmp = tmpTarget();

        try {
          scaffoldDefaults({ outputDir: tmp });
          const workflow = fs.readFileSync(path.join(tmp, '.github', 'workflows', 'publish.yml'), 'utf8');

          ctx.expect(workflow.includes('[ githubSecrets ]')).toBe(false);
          for (const key of publishSecretKeys('extension').filter((k) => !WORKFLOW_OWNED_KEYS.includes(k))) {
            ctx.expect(workflow).toContain(`\n  ${key}: \${{ secrets.${key} }}`);
          }

          // #582's pin, now schema-derived: a dispatched CI run has no `.env`,
          // so the Measurement Protocol secret only reaches the build through
          // this block — without it every published extension baked an empty
          // secret and sent no events, silently.
          ctx.expect(workflow).toContain('GOOGLE_ANALYTICS_SECRET: ${{ secrets.GOOGLE_ANALYTICS_SECRET }}');

          // GH_TOKEN is the BRAND's cross-repo token, declared in the schema for
          // this target and workflow-owned (the template writes the line, so the
          // rendered block never restates it), never the run-scoped
          // `secrets.GITHUB_TOKEN` (#883): the publish uploads its zips to
          // `<brand.id>-releases`, a repo this run does not own.
          ctx.expect(workflow).toContain('GH_TOKEN: ${{ secrets.GH_TOKEN }}');
          ctx.expect(workflow.includes('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}')).toBe(false);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the rendered block is the config renderer\'s, byte for byte',
      run: (ctx) => {
        const tmp = tmpTarget();

        try {
          scaffoldDefaults({ outputDir: tmp });
          const workflow = fs.readFileSync(path.join(tmp, '.github', 'workflows', 'publish.yml'), 'utf8');

          ctx.expect(workflow).toContain(`  ${renderSecretsBlock('extension', { indent: '  ' })}\n`);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the build bakes exactly the schema\'s bake list, valued from the build env',
      run: (ctx) => {
        // The hardcoded `process.env.GOOGLE_ANALYTICS_SECRET` read is gone: the
        // key set is the schema's, so a new baked key is one schema entry.
        ctx.expect(bundleTask.BAKED_KEYS).toEqual(bakeKeys('extension'));
        ctx.expect(bundleTask.BAKED_KEYS).toEqual(['GOOGLE_ANALYTICS_SECRET']);

        const saved = process.env.GOOGLE_ANALYTICS_SECRET;
        try {
          process.env.GOOGLE_ANALYTICS_SECRET = 'fixture-mp-secret';
          ctx.expect(bundleTask.readBakedEnv().GOOGLE_ANALYTICS_SECRET).toBe('fixture-mp-secret');

          delete process.env.GOOGLE_ANALYTICS_SECRET;
          // Absent is the empty string, never undefined — the baked snapshot is
          // JSON and a missing key would read as "no analytics config at all".
          ctx.expect(bundleTask.readBakedEnv().GOOGLE_ANALYTICS_SECRET).toBe('');
        } finally {
          if (saved === undefined) delete process.env.GOOGLE_ANALYTICS_SECRET;
          else process.env.GOOGLE_ANALYTICS_SECRET = saved;
        }
      },
    },
    {
      name: 'the bake REFUSES a configured stream with no secret in build mode, warns in development (#626)',
      run: (ctx) => {
        // #582's failure mode, guarded at the seam it happens: a CI publish
        // runs with no `.env`, so a brand with a GA4 stream id and no
        // Measurement Protocol secret baked an empty string and shipped an
        // extension that sent no events — silently, forever.
        const configured = { analytics: { providers: { google: { id: 'G-FIXTURE' } } } };
        let thrown = null;
        try {
          bundleTask.readBakedEnv({}, { config: configured, build: true, logger: quiet });
        } catch (e) {
          thrown = e;
        }

        ctx.expect(thrown === null).toBe(false);
        // The BRAND-level key a human sets, and the config path that owes it.
        ctx.expect(thrown.message).toContain('GOOGLE_ANALYTICS_SECRET_EXTENSION');
        ctx.expect(thrown.message).toContain('analytics.providers.google.id');

        // Development warns and keeps going — a half-configured brand is a
        // normal step on the way to a configured one.
        const said = [];
        const loud = { log() {}, warn: (m) => said.push(m), error() {} };
        const baked = bundleTask.readBakedEnv({}, { config: configured, build: false, logger: loud });
        ctx.expect(baked.GOOGLE_ANALYTICS_SECRET).toBe('');
        ctx.expect(said.join('\n')).toContain('GOOGLE_ANALYTICS_SECRET_EXTENSION');

        // The secret under its DELIVERED name is the value the build holds.
        ctx.expect(bundleTask.readBakedEnv({ GOOGLE_ANALYTICS_SECRET: 'shh' }, { config: configured, build: true, logger: quiet }).GOOGLE_ANALYTICS_SECRET)
          .toBe('shh');

        // No stream configured, nothing owed.
        ctx.expect(bundleTask.readBakedEnv({}, { config: {}, build: true, logger: quiet }).GOOGLE_ANALYTICS_SECRET).toBe('');
      },
    },
    {
      name: 'the secrets publish sends the schema set, valued from the composed env, on stdin',
      run: (ctx) => {
        const tmp = tmpTarget('CHROME_CLIENT_ID=chrome-id\nGH_TOKEN=brand-token\nGOOGLE_ANALYTICS_SECRET_EXTENSION=mp-secret\nMY_CUSTOM_THING=custom\n');
        declareRepo(tmp, 'acme');
        checkout(tmp, 'git@github.com:acme/my-brand-omega.git');
        const gh = [];

        try {
          const result = publishTargetSecrets({
            targetDir: tmp,
            target: 'extension',
            logger: quiet,
            env: {},
            execFn: (file, args, options) => { gh.push({ file, args, input: options.input }); return ''; },
          });

          // The brand-level GOOGLE_ANALYTICS_SECRET_EXTENSION lands under its
          // DELIVERED name; the key the schema never declared is the CONSUMER's
          // own and travels too ([#835](https://github.com/Omega-JS-Stack/omega/issues/835)),
          // because their own workflow step is the only thing that reads it.
          // GH_TOKEN is the extension's OWN delivery (#883): the publish uploads
          // its zips to `<brand.id>-releases`, so this push has to arm the repo
          // with the brand token rather than wait for a sibling target's push.
          ctx.expect(result.published).toEqual(['CHROME_CLIENT_ID', 'GH_TOKEN', 'GOOGLE_ANALYTICS_SECRET', 'MY_CUSTOM_THING']);
          ctx.expect(gh.map((c) => c.args.join(' '))).toEqual([
            'auth status',
            'secret set CHROME_CLIENT_ID --repo acme/my-brand-omega',
            'secret set GH_TOKEN --repo acme/my-brand-omega',
            'secret set GOOGLE_ANALYTICS_SECRET --repo acme/my-brand-omega',
            'secret set MY_CUSTOM_THING --repo acme/my-brand-omega',
          ]);
          ctx.expect(gh.slice(1).map((c) => c.input)).toEqual(['chrome-id', 'brand-token', 'mp-secret', 'custom']);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the secrets publish skips LOUDLY on CI, an empty cascade and no remote, and REFUSES a stranger\'s repo (#934)',
      run: async (ctx) => {
        const noGh = () => { throw new Error('gh must not run'); };
        const messages = [];
        const loud = { log: (m) => messages.push(m), warn: (m) => messages.push(m), error: (m) => messages.push(m) };

        // A key the schema DECLARES for another target: nothing composes here.
        // (A key the schema does not know at all now would, #835.)
        const empty = tmpTarget('OMEGA_ADMIN_KEY=backend-only\n');
        declareRepo(empty, 'acme');

        try {
          ctx.expect(publishTargetSecrets({ targetDir: empty, target: 'extension', logger: loud, env: { CI: 'true' }, execFn: noGh }))
            .toEqual({ skipped: 'ci' });

          ctx.expect(publishTargetSecrets({ targetDir: empty, target: 'extension', logger: loud, env: {}, execFn: noGh }))
            .toEqual({ skipped: 'no-secrets' });

          const keyed = tmpTarget('CHROME_CLIENT_ID=chrome-id\n');
          declareRepo(keyed, 'acme');
          // A checkout nobody has pushed yet: no origin at all.
          checkout(keyed);
          ctx.expect(publishTargetSecrets({
            targetDir: keyed,
            target: 'extension',
            logger: loud,
            env: {},
            execFn: noGh,
          })).toEqual({ skipped: 'no-remote' });

          // The enclosing checkout is not the brand's repo: never arm a
          // stranger's Actions with this brand's store credentials. It REFUSES
          // on the one drift line (#934), and gh never runs.
          checkout(keyed, 'git@github.com:Omega-JS-Stack/omega.git');
          await ctx.expect(() => publishTargetSecrets({
            targetDir: keyed,
            target: 'extension',
            logger: loud,
            env: {},
            execFn: noGh,
          })).toThrow('origin is Omega-JS-Stack/omega but config derives acme/my-brand-omega: fix repo.org in config/omega.json5 or move the repo');

          fs.rmSync(keyed, { recursive: true, force: true });

          const said = messages.join('\n');
          ctx.expect(said).toContain('CI already has the repo secrets');
          ctx.expect(said).toContain('no keys composed for this target');
          ctx.expect(said).toContain('no GitHub remote');
        } finally {
          fs.rmSync(empty, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the deploy precheck runs push-secrets after the freshness check (#680), and it is FATAL (#891)',
      run: (ctx) => {
        ctx.expect(STEPS.map((step) => step.name)).toEqual(['framework-freshness', 'push-secrets']);
        // The dispatched publish reads what this step sends, so a refused or
        // half publish stops the deploy on all four frameworks.
        ctx.expect(STEPS.find((step) => step.name === 'push-secrets').fatal).toBe(true);
      },
    },
  ],
});
