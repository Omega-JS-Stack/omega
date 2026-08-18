/**
 * Push the brand's directory entry to the parent project's Firestore at
 * brands/{brand.id}: identity plus the blocks the brand declares.
 *
 * Diff FIRST — an unchanged config performs zero writes, which is what makes
 * this safe to run on every manage walk.
 *
 * MERGE-write, not replace (the server service's registry is a replace, and
 * the difference is deliberate): the framework owns only its own sections of
 * the entry, so the write masks exactly those. Whatever the hub keeps on the
 * same document — order counts, moderation state, anything ITW's marketplace
 * adds — survives every push, and a section the brand drops from config is
 * still removed, because the mask names every owned section whether or not it
 * has a value this run.
 */
const { isDeepStrictEqual } = require('node:util');
const chalk = require('chalk').default;

const { OWNED_SECTIONS, buildEntry, ownedSlice } = require('../lib/blocks.js');

module.exports = async function ensureEntry(context) {
  const { brandConfig, db, options } = context;
  const dryRun = options?.dryRun || false;

  const docPath = `brands/${brandConfig.brand.id}`;
  const desired = buildEntry(brandConfig);
  const blocks = Object.keys(desired).filter((key) => key !== 'brand' && key !== 'github');

  const current = await db.getDoc(docPath);

  if (isDeepStrictEqual(ownedSlice(current), desired)) {
    console.log(`      ${chalk.green('✓')} Directory entry ${chalk.dim(docPath)} in sync${blocks.length > 0 ? chalk.dim(` (${blocks.join(', ')})`) : ''}`);
    return { output: { entry: { synced: true, blocks } } };
  }

  const action = current ? 'update' : 'create';

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would ${action} directory entry ${chalk.cyan(docPath)}`);
    return { output: { entry: { planned: action, blocks } } };
  }

  await db.patchDoc(docPath, desired, OWNED_SECTIONS);

  console.log(`      ${chalk.green('✓')} Directory entry ${chalk.dim(docPath)} ${action}d${blocks.length > 0 ? chalk.dim(` (${blocks.join(', ')})`) : ''}`);

  return { output: { entry: { [`${action}d`]: true, blocks } } };
};
