/**
 * The docs sync: a brand whose @omega.js/manager is a local checkout gets that
 * manager's docs/ synced from the monorepo's docs/ before every verb, so the
 * brand's agents read the live map through the manager's AGENTS.md.
 *
 * A published manager ships the docs of its own version and is left alone, as
 * is an invocation outside a brand. The sync writes only files whose content
 * changed, so a boot with nothing to do reads the tree and writes nothing.
 */

const path = require('path');
const { resolvePackageRealDir, isLocalCheckout, isMonorepoRoot } = require('../local.js');

const MANAGER = '@omega.js/manager';

/**
 * @param {object} context - The prelude context.
 * @param {string|null} context.brandRoot - The brand root of the invocation.
 * @param {function} [context.log] - Injectable line printer (tests).
 * @returns {{ synced: boolean, reason?: string, written?: string[], removed?: string[] }}
 */
function run(context = {}) {
  const { brandRoot } = context;
  const log = context.log || console.log;
  if (!brandRoot) {
    return { synced: false, reason: 'no-brand' };
  }

  const managerDir = resolvePackageRealDir(MANAGER, brandRoot);
  if (!managerDir) {
    return { synced: false, reason: 'no-manager' };
  }
  // A checkout lives at <monorepo>/packages/manager, the layout every link points at.
  const monorepoRoot = path.dirname(path.dirname(managerDir));
  if (!isLocalCheckout(managerDir) || !isMonorepoRoot(monorepoRoot)) {
    return { synced: false, reason: 'published' };
  }

  // The checkout's own docs lane, so the sync matches the monorepo's code.
  const { syncDocs } = require(path.join(monorepoRoot, 'packages', 'devkit', 'tools', 'vendor-docs.js'));
  const { written, removed } = syncDocs({ monorepoRoot, packageDir: managerDir });
  if (written.length + removed.length > 0) {
    log(`omega: synced the linked manager's docs from the monorepo (${written.length} written, ${removed.length} removed)`);
  }
  return { synced: true, written, removed };
}

module.exports = {
  name: 'docs-sync',
  verbs: 'all',
  run,
};
