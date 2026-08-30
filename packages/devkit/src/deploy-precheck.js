/**
 * runDeployPrecheck — the shared runner for the NETWORK half `omega setup`
 * used to own ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * Setup's local half rides every verb (each framework's ensure-target); what
 * needs the network rides the ONE verb that needs the remote side right —
 * `omega deploy` — as a precheck before the dispatch. The STEPS differ per
 * framework (desktop signs and provisions release repos, extension checks its
 * own freshness, web publishes Actions secrets); the RUNNER does not, so it
 * lives here and every framework file is its list.
 *
 * The contract the runner guarantees:
 *   - `--no-secrets` (yargs: `secrets: false`) skips the whole precheck — the
 *     same opt-out name on web, desktop and extension (parity; desktop's old
 *     `--quick` is gone).
 *   - Every step is SOFT: a throwing step is reported as a warning and the run
 *     continues. A precheck reports; the deploy is the caller's decision.
 *   - Steps run in list order and `ran` names the ones that finished, so a test
 *     hands its own recorder in and reads back exactly what happened.
 */

/**
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} [input.options] - The parsed CLI options (`secrets: false` = opted out).
 * @param {object} input.logger - `{ log, warn, error }`.
 * @param {Array<{ name: string, run: function }>} input.steps - The framework's step list.
 * @returns {Promise<{ skipped: string }|{ ran: string[] }>} The steps that ran, or the opt-out marker.
 */
async function runDeployPrecheck({ projectDir, options, logger, steps }) {
  // yargs turns `--no-secrets` into `secrets: false`.
  if (options && options.secrets === false) {
    logger.log('Skipping the network prechecks (--no-secrets)');
    return { skipped: 'opt-out' };
  }

  const log = (line) => logger.log(line);
  const warn = (line) => logger.warn(line);
  const ran = [];

  for (const step of steps) {
    try {
      await step.run({ projectDir, log, warn });
      ran.push(step.name);
    } catch (e) {
      // A precheck REPORTS; the deploy is the caller's decision.
      warn(`${step.name} failed during the deploy precheck (non-fatal): ${e.message}`);
    }
  }

  return { ran };
}

module.exports = { runDeployPrecheck };
