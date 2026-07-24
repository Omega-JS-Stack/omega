/**
 * npm-registry — minimal npm registry reads shared by every framework CLI
 * (replaces the unmaintained npm-api dependency).
 *
 * Both functions treat network/registry failure as an expected external
 * condition and return null — callers decide their own fallback (skip the
 * check, assume up-to-date, warn). They never throw.
 */

const REGISTRY_URL = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 30 * 1000;

/**
 * Fetch a package's latest-version manifest (the `<registry>/<name>/latest`
 * document: version, dependencies, peerDependencies, …).
 *
 * @param {string} packageName - npm package name (scoped names supported)
 * @param {object} [options]
 * @param {string} [options.registryUrl] - registry base URL (test seam)
 * @param {number} [options.timeout] - fetch timeout in ms
 * @returns {Promise<object|null>} manifest object, or null on any failure
 */
async function getPackageManifest(packageName, options = {}) {
  const registryUrl = (options.registryUrl || REGISTRY_URL).replace(/\/$/, '');
  // Scoped names encode the slash but keep the leading @ (registry convention)
  const encoded = encodeURIComponent(packageName).replace(/^%40/, '@');

  try {
    const response = await fetch(`${registryUrl}/${encoded}/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeout || FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    return null;
  }
}

/**
 * Fetch a package's latest published version.
 *
 * @param {string} packageName - npm package name
 * @param {object} [options] - same options as getPackageManifest
 * @returns {Promise<string|null>} version string, or null on any failure
 */
async function getLatestVersion(packageName, options) {
  const manifest = await getPackageManifest(packageName, options);
  return (manifest && manifest.version) || null;
}

module.exports = { getPackageManifest, getLatestVersion };
