/**
 * @omega.js/config demo — the shared demo-project test. Firebase's own
 * convention: `demo-*` project ids are emulator-only (no real GCP project
 * exists or ever will). Cloud-touching services and commands short-circuit
 * on it instead of aiming real Google APIs at a project that 403s.
 */

/**
 * Whether a Firebase project id is a demo-* (emulator-only) project.
 *
 * @param {string} projectId - e.g. 'demo-omega'
 * @returns {boolean}
 */
function isDemoProject(projectId) {
  return String(projectId || '').startsWith('demo-');
}

module.exports = { isDemoProject };
