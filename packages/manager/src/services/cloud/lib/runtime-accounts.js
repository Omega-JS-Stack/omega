/**
 * The two runtime service accounts a Cloud Functions deploy acts as: the App
 * Engine default account (gen 1, plus the deploy's own preflight) and the
 * compute default account (gen 2). Named here once, so the operation that
 * grants a role ON them and the operation that grants roles TO them spell them
 * the same way (#878).
 */

/**
 * The App Engine default service account, named by project ID.
 *
 * @param {string} projectId - The brand's cloud project.
 * @returns {string} The account email.
 */
function appEngineDefaultAccount(projectId) {
  return `${projectId}@appspot.gserviceaccount.com`;
}

/**
 * The compute default service account, named by project NUMBER.
 *
 * @param {string|number} projectNumber - The project's number.
 * @returns {string} The account email.
 */
function computeDefaultAccount(projectNumber) {
  return `${projectNumber}-compute@developer.gserviceaccount.com`;
}

module.exports = { appEngineDefaultAccount, computeDefaultAccount };
