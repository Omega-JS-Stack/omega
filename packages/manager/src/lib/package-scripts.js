/**
 * Brand-root package.json script healing — guarantees a `deploy` script, so
 * `npm run deploy` works in every brand. Every other script, key, and
 * ordering is untouched.
 */

// The script minted when a brand root has no deploy script at all
const DEPLOY_SCRIPT = 'omega deploy';

/**
 * Heal a package.json's scripts map. Pure — never touches disk.
 *
 * @param {Object} pkg - parsed package.json
 * @returns {{ scripts: Object, added: boolean }}
 *   scripts = the healed map (same key order, deploy appended when minted)
 */
function healPackageScripts(pkg) {
  const scripts = { ...((pkg || {}).scripts || {}) };

  const added = !scripts.deploy;
  if (added) {
    scripts.deploy = DEPLOY_SCRIPT;
  }

  return { scripts, added };
}

module.exports = { healPackageScripts, DEPLOY_SCRIPT };
