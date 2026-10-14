/**
 * The ONE "is a CI runner driving this" check. GitHub Actions sets
 * `GITHUB_ACTIONS=true`, and most other runners set `CI=true`.
 */

// Every flag a runner sets; either one at 'true' is a CI run.
const CI_FLAGS = ['GITHUB_ACTIONS', 'CI'];

/**
 * Whether this environment is a CI runner.
 *
 * @param {object} env - The environment to read (`process.env`, or a test's own).
 * @returns {boolean}
 */
function isCI(env) {
  return CI_FLAGS.some((name) => env[name] === 'true');
}

module.exports = { CI_FLAGS, isCI };
