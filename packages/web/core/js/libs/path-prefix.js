/**
 * The browser half of base-path support (#355) — where the runtime builds a
 * same-site URL, it builds it under the path the site is actually mounted at.
 *
 * The value is a BUILD fact (the publisher's `OMEGA_PATH_PREFIX`, normalized by
 * src/path-prefix.js), stamped on `<html data-omega-path-prefix>` by the
 * build's HTML pass. Read from the DOM rather than baked into the bundle so
 * there is exactly ONE mechanism: the same emit step that mounts every href and
 * src hands the value to the runtime, and a site served at the domain root
 * ships no stamp at all — hence the `/` fallback.
 *
 * Page IDENTITY is a different thing and stays unprefixed: `data-page-path` is
 * the site-relative route, which is what route comparisons (/signin, /pricing)
 * are written against.
 */

/**
 * The base path this page is mounted under.
 * @returns {string} '/workkit'-shaped (no trailing slash), or '/' at the domain root
 */
export function pathPrefix() {
  // Every absence means the same thing — a site at the domain root: no stamp,
  // no document (a worker scope), or a surface whose DOM has no <html> yet.
  const stamped = typeof document === 'undefined'
    ? ''
    : document.documentElement?.dataset?.omegaPathPrefix;

  return stamped || '/';
}

/**
 * Mount a root-relative site path under the base path. Anything else — an
 * absolute or protocol-relative URL, a bare-relative path, an anchor — already
 * resolves correctly and passes through.
 * @param {string} path - e.g. '/assets/fa/solid/star.svg'
 * @returns {string}
 */
export function siteUrl(path) {
  const prefix = pathPrefix();
  if (prefix === '/' || typeof path !== 'string') return path;
  if (!path.startsWith('/') || path.startsWith('//')) return path;

  return `${prefix}${path}`;
}
