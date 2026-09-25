/**
 * The origin heal: a brand whose `origin` names a repo GitHub has since
 * redirected is pointed at the address GitHub answers with
 * ([#890](https://github.com/Omega-JS-Stack/omega/issues/890)).
 *
 * A transfer or a rename leaves every clone pointing at the old address. Git
 * follows GitHub's redirect and keeps working, so nothing ever complains, and
 * the stale remote surfaces later as a push to a repo the brand no longer is
 * (seen on the `omega-omega` transfer into `Omega-JS-Stack`, 2026-09-12).
 *
 * The REDIRECT is the authority, not the config: `gh api repos/<owner>/<name>`
 * on the slug the checkout already carries follows GitHub's own 301 and answers
 * the CURRENT `full_name`, so a brand is healed onto wherever its repo actually
 * moved, config or no config. That costs one GitHub read per boot, which is the
 * price of healing from the truth instead of from a typed value.
 *
 * The decision, in the order it is cheapest to answer:
 *   - no brand root: nothing to compare, and not one read made;
 *   - no `.git` AT the brand root: a no-op, never a walk up, and answered by one
 *     stat before anything else is read. Git resolves a repo by walking up, and
 *     a brand nested in another repo (a fixture brand inside this monorepo, a
 *     target checked out under someone else's tree) would otherwise have the
 *     ENCLOSING repo's remote read and rewritten;
 *   - no `origin`, or an origin that is not a GitHub remote: a no-op. A
 *     checkout nobody has pushed yet, and a brand hosted elsewhere, are
 *     expected external conditions, not failures;
 *   - a repo GitHub does not have (a 404: it is gone), or a GitHub it cannot
 *     reach (offline, no `gh` auth): a silent no-op. Rewriting a remote on an
 *     answer nobody got would take a working checkout and break it;
 *   - GitHub answering the slug the remote already names (compared
 *     case-insensitively, GitHub's own comparison): converged, silent;
 *   - anything else: the remote is rewritten to the answered `full_name`,
 *     keeping its own url form, and the heal is stated in one line.
 *
 * Then DRIFT, on whatever the answer was: the WHOLE slug GitHub answers against
 * the source repo the config derives (`@omega.js/config`'s `repoDrift`, so a
 * rename drifts as surely as a transfer,
 * [#934](https://github.com/Omega-JS-Stack/omega/issues/934)), stated in one
 * line and nothing more. Never fatal: this runs before every verb, and a fatal
 * boot would lock out the verbs that fix the mismatch. The verbs that ACT on
 * the derived repo (the manage walk, the deploy) refuse on the same line
 * instead. The prelude never writes config: which of the two is wrong (the
 * config, or where the repo lives) is a human's call.
 *
 * The WRITE is the one thing that fails loudly: a `git remote set-url` refused
 * after a `get-url` just answered is not an external condition, it is a broken
 * invariant, and the runner stops the boot on it.
 */

const { readOrigin, retargetRemoteUrl, setRemoteUrl } = require('../git-remote.js');
const github = require('../github-repo.js');

// The one network read runs on EVERY verb boot, so a network that hangs (a
// captive portal, a dropped link) is bounded here and lands on the same silent
// `unreachable` branch an offline machine does.
const GITHUB_READ_TIMEOUT_MS = 10000;

/**
 * @param {object} context - The prelude context.
 * @param {string|null} context.brandRoot - The brand root of the invocation.
 * @param {object} [context.config] - The composed omega config, when the caller has it.
 * @param {function} [context.execFn] - Injectable git exec (tests).
 * @param {function} [context.resolveRepo] - Injectable `(owner, name) => repo|null` (tests).
 * @param {function} [context.log] - Injectable line printer (tests).
 * @returns {{ healed: boolean, reason?: string, from?: string, to?: string, drift?: { origin: string, derived: string } }}
 */
function run(context = {}) {
  const { brandRoot, execFn } = context;
  const log = context.log || console.log;
  // Called through the module so the ONE network read has a seam a real CLI
  // boot can stub too (the integration test patches it here).
  const resolveRepo = context.resolveRepo || ((owner, name) => github.getRepo(owner, name, { timeout: GITHUB_READ_TIMEOUT_MS }));

  if (!brandRoot) return { healed: false, reason: 'no-brand' };

  // One stat before anything else (most boots in this monorepo's own trees and
  // in every fixture brand end there), then the remote itself.
  const current = readOrigin({ dir: brandRoot, execFn });
  if (!current.slug) return { healed: false, reason: current.reason };

  const { url, slug: from } = current;

  // The ONE network read, on the slug the checkout carries: GitHub follows its
  // own redirect and names where that repo lives now.
  let resolved;
  try {
    resolved = resolveRepo(current.owner, current.repo);
  } catch (e) {
    return { healed: false, reason: 'unreachable' };
  }
  if (!resolved) return { healed: false, reason: 'missing' };

  const to = resolved.full_name;
  let result;

  if (to.toLowerCase() === from.toLowerCase()) {
    result = { healed: false, reason: 'converged' };
  } else {
    setRemoteUrl({ dir: brandRoot, url: retargetRemoteUrl(url, to), execFn });
    log(`omega: origin healed from ${from} to ${to}`);
    result = { healed: true, from, to };
  }

  const config = composedConfig(brandRoot, context.config);
  const { repoDrift, sourceRepo } = require('@omega.js/config');
  const drift = config ? repoDrift(to, config) : null;

  if (drift) {
    log(`omega: ${drift}`);
    result.drift = { origin: to, derived: sourceRepo(config).slug };
  }

  return result;
}

/**
 * The composed config the drift is read against: the caller's when it has one,
 * else loaded here, and an unloadable one answers null ("no drift"): a config
 * the boot cannot read is the VERB's failure to report, in its own words, never
 * a prelude's.
 *
 * @param {string} brandRoot - The brand root.
 * @param {object} [config] - The composed config, when the caller has it.
 * @returns {object|null}
 */
function composedConfig(brandRoot, config) {
  if (config) return config;

  const { loadConfig } = require('@omega.js/config');

  try {
    return loadConfig(brandRoot).config;
  } catch (e) {
    return null;
  }
}

module.exports = {
  name: 'origin-heal',
  verbs: 'all',
  run,
};
