/**
 * Ensure the Firebase Admin SDK service account exists with the roles @omega.js/backend
 * needs, and its key is downloaded.
 *
 * Google shows service account keys ONCE at creation — they can't be
 * re-downloaded. The key's ONE home is the brand's gitignored
 * .omega/secrets/service-account.json — the backend's stage step (`omega
 * build`, src/dist pillar) reads it from there and carries it into the
 * staged dist/ tree; no per-target copy exists anymore.
 *
 * The IAM role grant diffs the policy first (omega-manager PUT the policy on
 * every run) — a converged account is a zero-mutation no-op.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { dryRunPlan } = require('../../../lib/run-gates.js');
const { appEngineDefaultAccount, computeDefaultAccount } = require('../lib/runtime-accounts.js');

const REQUIRED_ROLES = [
  'roles/firebase.admin',
  'roles/firebaseauth.admin',
  'roles/datastore.owner',
  'roles/serviceusage.serviceUsageConsumer',
  // A scheduled function's deploy upserts its Cloud Scheduler job, which firebase.admin does not cover (#878).
  'roles/cloudscheduler.admin',
];

// The deploy role (#878), granted ON the runtime accounts a functions deploy
// acts as, never on the project policy, where it would count for nothing.
const ACT_AS_ROLE = 'roles/iam.serviceAccountUser';

/**
 * Grant any missing REQUIRED_ROLES to the account. Reads the policy, diffs,
 * and only writes when a binding actually changed.
 */
async function ensureRoles(api, projectId, serviceAccountEmail, options) {
  const member = `serviceAccount:${serviceAccountEmail}`;
  const policy = await api.getIamPolicy(projectId);
  let changed = false;

  for (const role of REQUIRED_ROLES) {
    let binding = policy.bindings?.find((b) => b.role === role);
    if (!binding) {
      binding = { role, members: [] };
      policy.bindings = policy.bindings || [];
      policy.bindings.push(binding);
    }
    if (!binding.members.includes(member)) {
      binding.members.push(member);
      changed = true;
    }
  }

  if (!changed) {
    console.log(`      ${chalk.green('✓')} IAM roles verified`);
    return;
  }

  if (options.dryRun) {
    return dryRunPlan('grant missing IAM roles');
  }

  await api.setIamPolicy(projectId, policy);
  console.log(`      ${chalk.green('✓')} Granted IAM roles`);
}

/**
 * Grant the account `roles/iam.serviceAccountUser` on the two default runtime
 * service accounts a Cloud Functions deploy acts as (#878): the App Engine
 * default account (gen 1 + the deploy's own preflight) and the compute default
 * account (gen 2). A laptop deploy never needed it, because the developer's own
 * login is Owner; a RUNNER deploys as this key and stops at
 * "Missing permissions required for functions deploy" without it.
 *
 * Reads each account's own policy and writes only when the binding is missing.
 * A read or a write that throws is LOUD: the operation carries a warned status
 * out and the by-hand grant is printed, because a silent skip here surfaces as
 * a red deploy nobody can explain.
 *
 * @param {object} api - The FirebaseAPI surface.
 * @param {string} projectId - The brand's project.
 * @param {string} serviceAccountEmail - The deploy account being granted.
 * @param {object} options - The run options (`dryRun`).
 * @returns {Promise<{ status: string, reason: string }|undefined>} A warned
 *   marker the caller merges into its result, or nothing when all is well.
 */
async function ensureActAs(api, projectId, serviceAccountEmail, options) {
  const member = `serviceAccount:${serviceAccountEmail}`;
  // Null until the loop reaches an account, so a failure before the first read
  // is attributed to the lookup and not to an account nobody touched
  let target = null;

  try {
    const projectNumber = await api.getProjectNumber(projectId);
    const accounts = [appEngineDefaultAccount(projectId), computeDefaultAccount(projectNumber)];
    let planned = false;
    let granted = false;

    for (const account of accounts) {
      target = account;

      const policy = await api.getServiceAccountIamPolicy(projectId, account);
      policy.bindings = policy.bindings || [];

      let binding = policy.bindings.find((b) => b.role === ACT_AS_ROLE);
      if (binding && binding.members.includes(member)) {
        continue;
      }

      if (!binding) {
        binding = { role: ACT_AS_ROLE, members: [] };
        policy.bindings.push(binding);
      }
      binding.members.push(member);

      if (options.dryRun) {
        planned = true;
        continue;
      }

      await api.setServiceAccountIamPolicy(projectId, account, policy);
      granted = true;
    }

    if (planned) {
      return dryRunPlan(`grant ${ACT_AS_ROLE} on the default service accounts`);
    }

    console.log(`      ${chalk.green('✓')} ${granted ? 'Granted the deploy role' : 'Deploy role verified'}`);
  } catch (error) {
    if (!target) {
      // The lookup that names the compute account failed, so no account was read
      console.log(`      ${chalk.yellow('⚠')} Could not resolve the project number for the deploy role grant${chalk.dim(`: ${error.message}`)}`);

      return { status: 'warned', reason: `could not grant ${ACT_AS_ROLE}: the project number lookup failed` };
    }

    console.log(`      ${chalk.yellow('⚠')} Could not grant the deploy role on ${target}${chalk.dim(`: ${error.message}`)}`);
    console.log(`      ${chalk.dim('→')} Grant it by hand: ${chalk.cyan(`gcloud iam service-accounts add-iam-policy-binding ${target} --project ${projectId} --member="${member}" --role="${ACT_AS_ROLE}"`)}`);

    return { status: 'warned', reason: `could not grant ${ACT_AS_ROLE} on ${target}` };
  }
}

module.exports = async function ensureServiceAccount(context) {
  const { firebaseApi: api, brandConfig, brandRoot, projectId, options = {} } = context;
  const brandName = brandConfig.brand?.name || context.brandId;

  // The key's ONE home — the backend stage step reads it from here
  const sourceKeyPath = join(brandRoot, '.omega', 'secrets', 'service-account.json');

  // === Key already downloaded — verify roles ===
  if (jetpack.exists(sourceKeyPath)) {
    const existingKey = jetpack.read(sourceKeyPath, 'json');
    const serviceAccountEmail = existingKey?.client_email;

    console.log(`      ${chalk.green('✓')} Service account key exists`);

    try {
      await ensureRoles(api, projectId, serviceAccountEmail, options);
    } catch (error) {
      console.log(`      ${chalk.yellow('⚠')} Could not verify roles${chalk.dim(`: ${error.message}`)}`);
    }

    const actAsWarning = await ensureActAs(api, projectId, serviceAccountEmail, options);

    return { ...(actAsWarning || {}), state: { serviceAccount: { email: serviceAccountEmail } } };
  }

  // === Find or create the firebase-adminsdk account ===
  // Firebase Console creates these with random suffixes (firebase-adminsdk-abc12@…)
  const existingAccounts = await api.listServiceAccounts(projectId);
  const existing = existingAccounts.find((a) => a.email.startsWith('firebase-adminsdk'));
  let serviceAccountEmail;

  if (existing) {
    serviceAccountEmail = existing.email;
    console.log(`      ${chalk.green('✓')} Service account exists`);
  } else {
    serviceAccountEmail = `firebase-adminsdk@${projectId}.iam.gserviceaccount.com`;

    if (options.dryRun) {
      return dryRunPlan('create service account + key', { output: { serviceAccount: { planned: 'create' } } });
    }

    console.log('      Creating service account...');
    try {
      await api.createServiceAccount(projectId, 'firebase-adminsdk', `Firebase Admin SDK Service Account for ${brandName}`);
      console.log(`      ${chalk.green('✓')} Created service account`);

      // Eventual consistency — the account isn't immediately grantable
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      if (!error.message?.includes('already exists')) {
        console.log(`      ${chalk.yellow('⚠')} Could not create service account${chalk.dim(`: ${error.message}`)}`);
        return { status: 'warned', reason: 'could not create the service account', output: { serviceAccount: { error: error.message } } };
      }
    }
  }

  try {
    await ensureRoles(api, projectId, serviceAccountEmail, options);
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not verify roles${chalk.dim(`: ${error.message}`)}`);
  }

  const actAsWarning = await ensureActAs(api, projectId, serviceAccountEmail, options);

  // === Create + download a new key (up to 10 per account) ===
  if (options.dryRun) {
    dryRunPlan('create + download a service account key');
    return {
      ...(actAsWarning || {}),
      state: { serviceAccount: { email: serviceAccountEmail } },
      output: { serviceAccount: { planned: 'create-key' } },
    };
  }

  console.log('      Creating service account key...');
  try {
    const keyData = await api.createServiceAccountKey(projectId, serviceAccountEmail);

    jetpack.write(sourceKeyPath, keyData);
    console.log(`      ${chalk.green('✓')} Saved key to ${chalk.cyan('.omega/secrets/')}`);

    return { ...(actAsWarning || {}), state: { serviceAccount: { email: serviceAccountEmail } } };
  } catch (error) {
    if (error.message?.includes('not allowed') || error.message?.includes('policy')) {
      console.log(`      ${chalk.yellow('⚠')} Key creation blocked by organization policy`);
      console.log(`      ${chalk.dim('→')} Download manually: ${chalk.cyan(`https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`)}`);
    } else {
      console.log(`      ${chalk.yellow('⚠')} Could not create key${chalk.dim(`: ${error.message}`)}`);
    }
    return {
      status: 'warned',
      reason: 'could not create the service account key',
      state: { serviceAccount: { email: serviceAccountEmail } },
      output: { serviceAccount: { error: error.message } },
    };
  }
};
