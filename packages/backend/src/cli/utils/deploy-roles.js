/**
 * deploy-roles: the precheck step that predicts the ONE permission a
 * DISPATCHED deploy needs and a laptop deploy never did
 * ([#878](https://github.com/Omega-JS-Stack/omega/issues/878)).
 *
 * A runner deploys as the Admin SDK service account (the key the brand
 * publishes as `OMEGA_SERVICE_ACCOUNT_JSON`), and that key carries the project
 * roles the manage walk grants. But a Cloud Functions deploy also ACTS AS the
 * runtime accounts the functions run under, and `roles/iam.serviceAccountUser`
 * counts only where it is granted: on each runtime account's OWN policy, never
 * on the project's. On a laptop the developer's Owner login hides that
 * entirely; on a runner it is `Missing permissions required for functions
 * deploy`, after the checkout, the install and the stage.
 *
 * So the check runs FIRST in the precheck, ahead of the secrets publish: two
 * policy reads through `gcloud`, and a missing grant named with the exact
 * command that fixes it. The grant itself belongs to the manage walk (the cloud
 * service's service-account operation); this step only says when it is absent.
 *
 * Soft like every precheck step: a throw is the runner's warning, and a laptop
 * with no `gcloud` (or no key yet) reports that it could not check rather than
 * inventing a finding.
 */
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');
const { loadConfig } = require('@omega.js/config');
const { resolveServiceAccountPath } = require('./stage-functions');

// The role that makes `iam.serviceAccounts.actAs` true, granted ON the account
const ACT_AS_ROLE = 'roles/iam.serviceAccountUser';

/**
 * The by-hand grant, printed verbatim so it can be pasted.
 *
 * @param {string} account - The runtime account the grant is missing on.
 * @param {string} projectId - The brand's cloud project.
 * @param {string} member - The deploy identity, as an IAM member.
 * @returns {string} One `gcloud` command.
 */
function grantCommand(account, projectId, member) {
  return `gcloud iam service-accounts add-iam-policy-binding ${account} --project ${projectId} --member="${member}" --role="${ACT_AS_ROLE}"`;
}

/**
 * Verify the deploy identity may act as both default runtime service accounts.
 *
 * @param {object} options
 * @param {string} options.targetDir - The target root.
 * @param {object} options.logger - `{ log, warn }`.
 * @returns {Promise<void>} Resolves when verified, skipped or unverifiable.
 * @throws {Error} When a grant is genuinely missing, naming the fix.
 */
async function verifyDeployRoles({ targetDir, logger }) {
  const keyPath = resolveServiceAccountPath(targetDir);
  const clientEmail = keyPath ? jetpack.read(keyPath, 'json').client_email : null;

  if (!clientEmail) {
    logger.log('Skipping the deploy role check: no service-account key exists yet (the manage walk mints it)');
    return;
  }

  const projectId = loadConfig(targetDir, 'backend').config.cloud?.config?.projectId;

  if (!projectId) {
    logger.log('Skipping the deploy role check: the config names no cloud.config.projectId');
    return;
  }

  const member = `serviceAccount:${clientEmail}`;
  let policies;

  try {
    // The compute account is named by project NUMBER, which only the project
    // itself can answer for.
    const projectNumber = (await powertools.execute(`gcloud projects describe ${projectId} --format="value(projectNumber)"`, { log: false })).trim();
    const accounts = [`${projectId}@appspot.gserviceaccount.com`, `${projectNumber}-compute@developer.gserviceaccount.com`];

    policies = [];
    for (const account of accounts) {
      const output = await powertools.execute(`gcloud iam service-accounts get-iam-policy ${account} --project ${projectId} --format=json`, { log: false });
      policies.push({ account, policy: JSON.parse(output) });
    }
  } catch (e) {
    // No gcloud here, nobody authenticated, or the accounts do not exist yet:
    // all ordinary, none of them evidence of a missing grant.
    logger.warn(`Could not verify the deploy roles (gcloud: ${e.message})`);
    return;
  }

  const missing = policies
    .filter(({ policy }) => !(policy.bindings || []).some((binding) => binding.role === ACT_AS_ROLE && (binding.members || []).includes(member)))
    .map(({ account }) => account);

  if (!missing.length) {
    logger.log(`✓ Deploy roles verified: ${clientEmail} may act as both default service accounts`);
    return;
  }

  throw new Error([
    `${clientEmail} is missing ${ACT_AS_ROLE} on ${missing.join(' and ')}.`,
    'The runner deploys as that account and a functions deploy acts as the default service accounts, so without it the deploy fails at the functions step.',
    'Run `npx omega manage` at the brand root to grant it, or grant it by hand:',
    ...missing.map((account) => grantCommand(account, projectId, member)),
  ].join('\n'));
}

module.exports = { verifyDeployRoles };
