/**
 * Brand-root package.json script healing — the deprecated `omega-manager`
 * bin name is retired from every USER-FACING surface (Ian 2026-07-21): the
 * context-aware `omega` dispatcher is the one brand-root verb. This heals
 * script VALUES in place (`omega-manager pipeline --require=x` →
 * `omega pipeline --require=x` — only the leading bin token, plain or
 * `npx `-prefixed, args preserved) and guarantees a `deploy` script, so
 * `npm run deploy` works in every brand. Every other script, key, and
 * ordering is untouched.
 */

// The script minted when a brand root has no deploy script at all
const DEPLOY_SCRIPT = 'omega deploy';

/**
 * Rewrite ONE script value: the leading `omega-manager` command token
 * (optionally behind `npx `) becomes `omega`; everything after it —
 * subcommands, flags, args — is preserved verbatim.
 *
 * @param {string} value - npm script value
 * @returns {string} - healed value (unchanged when it doesn't lead with the legacy bin)
 */
function healScriptValue(value) {
  return String(value).replace(/^(npx\s+)?omega-manager(?=\s|$)/, (match, npx) => `${npx || ''}omega`);
}

/**
 * Heal a package.json's scripts map. Pure — never touches disk.
 *
 * @param {Object} pkg - parsed package.json
 * @returns {{ scripts: Object, renamed: string[], added: boolean, changed: boolean }}
 *   scripts = the healed map (same key order, deploy appended when minted)
 */
function healPackageScripts(pkg) {
  const scripts = { ...((pkg || {}).scripts || {}) };
  const renamed = [];

  for (const [name, value] of Object.entries(scripts)) {
    const healed = healScriptValue(value);
    if (healed !== value) {
      scripts[name] = healed;
      renamed.push(name);
    }
  }

  const added = !scripts.deploy;
  if (added) {
    scripts.deploy = DEPLOY_SCRIPT;
  }

  return { scripts, renamed, added, changed: renamed.length > 0 || added };
}

module.exports = { healScriptValue, healPackageScripts, DEPLOY_SCRIPT };
