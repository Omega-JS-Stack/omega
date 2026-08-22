/**
 * The browser half of the path-redirect map (#442). The build compiles every
 * `targets.web.redirects` entry to a regex source + a replacement string
 * (src/redirects.js — the ONE pattern engine) and ships them in the 404 page;
 * all that is left here is applying them, which is why this file parses
 * nothing.
 *
 * Pure and DOM-free on purpose: the module that reads the page and performs
 * the hop is modules/redirect-map.js.
 */

/**
 * The destination for a request path, or null when nothing maps it. Entries
 * are ORDERED — first match wins, the same rule the dev server serves.
 * @param {Array<{ pattern: string, target: string }>} entries - the shipped map
 * @param {string} pathname - the site-relative request path
 * @returns {string|null}
 */
export function matchRedirect(entries, pathname) {
  if (!Array.isArray(entries) || typeof pathname !== 'string') return null;

  for (const entry of entries) {
    const expression = new RegExp(entry.pattern);
    if (expression.test(pathname)) {
      return pathname.replace(expression, entry.target);
    }
  }

  return null;
}
