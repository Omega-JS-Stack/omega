/**
 * Delete the derived files the brand's current sources no longer name (#636).
 * Last operation in the service on purpose: everything this walk generated is
 * already on disk, so what remains inside the operations' output dirs and is
 * not in the derived set is a leftover of an older shape — a dropped logo
 * source's ladders, a removed PSD's exports, a hand-dropped stray.
 */
const chalk = require('chalk').default;

const { reconcileAssets } = require('../lib/reconcile.js');

module.exports = async function writeReconcile(context) {
  const { brandRoot, outDir, options } = context;
  const dryRun = options?.dryRun || false;

  const { removed } = reconcileAssets({ brandRoot, outDir, dryRun });

  if (removed.length === 0) {
    console.log(`      ${chalk.green('✓')} No leftovers ${chalk.dim('(.omega/assets/ matches the brand\'s sources)')}`);
    return { output: { reconcile: { removed: 0 } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would remove ${chalk.cyan(removed.length)} file(s) the sources no longer derive: ${removed.join(', ')}`);
    return { output: { reconcile: { planned: removed.length } } };
  }

  console.log(`      ${chalk.yellow('↺')} Removed ${chalk.bold(removed.length)} file(s) the sources no longer derive ${chalk.dim(`(${removed.join(', ')})`)}`);
  return { output: { reconcile: { removed: removed.length } } };
};
