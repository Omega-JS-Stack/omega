/**
 * The shared `.env` → Actions secrets publisher (#627 review) — web's and the
 * extension's ONE copy of derive → collect → guard → publish.
 *
 * Offline by construction: the brand and target are temp dirs, the `gh`
 * boundary is injected in every test, and a checkout is a real `git init` with
 * a real `origin` in that temp dir (the origin gate reads it the way a deploy
 * does, #934), so no test touches a remote or the network. What it pins is the orchestration each framework binds: the SCHEMA
 * decides the key set, the COMPOSED env supplies the values, the brand's
 * DECLARED repo gates the send, and every skip is loud.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { execFileSync } = require('node:child_process');

// The machine registry is per-machine state: this file's fixtures record into a temp home.
require('../src/test/temp-home.js');

const { collectTargetSecrets, publishTargetSecrets } = require('../src/target-secrets.js');

const quiet = { log() {}, warn() {}, error() {} };
const noExec = () => { throw new Error('the boundary must not run'); };

/**
 * A brand root with one target under targets/<target>, the brand .env holding
 * `brandEnv`, and the brand's repo OWNER declared when `owner` is given (the SOURCE
 * repo derives from it as `my-brand-omega`, #883). `parent` places it inside
 * another directory (a nested brand's enclosing checkout); default the tmpdir.
 */
function tmpBrand({ target, brandEnv, owner, parent }) {
  const brand = fs.mkdtempSync(path.join(parent || os.tmpdir(), 'devkit-target-secrets-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), [
    '{',
    "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
    ...(owner ? [`  repo: { owner: '${owner}' },`] : []),
    `  targets: { ${target}: {} },`,
    '}',
  ].join('\n'));
  if (brandEnv !== undefined) fs.writeFileSync(path.join(brand, '.env'), brandEnv);

  const targetDir = path.join(brand, 'targets', target);
  fs.mkdirSync(targetDir, { recursive: true });
  // The manifests a brand really has: what makes the walk find this root as the
  // brand root, which is what the lane reasons from (#872).
  fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'my-brand', private: true, workspaces: ['targets/*'] }));
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: `my-brand-${target}`, private: true }));

  return { brand, targetDir };
}

/**
 * A real checkout AT `dir`: `git init`, plus an `origin` when one is given. The
 * origin gate reads the brand root's own `.git` and remote (#934), so a fixture
 * is a repo, never a stubbed answer.
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
  description: 'target-secrets',
  tests: [
    // #586 — the `.env.<environment>` overlay reaches this lane too. What a runner
    // builds is a RELEASE, so the publish composes PRODUCTION: a developer machine's
    // `.env.development` values must never become the repo's Actions secrets, and
    // the composed set must not depend on which shell ran the publish.
    {
      name: 'collect: the publish composes PRODUCTION, never this shell\'s environment',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'extension',
          brandEnv: 'CHROME_CLIENT_ID=live-id\n',
        });
        const saved = { OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT };

        fs.writeFileSync(path.join(brand, '.env.development'), 'CHROME_CLIENT_ID=dev-id\n');
        fs.writeFileSync(path.join(brand, '.env.production'), 'CHROME_CLIENT_ID=prod-id\n');

        try {
          for (const environment of ['development', 'testing', 'production']) {
            process.env.OMEGA_ENVIRONMENT = environment;

            ctx.expect(collectTargetSecrets({ targetDir, target: 'extension' }), `a publish run under ${environment} still publishes the production value`).toEqual({
              CHROME_CLIENT_ID: 'prod-id',
            });
          }
        } finally {
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'collect: the SCHEMA names the keys, the composed env supplies the values',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'extension',
          brandEnv: 'CHROME_CLIENT_ID=chrome-id\nGOOGLE_ANALYTICS_SECRET_EXTENSION=mp-secret\nMY_CUSTOM_THING=custom\n',
        });

        try {
          // The brand-level GOOGLE_ANALYTICS_SECRET_EXTENSION arrives under its
          // DELIVERED name; the key the schema does not know is the consumer's own
          // and travels too (#835), because their workflow step is the only thing
          // that reads it and it used to fail silently.
          ctx.expect(collectTargetSecrets({ targetDir, target: 'extension' })).toEqual({
            CHROME_CLIENT_ID: 'chrome-id',
            GOOGLE_ANALYTICS_SECRET: 'mp-secret',
            MY_CUSTOM_THING: 'custom',
          });

          // The same cascade read for a different target answers THAT target's set —
          // the target string is the only thing a framework binds. None of the
          // DECLARED keys is web's; the consumer's own key has no target of its own,
          // so it reaches every one.
          ctx.expect(collectTargetSecrets({ targetDir, target: 'web' })).toEqual({
            MY_CUSTOM_THING: 'custom',
          });
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    // #876 + #835: the backend's whole delivered set in one read, the OAuth family
    // the schema knows only as a PATTERN (so only the composed env can name the
    // providers this brand configured), a key of the consumer's own, and the two
    // that must stay home.
    {
      name: 'collect: backend publishes the CONNECTIONS family and the custom key, never a machine-local one',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'backend',
          brandEnv: [
            'CONNECTIONS_GITHUB_CLIENT_ID=gh-client-id',
            'CONNECTIONS_GITHUB_CLIENT_SECRET=gh-client-secret',
            'ACME_WEBHOOK_KEY=acme-webhook',
            'OMEGA_ADMIN_KEY=admin',
            'OMEGA_FONTAWESOME_ROOT=/Users/someone/fa',
            '',
          ].join('\n'),
        });

        try {
          const keys = Object.keys(collectTargetSecrets({ targetDir, target: 'backend' })).sort();

          ctx.expect(keys).toEqual([
            'ACME_WEBHOOK_KEY',
            'CONNECTIONS_GITHUB_CLIENT_ID',
            'CONNECTIONS_GITHUB_CLIENT_SECRET',
            'OMEGA_ADMIN_KEY',
          ]);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publish: the collected keys go to the declared repo, values on stdin',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'web',
          brandEnv: 'OMEGA_LICENSE_KEY=omg_live_fixture\nGOOGLE_ANALYTICS_SECRET_WEB=mp-secret\n',
          owner: 'acme',
        });
        const gh = [];

        checkout(brand, 'git@github.com:acme/my-brand-omega.git');
        try {
          const result = publishTargetSecrets({
            targetDir,
            target: 'web',
            logger: quiet,
            env: {},
            execFn: (file, args, options) => { gh.push({ file, args, input: (options || {}).input }); return ''; },
          });

          ctx.expect(result.published).toEqual(['GOOGLE_ANALYTICS_SECRET', 'OMEGA_LICENSE_KEY']);
          ctx.expect(gh.map((call) => call.args.join(' '))).toEqual([
            '--version', 'api user',
            'secret set GOOGLE_ANALYTICS_SECRET --repo acme/my-brand-omega',
            'secret set OMEGA_LICENSE_KEY --repo acme/my-brand-omega',
          ]);
          // Values travel on stdin, never in argv.
          ctx.expect(gh.slice(2).map((call) => call.input)).toEqual(['mp-secret', 'omg_live_fixture']);
          ctx.expect(gh.every((call) => !call.args.join(' ').includes('omg_live_fixture'))).toBeTruthy();
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    // #682 — desktop's signing secrets are named by PATH in the cascade
    // (CSC_LINK=config/certs/dev-id.p12) and CI needs the FILE, so the one shape
    // difference between the three binds is a resolver applied before the send.
    {
      name: 'publish: a resolveValue seam transforms each value, and a falsy return drops the key',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'web',
          brandEnv: 'OMEGA_LICENSE_KEY=omg_live_fixture\nGOOGLE_ANALYTICS_SECRET_WEB=mp-secret\n',
          owner: 'acme',
        });
        const gh = [];

        checkout(brand, 'git@github.com:acme/my-brand-omega.git');
        try {
          // The seam sees the composed value and its DELIVERED key.
          ctx.expect(collectTargetSecrets({ targetDir, target: 'web', resolveValue: (value, key) => `${key}:${value}` })).toEqual({ GOOGLE_ANALYTICS_SECRET: 'GOOGLE_ANALYTICS_SECRET:mp-secret', OMEGA_LICENSE_KEY: 'OMEGA_LICENSE_KEY:omg_live_fixture' });

          const result = publishTargetSecrets({
            targetDir,
            target: 'web',
            logger: quiet,
            env: {},
            resolveValue: (value, key) => (key === 'OMEGA_LICENSE_KEY' ? Buffer.from(value).toString('base64') : null),
            execFn: (file, args, options) => { gh.push({ args, input: (options || {}).input }); return ''; },
          });

          // The dropped key never reaches gh; the kept one travels transformed.
          ctx.expect(result.published).toEqual(['OMEGA_LICENSE_KEY']);
          ctx.expect(gh.map((call) => call.args.join(' '))).toEqual([
            '--version', 'api user',
            'secret set OMEGA_LICENSE_KEY --repo acme/my-brand-omega',
          ]);
          ctx.expect(gh.slice(2).map((call) => call.input)).toEqual([Buffer.from('omg_live_fixture').toString('base64')]);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publish: the four skips are loud, and none of them touches gh',
      run: (ctx) => {
        const said = [];
        const loud = { log: (m) => said.push(m), warn: (m) => said.push(m), error: (m) => said.push(m) };

        // A key the schema DECLARES for another target: nothing composes for web.
        // (A key the schema does not know at all would compose here now, #835.)
        const empty = tmpBrand({ target: 'web', brandEnv: 'CHROME_CLIENT_ID=chrome-id\n', owner: 'acme' });
        const keyed = tmpBrand({ target: 'web', brandEnv: 'OMEGA_LICENSE_KEY=omg_live_fixture\n', owner: 'acme' });
        const undeclared = tmpBrand({ target: 'web', brandEnv: 'OMEGA_LICENSE_KEY=omg_live_fixture\n' });

        try {
          // 1. CI already has the repo secrets, and the runner token can't write them.
          ctx.expect(publishTargetSecrets({ targetDir: keyed.targetDir, target: 'web', logger: loud, env: { CI: 'true' }, execFn: noExec })).toEqual({ skipped: 'ci' });

          // 2. Nothing composed for this target.
          ctx.expect(publishTargetSecrets({ targetDir: empty.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec })).toEqual({ skipped: 'no-secrets' });

          // 3. No GitHub remote to publish to: a checkout nobody has pushed yet.
          checkout(keyed.brand);
          ctx.expect(publishTargetSecrets({
              targetDir: keyed.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec,
            })).toEqual({ skipped: 'no-remote' });

          // 4. The brand names no repo — an inferred remote is never proof.
          ctx.expect(publishTargetSecrets({
              targetDir: undeclared.targetDir, target: 'web', logger: loud, env: {}, execFn: noExec,
            })).toEqual({ skipped: 'no-declared-repo' });

          const heard = said.join('\n');
          ctx.expect(heard).toMatch(/CI already has the repo secrets/);
          ctx.expect(heard).toMatch(/no keys composed for this target/);
          ctx.expect(heard).toMatch(/no GitHub remote/);
          ctx.expect(heard).toMatch(/names no GitHub repo in config/);
          ctx.expect(heard.includes('Set repo.owner and brand.id in config/omega.json5: the source repo is <brand.id>-omega under that owner.')).toBeTruthy();
        } finally {
          for (const { brand } of [empty, keyed, undeclared]) fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    // #934: the checkout's origin is not the source repo the config derives. The
    // brand root IS that checkout's toplevel, so this is a brand that could have
    // been its own and is not (#872): publishing would arm a repo that is not the
    // derived one, which is the harm, so it REFUSES on the one drift line.
    {
      name: 'publish: an origin that is not the derived source repo REFUSES with the one drift line, and publishes nothing (#934)',
      run: (ctx) => {
        const keyed = tmpBrand({ target: 'web', brandEnv: 'OMEGA_LICENSE_KEY=omg_live_fixture\n', owner: 'acme' });
        const gh = [];
        checkout(keyed.brand, 'git@github.com:Omega-JS-Stack/omega.git');

        try {
          ctx.expect(() => publishTargetSecrets({
              targetDir: keyed.targetDir, target: 'web', logger: quiet, env: {},
              execFn: (file, args) => { gh.push(args.join(' ')); return ''; },
            })).toThrow((error) => {
              ctx.expect(error.message).toBe('origin is Omega-JS-Stack/omega but config derives acme/my-brand-omega: fix repo.owner in config/omega.json5 or move the repo');
              return true;
            });
          ctx.expect(gh, 'not one gh call: no auth check, no secret set').toEqual([]);
        } finally {
          fs.rmSync(keyed.brand, { recursive: true, force: true });
        }
      },
    },

    // #872: a NESTED brand (a brand that is a folder of a bigger repo, the way
    // this monorepo's playground is) has a remote that answers the ENCLOSING repo
    // by construction, and its deploy snapshots the folder to the DECLARED repo.
    // The origin gate reads only a `.git` AT the brand root (#934), never walking
    // up, so it has nothing to compare there; the run's secrets have to be on the
    // repo the workflow runs from.
    {
      name: 'publish: a NESTED brand publishes to its DECLARED repo, remote mismatch and all',
      run: (ctx) => {
        // The brand folder sits inside a bigger checkout, whose remote is the
        // monorepo's: exactly the shape a walk-up read would take for a stranger's.
        const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-target-secrets-outer-'));
        checkout(outer, 'git@github.com:Omega-JS-Stack/omega.git');
        const { targetDir } = tmpBrand({
          target: 'web',
          brandEnv: 'OMEGA_LICENSE_KEY=omg_live_fixture\n',
          owner: 'Omega-JS-Stack',
          parent: outer,
        });
        const gh = [];

        try {
          const result = publishTargetSecrets({
            targetDir,
            target: 'web',
            logger: quiet,
            env: {},
            execFn: (file, args, options) => { gh.push({ args, input: (options || {}).input }); return ''; },
          });

          ctx.expect(result.published).toEqual(['OMEGA_LICENSE_KEY']);
          ctx.expect(gh.map((call) => call.args.join(' '))).toEqual([
            '--version', 'api user',
            'secret set OMEGA_LICENSE_KEY --repo Omega-JS-Stack/my-brand-omega',
          ]);
        } finally {
          fs.rmSync(outer, { recursive: true, force: true });
        }
      },
    },

    // #872: a key with no `.env` home rides the publish too, since backend's deploy
    // credential is a FILE the firebase service mints (never an env value), and the
    // runner needs it as a repo secret like everything else. The seam is separate
    // from `resolveValue` on purpose: an extra arrives already valued.
    {
      name: 'publish: extraSecrets ride the publish, over the composed values and past the resolveValue seam',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'web',
          brandEnv: 'OMEGA_LICENSE_KEY=omg_live_fixture\nGOOGLE_ANALYTICS_SECRET_WEB=mp-secret\n',
          owner: 'acme',
        });
        const gh = [];

        checkout(brand, 'git@github.com:acme/my-brand-omega.git');
        try {
          const result = publishTargetSecrets({
            targetDir,
            target: 'web',
            logger: quiet,
            env: {},
            extraSecrets: {
              // No schema key, no composed value: it exists only here
              OMEGA_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}',
              // A composed key an extra OVERRIDES, and one an empty extra never claims
              OMEGA_LICENSE_KEY: 'omg_live_from_the_caller',
              GOOGLE_ANALYTICS_SECRET: '',
            },
            // The value seam is the COMPOSED half's: an extra is published verbatim
            resolveValue: (value) => `resolved:${value}`,
            execFn: (file, args, options) => { gh.push({ args, input: (options || {}).input }); return ''; },
          });

          ctx.expect(result.published).toEqual(['GOOGLE_ANALYTICS_SECRET', 'OMEGA_LICENSE_KEY', 'OMEGA_SERVICE_ACCOUNT_JSON']);
          ctx.expect(gh.slice(2).map((call) => call.args.join(' '))).toEqual([
            'secret set GOOGLE_ANALYTICS_SECRET --repo acme/my-brand-omega',
            'secret set OMEGA_LICENSE_KEY --repo acme/my-brand-omega',
            'secret set OMEGA_SERVICE_ACCOUNT_JSON --repo acme/my-brand-omega',
          ]);
          ctx.expect(gh.slice(2).map((call) => call.input)).toEqual([
            'resolved:mp-secret',
            'omg_live_from_the_caller',
            '{"type":"service_account"}',
          ]);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publish: an extra secret ALONE is a publish, never the empty-set skip',
      run: (ctx) => {
        // Another target's DECLARED key, so the composed set for web is empty (#835:
        // a key the schema does not know would compose for every target).
        const { brand, targetDir } = tmpBrand({ target: 'web', brandEnv: 'CHROME_CLIENT_ID=chrome-id\n', owner: 'acme' });
        const gh = [];

        checkout(brand, 'git@github.com:acme/my-brand-omega.git');
        try {
          const result = publishTargetSecrets({
            targetDir,
            target: 'web',
            logger: quiet,
            env: {},
            extraSecrets: { OMEGA_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}' },
            execFn: (file, args, options) => { gh.push({ args, input: (options || {}).input }); return ''; },
          });

          ctx.expect(result.published).toEqual(['OMEGA_SERVICE_ACCOUNT_JSON']);
          ctx.expect(gh.map((call) => call.args.join(' '))).toEqual([
            '--version', 'api user',
            'secret set OMEGA_SERVICE_ACCOUNT_JSON --repo acme/my-brand-omega',
          ]);
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    // ─── The seams, in ONE table (#891) ─────────────────────────────────────────
    // The four framework bind files are gone: a caller passes a target string and
    // devkit brings that type's own shape differences. These prove each entry.

    {
      name: 'seams: desktop base64s a file-path secret, and an ABSOLUTE tree path resolves as given',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({ target: 'desktop', owner: 'acme' });
        const gh = [];

        checkout(brand, 'git@github.com:acme/my-brand-omega.git');
        try {
          // The derived signing paths are ABSOLUTE (they point into the signing tree,
          // outside the target), so an absolute value must resolve as given.
          const keyFile = path.join(brand, 'AuthKey_ABSOLUTE01.p8');
          fs.writeFileSync(keyFile, 'authkey-bytes');
          fs.writeFileSync(path.join(brand, '.env'), [
            `APPLE_API_KEY=${keyFile}`,
            'APPLE_API_KEY_ID=ABSOLUTE01',
            'APPLE_API_ISSUER=issuer-uuid',
            'APPLE_TEAM_ID=TEAMTEST12',
            'CSC_LINK=config/certs/mine.p12',
            'CSC_KEY_PASSWORD=pw',
          ].join('\n'));
          // The relative one an operator may still type by hand, under the target.
          fs.mkdirSync(path.join(targetDir, 'config', 'certs'), { recursive: true });
          fs.writeFileSync(path.join(targetDir, 'config', 'certs', 'mine.p12'), 'p12-bytes');

          const result = publishTargetSecrets({
            targetDir,
            target: 'desktop',
            logger: quiet,
            env: {},
            execFn: (file, args, options) => { gh.push({ args, input: (options || {}).input }); return ''; },
          });

          const sent = new Map(gh.slice(2).map((call) => [call.args[2], call.input]));
          ctx.expect(result.published.includes('APPLE_API_KEY')).toBeTruthy();
          ctx.expect(sent.get('APPLE_API_KEY'), 'the absolute path publishes as bytes').toBe(Buffer.from('authkey-bytes').toString('base64'));
          ctx.expect(sent.get('CSC_LINK'), 'a relative path still resolves under the target').toBe(Buffer.from('p12-bytes').toString('base64'));
          ctx.expect(sent.get('CSC_KEY_PASSWORD'), 'a value that names no file travels verbatim').toBe('pw');
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'seams: backend brings the service-account key as an extra secret, from the brand chain',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'backend',
          // The unconditional backend requirements, so the refusal guard has nothing
          // to say and the EXTRA is what this case is about.
          brandEnv: 'GH_TOKEN=ghp_fixture\nOMEGA_ADMIN_KEY=admin\nOMEGA_WEBHOOK_KEY=hook\nOMEGA_NAMESPACE=ns\nUNSUBSCRIBE_HMAC_KEY=hmac\n',
          owner: 'acme',
        });
        const gh = [];

        checkout(brand, 'git@github.com:acme/my-brand-omega.git');
        try {
          fs.mkdirSync(path.join(brand, '.omega', 'secrets'), { recursive: true });
          fs.writeFileSync(path.join(brand, '.omega', 'secrets', 'service-account.json'), '{"type":"service_account"}');

          const result = publishTargetSecrets({
            targetDir,
            target: 'backend',
            logger: quiet,
            env: {},
            execFn: (file, args, options) => { gh.push({ args, input: (options || {}).input }); return ''; },
          });

          ctx.expect(result.published.includes('OMEGA_SERVICE_ACCOUNT_JSON')).toBeTruthy();
          const sent = new Map(gh.slice(2).map((call) => [call.args[2], call.input]));
          ctx.expect(sent.get('OMEGA_SERVICE_ACCOUNT_JSON')).toBe('{"type":"service_account"}');
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'seams: web and the extension bring none, so a value travels verbatim',
      run: (ctx) => {
        for (const target of ['web', 'extension']) {
          const { brand, targetDir } = tmpBrand({
            target,
            brandEnv: target === 'web' ? 'OMEGA_LICENSE_KEY=omg_live_fixture\n' : 'CHROME_CLIENT_ID=client-id\n',
            owner: 'acme',
          });
          const gh = [];

          checkout(brand, 'git@github.com:acme/my-brand-omega.git');
          try {
            publishTargetSecrets({
              targetDir,
              target,
              logger: quiet,
              env: {},
              execFn: (file, args, options) => { gh.push({ args, input: (options || {}).input }); return ''; },
            });

            const sent = new Map(gh.slice(2).map((call) => [call.args[2], call.input]));
            ctx.expect(sent.get(target === 'web' ? 'OMEGA_LICENSE_KEY' : 'CHROME_CLIENT_ID')).toBe(target === 'web' ? 'omg_live_fixture' : 'client-id');
          } finally {
            fs.rmSync(brand, { recursive: true, force: true });
          }
        }
      },
    },

    // ─── --dry-run (#895) ───────────────────────────────────────────────────────

    {
      name: 'dry run: the key NAMES print and nothing reaches gh',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({
          target: 'extension',
          brandEnv: 'CHROME_CLIENT_ID=client-id\nCHROME_CLIENT_SECRET=client-secret\n',
          owner: 'acme',
        });
        const lines = [];

        checkout(brand, 'git@github.com:acme/my-brand-omega.git');
        try {
          const result = publishTargetSecrets({
            targetDir,
            target: 'extension',
            logger: { log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) },
            env: {},
            dryRun: true,
            // The guards run under a dry run too (#895), so the checkout has to be
            // the brand's own for a plan to be printed at all.
            execFn: noExec,
          });

          ctx.expect(result.planned.sort()).toEqual(['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET']);
          const plan = lines.find((line) => line.includes('DRY RUN'));
          ctx.expect(plan.includes('CHROME_CLIENT_ID'), 'the plan names the keys').toBeTruthy();
          ctx.expect(!lines.some((line) => line.includes('client-secret')), 'and never a value').toBeTruthy();
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'dry run: a refusal still THROWS, because a plan that cannot be made is loud',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({ target: 'desktop', brandEnv: 'CSC_KEY_PASSWORD=pw\n', owner: 'acme' });

        try {
          // The brand DECLARES Apple signing, so the mac set is required, and no
          // signing tree can value it.
          fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), [
            '{',
            "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
            "  repo: { owner: 'acme' },",
            '  certificates: { providers: { apple: { teamId: "TEAMTEST12" } } },',
            '  targets: { desktop: {} },',
            '}',
          ].join('\n'));

          ctx.expect(() => publishTargetSecrets({ targetDir, target: 'desktop', logger: quiet, env: {}, dryRun: true, execFn: noExec })).toThrow((error) => {
              ctx.expect(error.message).toMatch(/Nothing was published/);
              ctx.expect(error.message).toMatch(/CSC_LINK/);
              ctx.expect(error.message, 'and the fix names the walk that produces the file').toMatch(/omega manage --service certificates/);
              return true;
            });
        } finally {
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    // #895: the values compose for PRODUCTION(the run that reads them is a
    // release build), so the RULES have to be read for production too. Judged
    // against the ambient overlay instead, a developer machine's
    // `config/omega.development.json5` decided whether the publish refused.
    {
      name: 'refusals are judged against the PRODUCTION config, never this shell\'s overlay',
      run: (ctx) => {
        const { brand, targetDir } = tmpBrand({ target: 'desktop', brandEnv: 'CSC_KEY_PASSWORD=pw\n', owner: 'acme' });
        const saved = { ENVIRONMENT: process.env.ENVIRONMENT, OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT };

        try {
          // The brand DECLARES Apple signing, so the mac set is required and no
          // signing tree can value it.
          fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), [
            '{',
            "  brand: { id: 'my-brand', name: 'My Brand', url: 'https://my.brand' },",
            "  repo: { owner: 'acme' },",
            '  certificates: { providers: { apple: { teamId: "TEAMTEST12" } } },',
            '  targets: { desktop: {} },',
            '}',
          ].join('\n'));

          // ... and switches it off for DEVELOPMENT, where nothing is ever signed.
          fs.writeFileSync(path.join(brand, 'config', 'omega.development.json5'), [
            '{',
            '  certificates: { providers: { apple: false } },',
            '}',
          ].join('\n'));

          delete process.env.OMEGA_ENVIRONMENT;
          process.env.ENVIRONMENT = 'development';

          ctx.expect(() => publishTargetSecrets({ targetDir, target: 'desktop', logger: quiet, env: {}, dryRun: true, execFn: noExec })).toThrow((error) => {
              ctx.expect(error.message).toMatch(/Nothing was published/);
              ctx.expect(error.message, 'the production declaration is what the publish owes').toMatch(/CSC_LINK/);
              return true;
            });
        } finally {
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          fs.rmSync(brand, { recursive: true, force: true });
        }
      },
    },

    // #895: a dry run is the REAL preview, refusals included: the guards above the
    // send are reads, so a plan that names keys the real run would never publish is
    // a promise the deploy cannot keep.
    {
      name: 'dry run: a guard that would SKIP or REFUSE the publish does the same to the plan',
      run: (ctx) => {
        const mismatched = tmpBrand({ target: 'extension', brandEnv: 'CHROME_CLIENT_ID=client-id\n', owner: 'acme' });
        const silent = tmpBrand({ target: 'extension', brandEnv: 'CHROME_CLIENT_ID=client-id\n' });
        const lines = [];
        const logger = { log: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
        checkout(mismatched.brand, 'git@github.com:stranger/other.git');

        try {
          // A drifted origin refuses the plan exactly as it refuses the send (#934)
          ctx.expect(() => publishTargetSecrets({
              targetDir: mismatched.targetDir,
              target: 'extension',
              logger,
              env: {},
              dryRun: true,
              execFn: noExec,
            }), 'the preview carries the refusal, naming the checkout it is standing in').toThrow(/^origin is stranger\/other but config derives acme\/my-brand-omega: /);
          ctx.expect(!lines.some((line) => line.includes('DRY RUN')), 'no plan is printed for a publish that would not happen').toBeTruthy();

          // A brand naming no repo at all skips the same way under a dry run
          lines.length = 0;
          const undeclared = publishTargetSecrets({
            targetDir: silent.targetDir,
            target: 'extension',
            logger,
            env: {},
            dryRun: true,
            execFn: noExec,
          });

          ctx.expect(undeclared).toEqual({ skipped: 'no-declared-repo' });
          ctx.expect(!lines.some((line) => line.includes('DRY RUN'))).toBeTruthy();
        } finally {
          fs.rmSync(mismatched.brand, { recursive: true, force: true });
          fs.rmSync(silent.brand, { recursive: true, force: true });
        }
      },
    },
  ],
});
