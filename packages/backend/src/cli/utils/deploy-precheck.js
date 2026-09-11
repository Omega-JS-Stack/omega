/**
 * deploy-precheck: the NETWORK half of `omega deploy`, backend's list
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675) shape,
 * [#872](https://github.com/Omega-JS-Stack/omega/issues/872) arrival).
 *
 * Backend had no precheck while its deploy ran from the CLI: the brand's own
 * files were right there. The deploy runs on a RUNNER now, so the step the
 * other three frameworks have is the one backend needs most, and the cheap read
 * that predicts the runner's IAM failure runs ahead of it:
 *
 *   verify-deploy-roles
 *                  the two policy reads that predict the runner's own failure:
 *                  may the deploy account ACT AS the default runtime service
 *                  accounts a functions deploy runs under
 *                  ([#878](https://github.com/Omega-JS-Stack/omega/issues/878))
 *   push-secrets   the composed target env (plus the service-account key) →
 *                  GitHub Actions repo secrets, which the composed workflow
 *                  turns back into the target's `.env` and key file
 *
 * Every step is soft: a precheck reports, the deploy proceeds. `--no-secrets`
 * skips the whole precheck, the same opt-out name web, desktop and the
 * extension honor (the flag used to be accepted and ignored here).
 *
 * The RUNNER is `@omega.js/devkit/deploy-precheck` (one copy for every
 * framework); this file is backend's STEPS.
 */
const { runDeployPrecheck } = require('@omega.js/devkit/deploy-precheck');
const { publishEnvSecrets } = require('./push-secrets');
const { verifyDeployRoles } = require('./deploy-roles');

/**
 * The default steps, in order. Named so a test can hand its own recorder in
 * and read back exactly which ones ran.
 */
const STEPS = [
  {
    name: 'verify-deploy-roles',
    run: ({ projectDir, log, warn }) => verifyDeployRoles({ targetDir: projectDir, logger: { log, warn } }),
  },
  {
    name: 'push-secrets',
    run: ({ projectDir, log, warn }) => publishEnvSecrets({ targetDir: projectDir, logger: { log, warn, error: warn } }),
  },
];

/**
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} input.options - The parsed CLI options (`secrets: false` = opted out).
 * @param {object} input.logger - `{ log, warn, error }`.
 * @param {Array} [input.steps] - Injectable step list (tests).
 * @returns {Promise<{ skipped: string }|{ ran: string[] }>} The steps that ran, or the opt-out marker.
 */
function deployPrecheck({ projectDir, options, logger, steps }) {
  return runDeployPrecheck({ projectDir, options, logger, steps: steps || STEPS });
}

module.exports = { deployPrecheck, STEPS };
