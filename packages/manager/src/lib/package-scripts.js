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

/**
 * Fill a TARGET manifest's missing scripts from its framework's own
 * `projectScripts` declaration. Fill-missing ONLY — a consumer's customized
 * value is never overwritten. This is the onboard→dev cycle break (#675): the
 * framework's ensureTarget writes these on the first verb run, but the dev
 * fan-out reaches that verb THROUGH these scripts, so a freshly scaffolded
 * target needs them before any verb has ever run.
 *
 * @param {Object} pkg - parsed target package.json
 * @param {Object} projectScripts - the framework package's projectScripts map
 * @returns {{ scripts: Object, changes: string[] }}
 */
function healTargetScripts(pkg, projectScripts) {
  const scripts = { ...((pkg || {}).scripts || {}) };
  const changes = [];

  for (const [key, value] of Object.entries(projectScripts || {})) {
    if (!scripts[key]) {
      scripts[key] = value;
      changes.push(`${key}: '${value}'`);
    }
  }

  return { scripts, changes };
}

module.exports = { healPackageScripts, healTargetScripts, DEPLOY_SCRIPT, START_SCRIPT, MANAGE_SCRIPT };
