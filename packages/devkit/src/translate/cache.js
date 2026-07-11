/**
 * The committed translation cache — per-string maps keyed by a hash of the
 * SOURCE string, stored as reviewable JSON in the consumer's `translations/`
 * directory (committed to git, replacing both the legacy gitignored `.cache/`
 * and the cache-uj-translation GitHub-branch flow). A source edit changes the
 * hash → cache miss → only that string re-translates; a human can hand-fix a
 * translation VALUE and it sticks for as long as the source is unchanged.
 *
 * Layout: <rootDir>/<lang>/<namespace>.json  →  { "<hash12>": "translation" }
 * (namespace = a page path for web, 'messages'/'description' for extension).
 */
const path = require('node:path');
const crypto = require('node:crypto');
const jetpack = require('fs-jetpack');

/**
 * Cache key for a source string.
 * @param {string} source - the source-language string
 * @returns {string} 12-hex-char sha256 prefix
 */
function hashKey(source) {
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
}

/**
 * Resolve a namespace's cache file path.
 * @param {string} rootDir - translations root (e.g. <consumer>/translations)
 * @param {string} lang - language code
 * @param {string} namespace - cache namespace (slashes allowed)
 * @returns {string}
 */
function cachePath(rootDir, lang, namespace) {
  return path.join(rootDir, lang, `${namespace}.json`);
}

/**
 * Load a namespace's hash → translation map ({} when absent/corrupt).
 * @param {string} rootDir - translations root
 * @param {string} lang - language code
 * @param {string} namespace - cache namespace
 * @returns {object}
 */
function loadCache(rootDir, lang, namespace) {
  const file = cachePath(rootDir, lang, namespace);

  if (!jetpack.exists(file)) {
    return {};
  }

  try {
    return JSON.parse(jetpack.read(file)) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Save a namespace's map, pruned to the CURRENT source strings so stale
 * entries never accumulate. No-op delete when the map is empty.
 * @param {string} rootDir - translations root
 * @param {string} lang - language code
 * @param {string} namespace - cache namespace
 * @param {object} map - hash → translation
 * @param {string[]} [currentSources] - prune to these sources' hashes
 */
function saveCache(rootDir, lang, namespace, map, currentSources) {
  let pruned = map;

  if (currentSources) {
    const keep = new Set(currentSources.map(hashKey));
    pruned = Object.fromEntries(Object.entries(map).filter(([key]) => keep.has(key)));
  }

  const file = cachePath(rootDir, lang, namespace);

  if (!Object.keys(pruned).length) {
    jetpack.remove(file);
    return;
  }

  jetpack.write(file, `${JSON.stringify(pruned, null, 2)}\n`);
}

module.exports = { hashKey, cachePath, loadCache, saveCache };
