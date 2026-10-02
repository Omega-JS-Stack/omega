/**
 * The ONE "is a CI runner driving this" check. GitHub Actions sets
 * `GITHUB_ACTIONS=true`, and most other runners set `CI=true`.
 */

/**
 * Whether this environment is a CI runner.
 *
 * @param {object} env - The environment to read (`process.env`, or a test's own).
 * @returns {boolean}
 */
function isCI(env) {
  return env.GITHUB_ACTIONS === 'true' || env.CI === 'true';
}

module.exports = { isCI };
