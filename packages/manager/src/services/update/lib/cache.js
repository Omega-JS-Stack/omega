/**
 * The update service's incremental cache (#445) — `.omega/cache/update.json`
 * at the brand root: per target, the two fingerprints its last successful build
 * ran against. Derived data, so it lives with the brand's other caches under
 * `.omega/cache/` (the edge service's read cache is its neighbour) — never in
 * config, which holds provisioned facts.
 *
 * Missing, unparseable, or written in an older shape → an empty cache, which
 * reads as "every target is fresh": the run does the full update and rewrites the
 * file. A cache is an optimization, never a reason to fail the walk, so a
 * failed write warns and the walk continues.
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');

const CACHE_VERSION = 2; // v2: the per-target map key renamed apps -> targets (#455)

/**
 * @param {string} brandRoot - The brand monorepo root.
 * @returns {string} Absolute path to the cache file.
 */
function cacheFile(brandRoot) {
  return join(brandRoot, '.omega', 'cache', 'update.json');
}

/**
 * @param {string} brandRoot - The brand monorepo root.
 * @returns {{ version: number, targets: Object }} The cache, or an empty one.
 */
function readCache(brandRoot) {
  let data = null;

  try {
    data = jetpack.read(cacheFile(brandRoot), 'json');
  } catch {
    data = null;
  }

  if (data?.version !== CACHE_VERSION || typeof data.targets !== 'object' || data.targets === null) {
    return { version: CACHE_VERSION, targets: {} };
  }

  return data;
}

/**
 * @param {string} brandRoot - The brand monorepo root.
 * @param {Object} cache - The cache to persist.
 */
function writeCache(brandRoot, cache) {
  try {
    jetpack.write(cacheFile(brandRoot), cache);
  } catch (error) {
    console.log(`      ${chalk.yellow('⚠')} update cache not written${chalk.dim(`: ${error.message}`)}`);
  }
}

module.exports = { readCache, writeCache, cacheFile, CACHE_VERSION };
