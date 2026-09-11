/**
 * Test: the backend's push-secrets bind, the precheck step that makes a CI
 * deploy possible at all ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * Backend had no precheck while its deploy ran from the CLI. It runs on a
 * RUNNER now, and a runner has neither the brand's `.env` nor the
 * service-account key, so both have to travel as repo secrets: the composed
 * target env over the shared publisher, and the key FILE as
 * OMEGA_SERVICE_ACCOUNT_JSON over the extra-secrets seam, because a file has no
 * `.env` line to compose from.
 *
 * Web, desktop and the extension each pin their own bind (desktop's
 * `build/push-secrets` suite is the shape this mirrors); this is backend's.
 * What the shared publisher owns (the loud skips, the declared-repo guard) is
 * pinned once in @omega.js/devkit's target-secrets suite.
 *
 * Offline by construction: the brand is a temp dir and the `gh`/`git`
 * boundaries are injected, so the real send shape is proven without a repo, a
 * credential or a network.
 *
 * Run: npx omega test backend:cli/push-secrets
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const pushSecrets = require('../../dist/cli/utils/push-secrets.js');
const { deployPrecheck, STEPS } = require('../../dist/cli/utils/deploy-precheck.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const quiet = { log() {}, warn() {}, error() {} };

/** A brand root (config/omega.json5) with a targets/backend target under it. */
function seedBrand({ brandEnv, repo } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-secrets-')));
  const targetDir = path.join(root, 'targets', 'backend');

  jetpack.write(path.join(root, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    ...(repo ? { repo: { providers: { github: { repo } } } } : {}),
    targets: { backend: {} },
  }));
  if (brandEnv !== undefined) jetpack.write(path.join(root, '.env'), brandEnv);
  jetpack.dir(targetDir);

  return { root, targetDir };
}

/**
 * A `git` stub that answers PER COMMAND. The publisher resolves the deploy lane
 * before it guards (#872), so `rev-parse --show-toplevel` has to answer that
 * this checkout IS the brand root: an unplaced answer reads as a NESTED brand,
 * whose mismatch guard is skipped by design.
 *
 * @param {string} remote - What `git config --get remote.origin.url` answers.
 * @returns {function} `(command, options) => string`
 */
function gitStub(remote) {
  return (command, options) => {
    if (command.includes('rev-parse')) return `${options.cwd}\n`;
    return remote;
  };
}

/** Publish with both boundaries injected, returning the recorded `gh` calls. */
function publish(targetDir, gh) {
  return pushSecrets.publishEnvSecrets({
    targetDir,
    logger: quiet,
    env: {},
    gitExecFn: gitStub('git@github.com:acme/app.git\n'),
    execFn: (file, args, options) => { gh.push({ file, args, input: options.input }); return ''; },
  });
}

module.exports = defineCases({
  description: 'backend push-secrets (#872): the composed env plus the service-account FILE',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the-service-account-file-travels-as-its-own-secret',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          repo: 'acme/app',
          brandEnv: 'OMEGA_ADMIN_KEY="brand-admin"\nOMEGA_LICENSE_KEY="omg_live_brand"\n',
        });
        // The key's ONE home in a brand monorepo: the firebase manage service
        // mints it there, and Google shows a key once.
        const key = JSON.stringify({ type: 'service_account', project_id: 'fixture-live' });
        jetpack.write(path.join(root, '.omega', 'secrets', 'service-account.json'), key);

        const gh = [];
        try {
          const result = publish(targetDir, gh);

          assert.ok(result.published.includes('OMEGA_SERVICE_ACCOUNT_JSON'), 'the runner cannot authenticate without it');
          assert.ok(result.published.includes('OMEGA_ADMIN_KEY'), 'the runtime keys ride too, so the workflow can write the .env');
          assert.ok(result.published.includes('OMEGA_LICENSE_KEY'), 'and the license key, so the runner resolves a verdict instead of keyless (#320)');

          // The CONTENTS travel, never this laptop's path to the file, and
          // every value goes on stdin rather than argv.
          const sent = gh.find((call) => call.args.includes('OMEGA_SERVICE_ACCOUNT_JSON'));
          assert.equal(sent.input, key, 'the key file is published verbatim');
          assert.deepEqual(sent.args, ['secret', 'set', 'OMEGA_SERVICE_ACCOUNT_JSON', '--repo', 'acme/app']);
          assert.equal(gh.every((call) => call.file === 'gh'), true, 'one transport: the gh CLI');
          assert.deepEqual(gh[0].args, ['auth', 'status'], 'an unusable gh fails before anything is sent');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'collectEnvSecrets-composes-the-brand-env-and-adds-the-key-file',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({
          repo: 'acme/app',
          brandEnv: 'OMEGA_ADMIN_KEY="brand-admin"\nOMEGA_LICENSE_KEY="omg_live_brand"\n',
        });
        jetpack.write(path.join(root, '.omega', 'secrets', 'service-account.json'), '{"type":"service_account"}');

        try {
          const secrets = pushSecrets.collectEnvSecrets(targetDir);

          assert.equal(secrets.OMEGA_ADMIN_KEY, 'brand-admin', 'the brand-root .env supplies the target');
          assert.equal(secrets.OMEGA_LICENSE_KEY, 'omg_live_brand');
          assert.equal(secrets.OMEGA_SERVICE_ACCOUNT_JSON, '{"type":"service_account"}', 'the key FILE rides as one more secret');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'declaredBrandRepo-reads-the-config-and-is-null-when-nothing-is-declared',
      auth: 'none',

      async run({ assert }) {
        const declared = seedBrand({ repo: 'acme/app' });
        const undeclared = seedBrand();

        try {
          assert.equal(pushSecrets.declaredBrandRepo(declared.targetDir), 'acme/app');
          assert.equal(pushSecrets.declaredBrandRepo(undeclared.targetDir), null, 'an inferred remote is never a declaration');
        } finally {
          jetpack.remove(declared.root);
          jetpack.remove(undeclared.root);
        }
      },
    },

    {
      name: 'a-standalone-target-root-key-is-the-first-stop-of-the-chain',
      auth: 'none',

      async run({ assert }) {
        const { root, targetDir } = seedBrand({ repo: 'acme/app', brandEnv: 'OMEGA_ADMIN_KEY="brand-admin"\n' });
        jetpack.write(path.join(root, '.omega', 'secrets', 'service-account.json'), '{"type":"service_account","project_id":"brand"}');
        jetpack.write(path.join(targetDir, 'service-account.json'), '{"type":"service_account","project_id":"target"}');

        try {
          assert.deepEqual(
            pushSecrets.serviceAccountSecret(targetDir),
            { OMEGA_SERVICE_ACCOUNT_JSON: '{"type":"service_account","project_id":"target"}' },
            'the target root owns its copy when it has one, the same chain the stage reads',
          );
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'no-minted-key-publishes-no-key-secret',
      auth: 'none',

      // A brand that has not minted one yet deploys from a runner that cannot
      // authenticate, and the MISSING secret is what says so. Publishing an
      // empty one would look like a credential and fail at `firebase deploy`.
      async run({ assert }) {
        const { root, targetDir } = seedBrand({ repo: 'acme/app', brandEnv: 'OMEGA_ADMIN_KEY="brand-admin"\n' });

        const gh = [];
        try {
          assert.deepEqual(pushSecrets.serviceAccountSecret(targetDir), {}, 'no file, no key');

          const result = publish(targetDir, gh);
          assert.equal(result.published.includes('OMEGA_SERVICE_ACCOUNT_JSON'), false, 'nothing invents a credential');
          assert.ok(result.published.includes('OMEGA_ADMIN_KEY'), 'the rest of the set still publishes');
        } finally {
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'no-secrets-skips-the-whole-precheck',
      auth: 'none',

      // The same opt-out name web, desktop and the extension honor. On backend
      // the flag used to be accepted and ignored.
      async run({ assert }) {
        const { root, targetDir } = seedBrand({ repo: 'acme/app', brandEnv: 'OMEGA_ADMIN_KEY="brand-admin"\n' });
        const ran = [];

        try {
          const skipped = await deployPrecheck({
            projectDir: targetDir,
            options: { secrets: false },
            logger: quiet,
            steps: [{ name: 'push-secrets', run: () => ran.push('push-secrets') }],
          });

          assert.deepEqual(skipped, { skipped: 'opt-out' });
          assert.deepEqual(ran, [], 'no step runs, so a deploy needs no gh auth at all');

          const withSecrets = await deployPrecheck({
            projectDir: targetDir,
            options: {},
            logger: quiet,
            steps: [{ name: 'push-secrets', run: () => ran.push('push-secrets') }],
          });

          assert.deepEqual(withSecrets, { ran: ['push-secrets'] }, 'and the default still publishes');
          assert.deepEqual(ran, ['push-secrets']);

          // The real list, so the bind itself is pinned and not just the runner.
          assert.deepEqual(STEPS.map((step) => step.name), ['verify-deploy-roles', 'push-secrets']);
        } finally {
          jetpack.remove(root);
        }
      },
    },
  ],
});
