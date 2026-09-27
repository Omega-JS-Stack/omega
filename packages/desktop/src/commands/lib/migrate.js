/**
 * migrateTarget: the desktop leg of the brand root's `omega migrate`. No
 * legacy electron-manager shape converts mechanically yet (the register's
 * by-hand steps cover them), so it answers the shared shape with nothing due.
 * Every framework exposes this entry, so the manager's walk never special-cases
 * a framework name.
 *
 * @param {string} targetDir - the desktop target's root
 * @param {object} [options]
 * @param {boolean} [options.execute] - convert (default: report only)
 * @returns {{ due: string[], changed: string[], errors: string[] }}
 */
function migrateTarget(targetDir, options = {}) {
  return { due: [], changed: [], errors: [] };
}

module.exports = { migrateTarget };
