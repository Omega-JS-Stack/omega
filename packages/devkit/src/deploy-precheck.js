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
 *   - `--no-secrets` (parsed as `secrets: false`) skips the whole precheck, the
 *     same opt-out name on web, desktop and extension (parity; desktop's old
 *     `--quick` is gone).
 *   - Every step is SOFT by default: a throwing step is reported as a warning
 *     and the run continues. A precheck reports; the deploy is the caller's
 *     decision. A step marked `fatal` is the exception
 *     ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)): its failure
 *     means the deploy would ship something broken (an unsigned, unnotarized
 *     mac build), so it rethrows and the deploy never dispatches.
 *   - Steps run in list order and `ran` names the ones that finished, so a test
 *     hands its own recorder in and reads back exactly what happened.
 *   - A DRY RUN still runs the precheck
 *     ([#895](https://github.com/Omega-JS-Stack/omega/issues/895)): every step
 *     is a read or a plan under `dryRun`, and a precheck that only ran for real
 *     deploys was a preview nobody could trust. Each step receives it.
 */

/**
 * @param {object} input
 * @param {string} input.projectDir - The target root.
 * @param {object} [input.options] - The parsed CLI options (`secrets: false` = opted out).
 * @param {object} input.logger - `{ log, warn, error }`.
 * @param {boolean} [input.dryRun] - Plan only; handed to every step.
 * @param {Array<{ name: string, run: function, fatal?: boolean }>} input.steps - The framework's step list.
 * @returns {Promise<{ skipped: string }|{ ran: string[] }>} The steps that ran, or the opt-out marker.
 */
async function runDeployPrecheck({ projectDir, options, logger, steps, dryRun }) {
  // The parse turns `--no-secrets` into `secrets: false` (src/argv.js).
  if (options && options.secrets === false) {
    logger.log('Skipping the network prechecks (--no-secrets)');
    return { skipped: 'opt-out' };
  }

  const log = (line) => logger.log(line);
  const warn = (line) => logger.warn(line);
  const ran = [];

  for (const step of steps) {
    try {
      await step.run({ projectDir, log, warn, dryRun: dryRun === true });
      ran.push(step.name);
    } catch (e) {
      // A FATAL step guards something the deploy would otherwise ship broken:
      // it stops the run instead of narrating it (#891).
      if (step.fatal) {
        throw new Error(`${step.name} failed during the deploy precheck: ${e.message}`);
      }

      // Everything else REPORTS; the deploy is the caller's decision.
      warn(`${step.name} failed during the deploy precheck (non-fatal): ${e.message}`);
    }
  }

  return { ran };
}

module.exports = { runDeployPrecheck };
