/**
 * deploy-precheck — the NETWORK half `omega setup` used to own
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * Setup's local half now rides every verb (ensure-target.js); what needs the
 * network rides the ONE verb that needs the remote side right —
 * `omega deploy` — as a precheck before the dispatch:
 *
 *   framework-freshness  the npm registry's latest vs the installed version,
 *                        since CI builds this deploy with whatever the
 *                        manifest pins
 *   push-secrets         the composed target env → GitHub Actions repo secrets,
 *                        which the dispatched workflow's generated env block
 *                        consumes ([#680](https://github.com/Omega-JS-Stack/omega/issues/680))
 *
 * Every step is soft: a precheck reports, the deploy proceeds. `--no-secrets`
 * skips the whole precheck — the same opt-out name on web, desktop and
 * extension (parity).
 *
 * The RUNNER is `@omega.js/devkit/deploy-precheck` (one copy for every
 * framework); this file is the extension's STEPS.
 */
const Manager = new (require('../../build.js'));
const { runDeployPrecheck } = require('@omega.js/devkit/deploy-precheck');
const { updateManager } = require('./dependencies.js');
const { publishEnvSecrets } = require('./push-secrets.js');

const package = Manager.getPackage('main');

/**
 * The default steps, in order. Named so a test can hand its own recorder in
 * and read back exactly which ones ran.
 */
const STEPS = [
  {
    name: 'framework-freshness',
    run: ({ projectDir, log, warn }) => updateManager({ projectDir, package, log, error: warn }),
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
