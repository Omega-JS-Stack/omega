/**
 * Ensure required Google Cloud APIs are enabled + the compute service account
 * carries the roles Cloud Functions deploys need.
 *
 * omega-manager batch-enabled the full list on every run; this reads the
 * enabled set first and only enables what's missing, so a converged project
 * is a zero-mutation no-op. The IAM grant was already diff-based — kept.
 */
const chalk = require('chalk').default;
const { dryRunPlan } = require('../../../lib/run-gates.js');

const REQUIRED_SERVICES = [
  'serviceusage.googleapis.com', // Must be first — Firebase CLI v15.20.0+ pre-flight checks require it
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'firebasestorage.googleapis.com',
  'firebasehosting.googleapis.com',
  'firebasedatabase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'cloudfunctions.googleapis.com',
  'cloudbuild.googleapis.com',
  'run.googleapis.com',
  'artifactregistry.googleapis.com',
  'iap.googleapis.com', // OAuth consent screen
  'recaptchaenterprise.googleapis.com',
  'fcm.googleapis.com', // Firebase Cloud Messaging V1 API
];

// Roles the default compute service account needs for Cloud Functions deploys
const COMPUTE_ROLES = [
  'roles/storage.objectAdmin',
  'roles/cloudbuild.builds.builder',
  'roles/artifactregistry.writer',
];

module.exports = async function ensureServices(context) {
  const { firebaseApi: api, projectId, options = {} } = context;

  // === READ ===
  const enabledServices = await api.listEnabledServices(projectId);
  const missing = REQUIRED_SERVICES.filter((s) => !enabledServices.includes(s));

  // === WRITE: enable missing APIs ===
  if (missing.length === 0) {
    console.log(`      ${chalk.green('✓')} All ${chalk.bold(REQUIRED_SERVICES.length)} required APIs enabled`);
  } else if (options.dryRun) {
    dryRunPlan(`enable ${missing.length} API(s): ${missing.join(', ')}`);
  } else {
    console.log(`      Enabling ${chalk.bold(missing.length)} missing API(s)...`);
    try {
      await api.enableServices(projectId, missing);
      console.log(`      ${chalk.green('✓')} Enabled ${chalk.bold(missing.length)} APIs`);
    } catch (error) {
      // Batch can fail on partially-restricted projects — fall back per-service
      console.log(`      ${chalk.yellow('⚠')} Batch enable failed, trying individually...`);

      for (const service of missing) {
        try {
          await api.enableService(projectId, service);
        } catch (err) {
          console.log(`      ${chalk.yellow('⚠')} ${chalk.cyan(service)}${chalk.dim(`: ${err.message}`)}`);
        }
      }
    }
  }

  // === WRITE: compute service account roles (diff-based) ===
  try {
    const projectNumber = await api.getProjectNumber(projectId);
    const member = `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`;

    const policy = await api.getIamPolicy(projectId);
    let changed = false;

    for (const role of COMPUTE_ROLES) {
      const binding = policy.bindings?.find((b) => b.role === role);
      if (binding) {
        if (!binding.members?.includes(member)) {
          binding.members.push(member);
          changed = true;
        }
      } else {
        policy.bindings = policy.bindings || [];
        policy.bindings.push({ role, members: [member] });
        changed = true;
      }
    }

    if (changed) {
      if (options.dryRun) {
        dryRunPlan('grant compute service account deploy roles');
      } else {
        await api.setIamPolicy(projectId, policy);
        console.log(`      ${chalk.green('✓')} Granted compute service account deploy roles`);
      }
    }
  } catch (error) {
    // Non-fatal — the account may already have the roles or the project structure differs
    console.log(`      ${chalk.yellow('⚠')} Could not verify compute roles${chalk.dim(`: ${error.message}`)}`);
  }

  return { output: { services: { required: REQUIRED_SERVICES.length, enabled: missing.length } } };
};
