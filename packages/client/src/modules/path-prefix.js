/**
 * The base path this page is mounted under (#355), read off the stamp the web
 * build's HTML pass writes on `<html data-omega-path-prefix>`.
 *
 * Mirrors the web package's runtime helper (core/js/libs/path-prefix.js) rather
 * than importing across the package boundary — nothing else is shared between
 * the two runtimes today. One difference, deliberate: the domain root reads as
 * '' here, so a caller concatenates without a special case.
 */

// '' (domain root) or '/workkit'-shaped, no trailing slash.
export function pathPrefix() {
  // Every absence means the same thing — a site at the domain root: no stamp,
  // no document (a worker scope), or a surface whose DOM has no <html> yet.
  const stamped = typeof document === 'undefined'
    ? ''
    : document.documentElement?.dataset?.omegaPathPrefix;

  return stamped === '/' ? '' : (stamped || '');
}

export default pathPrefix;
