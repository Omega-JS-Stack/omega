/**
 * Sync the brand's registry entry to the company server's Firestore at
 * brands/{brand.id}. Only the whitelisted top-level config sections cross
 * (brand identity, repo org info, sponsorship terms), and the document
 * is fully REPLACED on write so keys removed from config disappear from
 * the registry too — omega-manager's `set(data, { merge: false })`
 * semantic, but diff-synced: omega-manager overwrote the document blindly
 * on every run with no dry-run guard; the port reads first and only
 * writes on drift.
 */
const chalk = require('chalk').default;

// Only these top-level config sections are published to the registry
const SYNCED_KEYS = ['brand', 'repo', 'sponsorships'];

/** Structural equality, key-order-insensitive — a full-replace write means
 * ANY difference (including extra keys in the current doc) is drift. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const aKeys = Object.keys(a);
    return aKeys.length === Object.keys(b).length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

module.exports = async function ensureBrands(context) {
  const { brandConfig, db, options } = context;
  const dryRun = options?.dryRun || false;

  const registryId = brandConfig.brand.id;
  const docPath = `brands/${registryId}`;

  const desired = {};
  for (const key of SYNCED_KEYS) {
    if (brandConfig[key] !== undefined) {
      desired[key] = brandConfig[key];
    }
  }

  const current = await db.getDoc(docPath);

  if (deepEqual(current, desired)) {
    console.log(`      ${chalk.green('✓')} Registry entry ${chalk.dim(docPath)} in sync`);
    return { output: { brands: { synced: true } } };
  }

  const action = current ? 'update' : 'create';

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would ${action} registry entry ${chalk.cyan(docPath)}`);
    return { output: { brands: { planned: action } } };
  }

  await db.setDoc(docPath, desired);

  console.log(`      ${chalk.green('✓')} Registry entry ${chalk.dim(docPath)} ${action}d`);

  return { output: { brands: { [`${action}d`]: true } } };
};
