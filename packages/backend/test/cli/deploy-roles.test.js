/**
 * Test: the deploy-roles precheck step, which predicts the ONE failure a
 * dispatched backend deploy hits that a laptop deploy never did
 * ([#878](https://github.com/Omega-JS-Stack/omega/issues/878)).
 *
 * A runner deploys as the Admin SDK service account. That key carries the
 * project roles the manage walk grants, but a functions deploy also ACTS AS the
 * two default runtime accounts, and `roles/iam.serviceAccountUser` counts only
 * where it is granted: on each runtime account's own policy. Without it the
 * runner stops at "Missing permissions required for functions deploy", after
 * the checkout, the install and the stage.
 *
 * What these tests hold the step to: it reads both policies, it names a missing
 * grant with the exact `add-iam-policy-binding` command, and it is SOFT
 * everywhere else, because a laptop with no gcloud is the ordinary case and a
 * precheck reports rather than blocks.
 *
 * Offline by construction: the brand is a temp dir and `powertools.execute` is
 * swapped for a recorder that answers per command, so no gcloud, no project and
 * no credential is touched.
 *
 * Run: npx omega test backend:cli/deploy-roles
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const powertools = require('node-powertools');

const { verifyDeployRoles } = require('../../dist/cli/utils/deploy-roles.js');
const { deployPrecheck, STEPS } = require('../../dist/cli/utils/deploy-precheck.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const PROJECT = 'fixture-project';
const PROJECT_NUMBER = '987654321';
const CLIENT_EMAIL = `firebase-adminsdk-x1@${PROJECT}.iam.gserviceaccount.com`;
const APPSPOT_SA = `${PROJECT}@appspot.gserviceaccount.com`;
const COMPUTE_SA = `${PROJECT_NUMBER}-compute@developer.gserviceaccount.com`;
const ACT_AS_ROLE = 'roles/iam.serviceAccountUser';

/**
 * A brand root naming the cloud project, with a backend target under it and
 * (unless `key: false`) the minted service-account key in its ONE home.
 *
 * @param {object} [options]
 * @param {boolean} [options.key] - Whether the key exists (default true).
 * @param {boolean} [options.projectId] - Whether the config names one (default true).
 * @returns {{ root: string, targetDir: string }}
 */
function seedBrand({ key = true, projectId = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-roles-')));
  const targetDir = path.join(root, 'targets', 'backend');

  jetpack.write(path.join(root, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    ...(projectId ? { cloud: { config: { projectId: PROJECT } } } : {}),
    targets: { backend: {} },
  }));
  jetpack.dir(targetDir);
  if (key) {
    jetpack.write(path.join(root, '.omega', 'secrets', 'service-account.json'), JSON.stringify({
      type: 'service_account',
      project_id: PROJECT,
      client_email: CLIENT_EMAIL,
    }));
  }

  return { root, targetDir };
}

/** The policy JSON `gcloud ... get-iam-policy --format=json` prints. */
function policyJson(members) {
  return JSON.stringify({
    etag: 'BwXf',
    bindings: members.length ? [{ role: ACT_AS_ROLE, members }] : [],
  });
}

/**
 * A `powertools.execute` recorder answering PER command: the project-number
 * lookup, then each account's policy. `policies` maps a service-account email
 * to the members its policy carries.
 *
 * @param {Object<string, string[]>} policies - email → members.
 * @param {Error} [failWith] - When given, every command throws it.
 * @returns {{ commands: string[], install: function }}
 */
function shellRecorder(policies, failWith) {
  const commands = [];

  return {
    commands,
    install() {
      const original = powertools.execute;
      powertools.execute = async (command) => {
        commands.push(command);
        if (failWith) throw failWith;
        if (command.includes('projects describe')) return `${PROJECT_NUMBER}\n`;
        const account = Object.keys(policies).find((email) => command.includes(email));
        return policyJson(policies[account] || []);
      };
      return () => { powertools.execute = original; };
    },
  };
}

/** A logger that keeps what it was told. */
function recordingLogger() {
  const logged = [];
  const warned = [];
  return {
    logged,
    warned,
    log: (line) => logged.push(String(line)),
    warn: (line) => warned.push(String(line)),
    error: (line) => warned.push(String(line)),
  };
}

module.exports = defineCases({
  description: 'deploy roles (#878): the precheck names the actAs grant a runner deploy needs',
  type: 'group',
  timeout: 60000,

  tests: [
    {
      name: 'both runtime accounts carry the grant: the step reads both policies and says so',
      async run({ assert }) {
        const { root, targetDir } = seedBrand();
        const recorder = shellRecorder({
          [APPSPOT_SA]: [`serviceAccount:${CLIENT_EMAIL}`],
          [COMPUTE_SA]: [`serviceAccount:${CLIENT_EMAIL}`],
        });
        const restore = recorder.install();
        const logger = recordingLogger();

        try {
          await verifyDeployRoles({ targetDir, logger });

          assert.equal(recorder.commands.length, 3, `the describe plus one policy read per account (ran: ${recorder.commands.join(' | ')})`);
          assert.ok(recorder.commands[0].includes(`gcloud projects describe ${PROJECT}`), 'the project number is what names the compute account');
          assert.ok(recorder.commands.some((command) => command.includes(`get-iam-policy ${APPSPOT_SA}`)), 'the App Engine account is read');
          assert.ok(recorder.commands.some((command) => command.includes(`get-iam-policy ${COMPUTE_SA}`)), 'the compute account is read');
          assert.ok(logger.logged.join('\n').includes('Deploy roles verified'), `one verified line (got: ${logger.logged.join(' | ')})`);
          assert.deepEqual(logger.warned, [], 'and nothing to warn about');
        } finally {
          restore();
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'a grant missing on the App Engine account THROWS with the exact gcloud command',
      async run({ assert }) {
        const { root, targetDir } = seedBrand();
        const recorder = shellRecorder({
          [APPSPOT_SA]: [],
          [COMPUTE_SA]: [`serviceAccount:${CLIENT_EMAIL}`],
        });
        const restore = recorder.install();
        const logger = recordingLogger();

        try {
          let thrown = null;
          try {
            await verifyDeployRoles({ targetDir, logger });
          } catch (error) {
            thrown = error;
          }

          assert.ok(thrown, 'a missing grant is a finding, not a log line');
          assert.ok(thrown.message.includes(ACT_AS_ROLE), 'the message names the role');
          assert.ok(thrown.message.includes(APPSPOT_SA), 'and the account it is missing on');
          assert.ok(thrown.message.includes('omega manage'), 'and the walk that grants it');
          assert.ok(
            thrown.message.includes(`gcloud iam service-accounts add-iam-policy-binding ${APPSPOT_SA} --project ${PROJECT} --member="serviceAccount:${CLIENT_EMAIL}" --role="${ACT_AS_ROLE}"`),
            `the by-hand command is exact (got: ${thrown.message})`,
          );
          assert.ok(!thrown.message.includes(`add-iam-policy-binding ${COMPUTE_SA}`), 'the account that already carries it is not named as a fix');
        } finally {
          restore();
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'a gcloud that cannot answer is an ordinary laptop, so it warns and returns',
      async run({ assert }) {
        const { root, targetDir } = seedBrand();
        const recorder = shellRecorder({}, new Error('gcloud: command not found'));
        const restore = recorder.install();
        const logger = recordingLogger();

        try {
          await verifyDeployRoles({ targetDir, logger });

          assert.equal(logger.warned.length, 1, `one warn line (got: ${logger.warned.join(' | ')})`);
          assert.ok(logger.warned[0].includes('Could not verify the deploy roles'), 'named as an unverified check, never as a finding');
          assert.ok(logger.warned[0].includes('gcloud: command not found'), 'carrying what gcloud said');
        } finally {
          restore();
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'no service-account key: the check skips out loud and shells out for nothing',
      async run({ assert }) {
        const { root, targetDir } = seedBrand({ key: false });
        const recorder = shellRecorder({});
        const restore = recorder.install();
        const logger = recordingLogger();

        try {
          await verifyDeployRoles({ targetDir, logger });

          assert.deepEqual(recorder.commands, [], 'there is no identity to check, so nothing is asked');
          assert.equal(logger.logged.length, 1, `one skip line (got: ${logger.logged.join(' | ')})`);
          assert.ok(logger.logged[0].includes('service-account key'), 'which says what is missing');
        } finally {
          restore();
          jetpack.remove(root);
        }
      },
    },

    {
      name: 'through the real precheck runner a missing grant is a WARNING, and the deploy proceeds',
      async run({ assert }) {
        const { root, targetDir } = seedBrand();
        const recorder = shellRecorder({ [APPSPOT_SA]: [], [COMPUTE_SA]: [] });
        const restore = recorder.install();
        const logger = recordingLogger();

        try {
          // Only this step: push-secrets calls `gh`, which a unit run never does.
          const steps = STEPS.filter((step) => step.name === 'verify-deploy-roles');
          assert.equal(steps.length, 1, 'the step is in the real list');

          const result = await deployPrecheck({ projectDir: targetDir, options: {}, logger, steps });

          assert.deepEqual(result.ran, [], 'a step that threw did not finish');
          assert.ok(logger.warned.join('\n').includes('verify-deploy-roles failed during the deploy precheck (non-fatal)'), 'the runner reports it softly');
          assert.ok(logger.warned.join('\n').includes(`add-iam-policy-binding ${APPSPOT_SA}`), 'and the fix reaches the operator');
          assert.deepEqual(STEPS.map((step) => step.name), ['verify-deploy-roles', 'push-secrets'], 'the cheap read runs before the publish');
        } finally {
          restore();
          jetpack.remove(root);
        }
      },
    },
  ],
});
