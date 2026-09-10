const BaseCommand = require('./base-command');
const chalk = require('chalk').default;
const powertools = require('node-powertools');
const attachLogFile = require('../utils/attach-log-file');
const stageLocalPackages = require('../utils/stage-local-packages');
const path = require('path');
const jetpack = require('fs-jetpack');
const { refuseWhenCustom } = require('../utils/project-type');
const { loadConfig, loadEnv } = require('@omega.js/config');
const { resolveLicenseStamp } = require('@omega.js/devkit/license');

const DEFAULT_REGION = 'us-central1';

class DeployCommand extends BaseCommand {
  async execute() {
    const self = this.main;

    // Custom-server mode has no Cloud Functions to publish (#584) — refuse
    // before staging, so nothing is written for a deploy that cannot happen.
    if (refuseWhenCustom(self.firebaseProjectPath, 'deploy')) return;

    const logPath = this.getLogsPath('deploy.log');
    attachLogFile(logPath);
    this.log(chalk.gray(`  Logs saving to: ${logPath}\n`));

    // The .env cascade, loaded HERE because nothing else in the CLI boot does:
    // the license key below is read from this process's environment, and a
    // licensed brand keeps OMEGA_LICENSE_KEY in the brand root's .env. Named
    // `production` — the same environment the stage below composes dist/.env
    // for (#586), so the verdict and the artifact read one overlay.
    loadEnv(path.join(self.firebaseProjectPath, 'dist'), { environment: 'production' });

    // The license check ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)),
    // once per deploy and BEFORE the stage: a backend deploy runs straight
    // from the CLI, so the key comes out of the .env cascade in this process
    // and never near the artifact. The verdict itself rides the composed
    // dist/.env as OMEGA_LICENSE_STATUS — a keyless deploy gates the payment
    // provider libraries at runtime. A key that cannot be answered for throws
    // here, which stops the deploy rather than shipping the wrong verdict.
    const licenseStatus = (await resolveLicenseStamp({
      config: loadConfig(self.firebaseProjectPath, 'backend').config,
      production: true,
    })).status;
    this.log(chalk.gray(`  License: ${licenseStatus}\n`));

    // dist/ is staged output (src/dist pillar): a fresh stage carries the
    // composed config + public/ hosting boilerplate across the upload boundary.
    // The upload is composed for PRODUCTION — base .env + `.env.production`,
    // and no other environment's overlay ever rides along (#586).
    this.ensureStaged({ environment: 'production', licenseStatus });

    // --only pass-through (e.g. `omega deploy --only hosting` — deploys
    // hosting on Spark plans where functions would demand Blaze)
    const only = self.argv?.only ? ` --only ${self.argv.only}` : '';

    // Local file: dependencies (local-first @omega.js packages) can't be
    // followed by Cloud Build — stage them into the upload as packed tarballs
    const firebaseJSON = jetpack.read(path.join(self.firebaseProjectPath, 'firebase.json'), 'json') || {};
    const functionsBlock = Array.isArray(firebaseJSON.functions) ? firebaseJSON.functions[0] : firebaseJSON.functions;
    const functionsPath = path.join(self.firebaseProjectPath, functionsBlock?.source || 'dist');
    const deployingFunctions = !self.argv?.only || String(self.argv.only).split(',').some((t) => t.trim().startsWith('functions'));

    // Without an Artifact Registry cleanup policy, firebase deploy EXITS 1
    // after a successful functions deploy — and the post-steps below (public
    // invoker) never run. Ensure it up front.
    if (deployingFunctions) {
      await this.ensureArtifactCleanupPolicy();
    }

    const staging = deployingFunctions
      ? await stageLocalPackages({ functionsPath, log: (message) => this.log(message) })
      : null;

    try {
      await powertools.execute(`firebase deploy${only}`, {
        log: false,
        config: {
          cwd: self.firebaseProjectPath,
          stdio: ['inherit', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '1' },
        },
      }, (child) => {
        child.stdout.on('data', (data) => process.stdout.write(data));
        child.stderr.on('data', (data) => process.stderr.write(data));
      });

      require('@omega.js/devkit/deploy-record').recordDeploy({ dir: self.firebaseProjectPath, target: 'backend', detail: { method: 'firebase' } });

      // After successful deploy, ensure HTTP functions are publicly invocable
      await this.ensurePublicInvoker();
    } finally {
      if (staging) {
        await staging.restore();
      }
      await attachLogFile.detach();
    }
  }

  /**
   * Ensure the Artifact Registry cleanup policy exists (old container images
   * auto-delete). Best-effort: Spark plans, a disabled API, or a first-ever
   * deploy (no gcf-artifacts repo yet) just skip — deploy proceeds either way.
   */
  async ensureArtifactCleanupPolicy() {
    try {
      await powertools.execute('firebase functions:artifacts:setpolicy --force', {
        log: false,
        config: { cwd: this.main.firebaseProjectPath },
      });
      this.log(chalk.gray('  Artifact cleanup policy ensured\n'));
    } catch (e) {
      // Non-fatal — the deploy itself doesn't need the policy
    }
  }

  /**
   * Ensure all HTTP-triggered functions have allUsers as cloudfunctions.invoker.
   *
   * Firebase CLI used to set this automatically but stopped around the Node 10
   * runtime transition. Without it, HTTP requests get a 403 at the IAM level
   * before @omega.js/backend's application-level auth (the omega-admin-key header) can run.
   *
   * Dynamically discovers all deployed functions via gcloud and fixes any
   * HTTP-triggered function missing the allUsers invoker binding.
   */
  async ensurePublicInvoker() {
    const projectId = this.getProjectId();

    if (!projectId) {
      return;
    }

    // Discover all deployed HTTP-triggered functions
    let httpFunctions;

    try {
      const output = await powertools.execute(
        `gcloud functions list --project ${projectId} --regions ${DEFAULT_REGION} --format="json(name,httpsTrigger)"`,
        { log: false },
      );

      httpFunctions = JSON.parse(output)
        .filter((fn) => fn.httpsTrigger)
        .map((fn) => fn.name.split('/').pop());
    } catch {
      return;
    }

    if (!httpFunctions.length) {
      return;
    }

    this.log(chalk.gray('\n  Ensuring HTTP functions are publicly invocable...\n'));

    let fixed = 0;
    let ok = 0;

    for (const fnName of httpFunctions) {
      try {
        const policyOutput = await powertools.execute(
          `gcloud functions get-iam-policy ${fnName} --project ${projectId} --region ${DEFAULT_REGION} --format=json`,
          { log: false },
        );

        const policy = JSON.parse(policyOutput);
        const hasAllUsers = (policy.bindings || []).some(
          (b) => b.role === 'roles/cloudfunctions.invoker'
            && (b.members || []).includes('allUsers'),
        );

        if (hasAllUsers) {
          ok++;
          continue;
        }

        await powertools.execute(
          `gcloud functions add-iam-policy-binding ${fnName} --project ${projectId} --region ${DEFAULT_REGION} --member="allUsers" --role="roles/cloudfunctions.invoker"`,
          { log: false },
        );

        this.log(`  ${chalk.green('✓')} Set public invoker on ${chalk.cyan(fnName)}`);
        fixed++;
      } catch {
        // Skip silently — function may be in a transient state
      }
    }

    if (fixed > 0) {
      this.log(`  ${chalk.green('✓')} Public invoker: ${ok + fixed} functions accessible (${fixed} just fixed)\n`);
    } else if (ok > 0) {
      this.log(`  ${chalk.green('✓')} Public invoker: ${ok} functions accessible\n`);
    }
  }

  getProjectId() {
    try {
      const firebaserc = jetpack.read(path.join(this.main.firebaseProjectPath, '.firebaserc'), 'json');
      return firebaserc?.projects?.default;
    } catch {
      return null;
    }
  }
}

module.exports = DeployCommand;
