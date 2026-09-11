// The env schema is the ONE declaration of how a key reaches the extension
// ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)): the publish
// workflow's secrets block, the build's bake list, and `omega deploy`'s
// push-secrets step all read `delivery: { extension: … }` and nothing else.
// Before this, each of the three carried its own hand-kept list and they drifted
// (the #582 fix had to be made in the workflow by hand, one key at a time).
//
// Offline by construction: the scaffold writes into a temp dir and the `gh`/
// `git` boundaries are injected — no network, no real repo.

const path = require('path');
const fs = require('fs');
const os = require('os');

const { publishSecretKeys, bakeKeys, renderSecretsBlock, WORKFLOW_OWNED_KEYS } = require('@omega.js/config/env-delivery');

const SRC = path.join(__dirname, '..', '..', '..');
const { scaffoldDefaults } = require(path.join(SRC, 'gulp', 'tasks', 'defaults.js'));
// The bake seam is the BUNDLE's since #743 — the snapshot is baked into every
// emitted bundle, so the schema's bake list and its guard live with it.
const bundleTask = require(path.join(SRC, 'gulp', 'tasks', 'bundle.js'));
const { publishEnvSecrets } = require(path.join(SRC, 'commands', 'lib', 'push-secrets.js'));
const { STEPS } = require(path.join(SRC, 'commands', 'lib', 'deploy-precheck.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

const quiet = { log() {}, warn() {}, error() {} };

/** A temp target dir, optionally with a local-level .env. */
function tmpTarget(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-env-delivery-'));
  if (env !== undefined) fs.writeFileSync(path.join(tmp, '.env'), env);
  return tmp;
}

/** Declare the brand's own GitHub repo — the publish precondition. */
function declareRepo(dir, slug) {
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), [
    '{',
    "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
    `  repo: { providers: { github: { repo: '${slug}' } } },`,
    '  targets: { extension: {} },',
    '}',
  ].join('\n'));
}

/**
 * A `git` stub that answers PER COMMAND. The publisher resolves the deploy lane
 * before it guards ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)),
 * so `rev-parse --show-toplevel` has to answer that this checkout IS the brand
 * root: an UNPLACED answer reads as a nested brand, whose remote is the
 * enclosing repo by construction and whose mismatch guard is therefore skipped.
 *
 * @param {string|function} remote - What `git config --get remote.origin.url` answers (or throws).
 * @returns {function} `(command, options) => string`
 */
function gitStub(remote) {
  return (command, options) => {
    if (command.includes('rev-parse')) return `${options.cwd}\n`;
    return typeof remote === 'function' ? remote() : remote;
  };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'env delivery (#627) — the workflow block, the bake list, and push-secrets from ONE schema',
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

          // GITHUB_TOKEN is the runner's own, not a schema key — still literal.
          ctx.expect(workflow).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
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
      name: 'push-secrets publishes the schema set, valued from the composed env, on stdin',
      run: (ctx) => {
        const tmp = tmpTarget('CHROME_CLIENT_ID=chrome-id\nGOOGLE_ANALYTICS_SECRET_EXTENSION=mp-secret\nMY_CUSTOM_THING=custom\n');
        declareRepo(tmp, 'acme/ext');
        const gh = [];

        try {
          const result = publishEnvSecrets({
            targetDir: tmp,
            logger: quiet,
            env: {},
            gitExecFn: () => 'git@github.com:acme/ext.git\n',
            execFn: (file, args, options) => { gh.push({ file, args, input: options.input }); return ''; },
          });

          // The brand-level GOOGLE_ANALYTICS_SECRET_EXTENSION lands under its
          // DELIVERED name; the undeclared key is nobody's secret.
          ctx.expect(result.published).toEqual(['CHROME_CLIENT_ID', 'GOOGLE_ANALYTICS_SECRET']);
          ctx.expect(gh.map((c) => c.args.join(' '))).toEqual([
            'auth status',
            'secret set CHROME_CLIENT_ID --repo acme/ext',
            'secret set GOOGLE_ANALYTICS_SECRET --repo acme/ext',
          ]);
          ctx.expect(gh.slice(1).map((c) => c.input)).toEqual(['chrome-id', 'mp-secret']);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'push-secrets skips LOUDLY on CI, an empty cascade, no remote, and a stranger\'s repo',
      run: (ctx) => {
        const noGh = () => { throw new Error('gh must not run'); };
        const messages = [];
        const loud = { log: (m) => messages.push(m), warn: (m) => messages.push(m), error: (m) => messages.push(m) };

        const empty = tmpTarget('MY_CUSTOM_THING=custom\n');
        declareRepo(empty, 'acme/ext');

        try {
          ctx.expect(publishEnvSecrets({ targetDir: empty, logger: loud, env: { CI: 'true' }, execFn: noGh, gitExecFn: noGh }))
            .toEqual({ skipped: 'ci' });

          ctx.expect(publishEnvSecrets({ targetDir: empty, logger: loud, env: {}, execFn: noGh, gitExecFn: noGh }))
            .toEqual({ skipped: 'no-secrets' });

          const keyed = tmpTarget('CHROME_CLIENT_ID=chrome-id\n');
          declareRepo(keyed, 'acme/ext');
          ctx.expect(publishEnvSecrets({
            targetDir: keyed,
            logger: loud,
            env: {},
            execFn: noGh,
            gitExecFn: gitStub(() => { throw new Error('fatal: no such remote'); }),
          })).toEqual({ skipped: 'no-remote' });

          // The enclosing checkout is not the brand's repo — never arm a
          // stranger's Actions with this brand's store credentials.
          ctx.expect(publishEnvSecrets({
            targetDir: keyed,
            logger: loud,
            env: {},
            execFn: noGh,
            gitExecFn: gitStub('git@github.com:Omega-JS-Stack/omega.git\n'),
          })).toEqual({ skipped: 'repo-mismatch' });

          fs.rmSync(keyed, { recursive: true, force: true });

          const said = messages.join('\n');
          ctx.expect(said).toContain('CI already has the repo secrets');
          ctx.expect(said).toContain('no keys composed for this target');
          ctx.expect(said).toContain('no GitHub remote');
          ctx.expect(said).toContain("this brand's repo is acme/ext");
        } finally {
          fs.rmSync(empty, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the deploy precheck runs push-secrets after the freshness check (#680)',
      run: (ctx) => {
        ctx.expect(STEPS.map((step) => step.name)).toEqual(['framework-freshness', 'push-secrets']);
      },
    },
  ],
});
