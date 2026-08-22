/**
 * Targets-rename migration ([#443](https://github.com/Omega-JS-Stack/omega/issues/443))
 * — the on-disk half of one vocabulary. Config has always called them
 * `targets`, so a brand monorepo's surfaces live in `targets/` too, and
 * nothing dual-reads the old name: discovery, scaffolding and the disperse
 * model all speak `targets/` outright.
 *
 * A brand that still carries `apps/` is fixed ONCE, by hand, with this
 * migration — never healed inside every run (Ian, 2026-08-21: no standing
 * backwards-compat machinery). Discovery fails loud on the old shape and
 * points here:
 *   npx omega manage --migration=targets-rename            # prints the plan, moves nothing
 *   npx omega manage --migration=targets-rename --execute  # performs it
 * …then `npm install` at the brand root, so npm re-links `node_modules/<target>`
 * at the new path.
 *
 * The root manifest travels with the folder: npm workspaces name the glob, so
 * a renamed folder under an `apps/*` workspaces entry is a brand whose targets
 * resolve nowhere. A hand-renamed folder whose manifest still lags is the
 * same job, half done — the glob is healed on its own.
 *
 * Idempotent: a brand already on `targets/` is a clean no-op. Ambiguous is
 * FATAL — a brand carrying BOTH folders is a half-done migration, and merging
 * them is a guess about which copy is real.
 *
 * Unlike its Firestore siblings this migration touches only the brand's own
 * files, so it runs without a service account (`local: true`).
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const MIGRATION_NAME = 'targets-rename';
const LEGACY_DIR = 'apps';
const TARGETS_DIR = 'targets';

/**
 * Does the root manifest still name the legacy workspaces glob?
 *
 * @param {string} brandRoot - Absolute brand-monorepo root
 * @returns {boolean} true when `workspaces` carries `apps/*`
 */
function hasLegacyGlob(brandRoot) {
  const manifest = jetpack.read(join(brandRoot, 'package.json'), 'json');
  return Boolean(manifest && Array.isArray(manifest.workspaces) && manifest.workspaces.includes(`${LEGACY_DIR}/*`));
}

/**
 * Flip the root package.json's `apps/*` workspaces entry to `targets/*`,
 * preserving every other entry and the file's key order.
 *
 * @param {string} brandRoot - Absolute brand-monorepo root
 * @returns {void}
 */
function healWorkspacesGlob(brandRoot) {
  const manifestPath = join(brandRoot, 'package.json');
  const manifest = jetpack.read(manifestPath, 'json');

  manifest.workspaces = manifest.workspaces.map((entry) => (
    entry === `${LEGACY_DIR}/*` ? `${TARGETS_DIR}/*` : entry
  ));
  jetpack.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Targets-rename migration handler.
 *
 * @param {Object} context - Handler context ({ brandRoot, options })
 * @returns {Object} { output } — the plan, or what was performed
 * @throws {Error} when the brand carries both folders
 */
module.exports = async function ensureTargetsRename(context) {
  const { brandRoot, options = {} } = context;
  const execute = options.execute === true;

  const legacyPath = join(brandRoot, LEGACY_DIR);
  const targetsPath = join(brandRoot, TARGETS_DIR);
  const hasLegacy = jetpack.exists(legacyPath) === 'dir';
  const hasTargets = jetpack.exists(targetsPath) === 'dir';

  if (hasLegacy && hasTargets) {
    throw new Error(
      `${brandRoot} carries BOTH ${LEGACY_DIR}/ and ${TARGETS_DIR}/ — the #443 rename cannot guess which one is real. `
      + `Merge them by hand into ${TARGETS_DIR}/, delete ${LEGACY_DIR}/, then run again.`,
    );
  }

  const legacyGlob = hasLegacyGlob(brandRoot);

  if (!hasLegacy && !legacyGlob) {
    console.log(`      ${chalk.green('✓')} Already on ${chalk.cyan(`${TARGETS_DIR}/`)} — nothing to rename`);
    return { output: { targetsRename: { migrated: false } } };
  }

  // ── The plan, printed the same way in both modes ──────────────────────────
  const targetNames = hasLegacy ? jetpack.list(legacyPath) || [] : [];
  if (hasLegacy) {
    console.log(`      ${chalk.dim('→')} ${chalk.cyan(`${LEGACY_DIR}/`)} ${chalk.dim('→')} ${chalk.cyan(`${TARGETS_DIR}/`)} ${chalk.dim(`(${targetNames.length} target(s): ${targetNames.join(', ')})`)}`);
  }
  if (legacyGlob) {
    console.log(`      ${chalk.dim('→')} package.json workspaces ${chalk.cyan(`${LEGACY_DIR}/*`)} ${chalk.dim('→')} ${chalk.cyan(`${TARGETS_DIR}/*`)}`);
  }

  if (!execute) {
    console.log(`      ${chalk.yellow('[AUDIT]')} Nothing moved ${chalk.dim('(--execute to perform it)')}`);
    return { output: { targetsRename: { audit: true, folder: hasLegacy, workspaces: legacyGlob, targets: targetNames } } };
  }

  if (hasLegacy) {
    jetpack.move(legacyPath, targetsPath);
    console.log(`      ${chalk.green('✓')} Renamed ${chalk.cyan(`${LEGACY_DIR}/`)} → ${chalk.cyan(`${TARGETS_DIR}/`)}`);
  }
  if (legacyGlob) {
    healWorkspacesGlob(brandRoot);
    console.log(`      ${chalk.green('✓')} Root workspaces now say ${chalk.cyan(`${TARGETS_DIR}/*`)}`);
  }
  console.log(`      ${chalk.dim('run `npm install` at the brand root to refresh the workspace links')}`);

  return { output: { targetsRename: { migrated: true, folder: hasLegacy, workspaces: legacyGlob, targets: targetNames } } };
};

module.exports.MIGRATION_NAME = MIGRATION_NAME;
module.exports.LEGACY_DIR = LEGACY_DIR;
module.exports.TARGETS_DIR = TARGETS_DIR;
