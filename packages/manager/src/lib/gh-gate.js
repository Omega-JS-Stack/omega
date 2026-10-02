/**
 * The gh check a GitHub-backed service's setup makes before its first call
 * (the repo and seo services), so the walk names a missing or signed-out CLI
 * instead of failing four calls deep. It probes the PATH gh, the same one
 * every later call runs.
 */
const { probeGh, assertGhReady, GH_STATE_ERRORS } = require('@omega.js/devkit/github-repo');
const { canPrompt } = require('./run-gates.js');

/**
 * A signed-out gh in a walk that cannot prompt is a missing key, so the setup
 * skips naming GH_TOKEN (and gh's own reason, when it printed one); in a
 * terminal it stays the sign-in error. A missing gh always throws.
 *
 * @param {object} context - The service context: `options` (the run's).
 * @returns {{ skip: true, reason: string, missingEnv: string[] }|null} The setup skip, or null when gh is ready
 * @throws {Error} The install line, or the sign-in line in a terminal.
 */
function ghGate(context) {
  const probe = probeGh();
  if (probe.state === 'signed-out' && !canPrompt(context.options)) {
    const line = GH_STATE_ERRORS['signed-out'];
    return { skip: true, reason: probe.detail ? `${line}: ${probe.detail}` : line, missingEnv: ['GH_TOKEN'] };
  }
  assertGhReady({ probe });
  return null;
}

module.exports = { ghGate };
