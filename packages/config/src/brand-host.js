/**
 * The host a resolved config's BRAND lives on: one Firebase project, one
 * backend and one persona domain shared by every target the brand runs.
 *
 * Browser-safe and stdlib-only (the global `URL`), so a browser surface can
 * answer the same question from the same function the Node side runs.
 */

/**
 * The brand's host. `brand.url` answers first; the top-level `url` (the
 * target's own public url) is only the fallback for a config that carries no
 * brand.url at all, because reading them the other way round puts a non-main
 * target on a different host than the backend its brand shares.
 * @param {object} config - The resolved config object.
 * @returns {string} The lowercase hostname, or '' when no URL is known.
 */
function resolvedBrandHost(config) {
  const url = config?.brand?.url || config?.url;

  if (typeof url !== 'string' || !url) {
    return '';
  }

  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

module.exports = { resolvedBrandHost };
