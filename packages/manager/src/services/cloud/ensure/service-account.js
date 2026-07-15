/**
 * Ensure the Firebase Admin SDK service account exists with the roles @omega.js/backend
 * needs, and its key is downloaded.
 *
 * Google shows service account keys ONCE at creation — they can't be
 * re-downloaded. The key's ONE home is the brand's gitignored
 * .omega/secrets/service-account.json — the backend's stage step (`omega
 * build`, src/dist pillar) reads it from there and carries it into the
 * staged dist/ tree; no per-app copy exists anymore.
 *
 * The IAM role grant diffs the policy first (omega-manager PUT the policy on
 * every run) — a converged account is a zero-mutation no-op.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const { dryRunPlan } = require('../../../lib/run-gates.js');

const REQUIRED_ROLES = [
  'roles/firebase.admin',
  'roles/firebaseauth.admin',
  'roles/datastore.owner',
  'roles/serviceusage.serviceUsageConsumer',
];

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

    return { state: { serviceAccount: { email: serviceAccountEmail } } };
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
        return { status: 'warned', output: { serviceAccount: { error: error.message } } };
      }
    }
  }

  try {
    await ensureRoles(api, projectId, serviceAccountEmail, options);
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} Could not verify roles${chalk.dim(`: ${error.message}`)}`);
  }

  // === Create + download a new key (up to 10 per account) ===
  if (options.dryRun) {
    dryRunPlan('create + download a service account key');
    return {
      state: { serviceAccount: { email: serviceAccountEmail } },
      output: { serviceAccount: { planned: 'create-key' } },
    };
  }

  console.log('      Creating service account key...');
  try {
    const keyData = await api.createServiceAccountKey(projectId, serviceAccountEmail);

    jetpack.write(sourceKeyPath, keyData);
    console.log(`      ${chalk.green('✓')} Saved key to ${chalk.cyan('.omega/secrets/')}`);

    return { state: { serviceAccount: { email: serviceAccountEmail } } };
  } catch (error) {
    if (error.message?.includes('not allowed') || error.message?.includes('policy')) {
      console.log(`      ${chalk.yellow('⚠')} Key creation blocked by organization policy`);
      console.log(`      ${chalk.dim('→')} Download manually: ${chalk.cyan(`https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`)}`);
    } else {
      console.log(`      ${chalk.yellow('⚠')} Could not create key${chalk.dim(`: ${error.message}`)}`);
    }
    return {
      status: 'warned',
      state: { serviceAccount: { email: serviceAccountEmail } },
      output: { serviceAccount: { error: error.message } },
    };
  }
};
