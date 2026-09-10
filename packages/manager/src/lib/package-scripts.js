/**
 * Brand-root package.json script healing — guarantees a `deploy` script, so
 * `npm run deploy` works in every brand, and migrates the legacy
 * `start: 'omega'` shape to the current convention (`npm start` boots the dev
 * stack, `npm run manage` runs the manage cycle — as the NAMED verb
 * `omega manage` since #229). Script VALUES only, and
 * only the ones named here: every other script, key, and ordering is untouched.
 */

// The scripts minted when a brand root is missing them
const DEPLOY_SCRIPT = 'omega deploy';
const START_SCRIPT = 'omega dev';
const MANAGE_SCRIPT = 'omega manage';

// The pre-migration `start` value: a bare manage cycle on `npm start`
const LEGACY_START_SCRIPT = 'omega';

// The pre-migration `manage` value: a bare `omega` prints help now (#229),
// so a brand still carrying it would run nothing at all
const LEGACY_MANAGE_SCRIPT = 'omega';

/**
 * Heal a package.json's scripts map. Pure — never touches disk.
 *
 * @param {Object} pkg - parsed package.json
 * @returns {{ scripts: Object, changes: string[] }}
 *   scripts = the healed map (same key order, minted scripts appended)
 *   changes = one `key: 'value'` line per heal, empty when converged
 */
function healPackageScripts(pkg) {
  const scripts = { ...((pkg || {}).scripts || {}) };
  const changes = [];

  // The migration: only the legacy value moves — a brand that customized
  // `start` to something of its own keeps it
  if (scripts.start === LEGACY_START_SCRIPT) {
    scripts.start = START_SCRIPT;
    changes.push(`start: '${START_SCRIPT}'`);
  }

  // Minted whenever missing (a new key overwrites nothing): the manager's own
  // retry hints print `npm run manage`, so every brand root must answer it.
  // The same migration rule as `start` above — only the legacy value moves,
  // a brand that customized `manage` keeps it.
  if (!scripts.manage) {
    scripts.manage = MANAGE_SCRIPT;
    changes.push(`manage: '${MANAGE_SCRIPT}'`);
  } else if (scripts.manage === LEGACY_MANAGE_SCRIPT) {
    scripts.manage = MANAGE_SCRIPT;
    changes.push(`manage: '${MANAGE_SCRIPT}'`);
  }

  if (!scripts.deploy) {
    scripts.deploy = DEPLOY_SCRIPT;
    changes.push(`deploy: '${DEPLOY_SCRIPT}'`);
  }

  return { scripts, changes };
}

// The command #675 retired. Every pre-#675 framework `projectScripts` chained
// it — as the head (`npx omega setup && npx omega emulator`), mid-chain
// (`npx omega clean && npx omega setup && npm run gulp --`), or alone
// (`setup: 'npx omega setup'`). The command is gone, so any script still
// naming it dies at `Unknown command "setup"` (#707): the segment is
// framework-authored residue, never consumer intent.
const RETIRED_SETUP_COMMAND = 'npx omega setup';

/**
 * The pre-#675 residue check: does this script value still run the retired
 * command as one leg of its `&&` chain?
 */
function hasRetiredSetup(value) {
  return value.split('&&').some((segment) => segment.trim() === RETIRED_SETUP_COMMAND);
}

/**
 * The value with the retired leg dropped — `''` when the whole script WAS the
 * retired command and nothing else is left to run.
 */
function withoutRetiredSetup(value) {
  return value
    .split('&&')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== RETIRED_SETUP_COMMAND)
    .join(' && ');
}

/**
 * Sync a TARGET manifest's scripts to its framework's own `projectScripts`
 * declaration. ONE ownership policy (#689): a key the framework declares is
 * FRAMEWORK-owned and takes the default value on every run — the walk and the
 * framework's own ensureTarget agree, so a hand-edited standard script is
 * rewritten either way and hook points are the customization seam. A key the
 * framework never declares is the consumer's own and is never touched.
 *
 * Two rules, in order:
 *
 * 1. One-time migration (#707): a value still naming the retired
 *    `npx omega setup` (#675) is framework-authored residue — it takes the
 *    manifest's current value, or, for a key the manifest no longer declares,
 *    just loses that leg (and the key goes when nothing is left to run). Once
 *    rewritten nothing matches again, so no standing machinery accrues.
 * 2. Overwrite-to-default for every declared key. This also covers the
 *    onboard→dev cycle break (#675): the framework's ensureTarget writes these
 *    on the first verb run, but the dev fan-out reaches that verb THROUGH
 *    these scripts, so a freshly scaffolded target needs them before any verb
 *    has ever run.
 *
 * `brandOwnedKeys` carves the exception out per key, never per target: a
 * custom-server backend (#584) names its own `start`/`deploy` because those
 * verbs refuse in that mode, so those keys are skipped by BOTH rules — never
 * written, never scaffolded, not even a placeholder to delete.
 *
 * @param {Object} pkg - parsed target package.json
 * @param {Object} projectScripts - the framework package's projectScripts map
 * @param {string[]} [brandOwnedKeys] - declared keys this target owns instead
 * @returns {{ scripts: Object, changes: string[], skipped: string[] }}
 *   skipped = the brand-owned keys the framework declares, for the report
 */
function syncTargetScripts(pkg, projectScripts, brandOwnedKeys = []) {
  const scripts = { ...((pkg || {}).scripts || {}) };
  const manifest = projectScripts || {};
  const brandOwned = new Set(brandOwnedKeys);
  const changes = [];

  for (const [key, value] of Object.entries(scripts)) {
    if (brandOwned.has(key) || !hasRetiredSetup(value)) continue;

    const healed = manifest[key] === undefined ? withoutRetiredSetup(value) : manifest[key];
    if (healed) {
      scripts[key] = healed;
      changes.push(`${key}: '${healed}' (was '${RETIRED_SETUP_COMMAND}')`);
    } else {
      delete scripts[key];
      changes.push(`${key}: removed (was '${RETIRED_SETUP_COMMAND}')`);
    }
  }

  for (const [key, value] of Object.entries(manifest)) {
    if (brandOwned.has(key) || scripts[key] === value) continue;

    scripts[key] = value;
    changes.push(`${key}: '${value}'`);
  }

  const skipped = Object.keys(manifest).filter((key) => brandOwned.has(key));

  return { scripts, changes, skipped };
}

module.exports = { healPackageScripts, syncTargetScripts, DEPLOY_SCRIPT, START_SCRIPT, MANAGE_SCRIPT };
