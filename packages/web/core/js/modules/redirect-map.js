/**
 * Path-redirect module (#442) — the 404 page's half of `targets.web.redirects`.
 *
 * Static hosting serves the built 404 page for any path it has no file for,
 * which makes that page the only place a pattern redirect can be answered: the
 * build inlines the compiled map on #omega-redirect-map's `data-redirects`
 * attribute — the sibling redirect module's own idiom, and the one the
 * production minify pass cannot touch (an inline `application/json` script
 * goes through the inline-script lane, where esbuild drops the blob as a
 * side-effect-free expression) — and this module hops before the page's own
 * 404 chrome has anything to say. A page with no map ships neither the
 * attribute nor this bundle.
 */
// Relative, not the __main_assets__ alias: modules/ builds in the legacy IIFE
// lane (src/assets.js), whose esbuild pass carries no layer-alias plugin.
import { createLogger } from '../libs/logger.js';
import { matchRedirect } from '../libs/redirect-map.js';
import { pathPrefix, siteUrl } from '../libs/path-prefix.js';

const logger = createLogger('redirect-map');

const applyRedirect = () => {
  const $map = document.getElementById('omega-redirect-map');
  if (!$map) return;

  let entries;
  try {
    entries = JSON.parse($map.getAttribute('data-redirects'));
  } catch (error) {
    logger.error('Redirect map is not readable JSON:', error);
    return;
  }

  // The map is written in SITE paths; a site mounted under a base path
  // (#355) receives them prefixed, so the prefix comes off before matching
  // and goes back on the destination.
  const prefix = pathPrefix();
  const pathname = prefix !== '/' && window.location.pathname.startsWith(prefix)
    ? window.location.pathname.slice(prefix.length) || '/'
    : window.location.pathname;

  const target = matchRedirect(entries, pathname);
  if (!target) return;

  const destination = /^https?:\/\//i.test(target) ? target : siteUrl(target);

  logger.log(`Redirecting ${pathname} → ${destination}`);

  // replace(), not assign(): the 404 page was never a destination, and Back
  // must return where the visitor came from.
  window.location.replace(destination);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyRedirect);
} else {
  applyRedirect();
}
