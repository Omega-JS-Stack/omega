/**
 * Which page routes the translation pass sends to a provider
 * ([#858](https://github.com/Omega-JS-Stack/omega/issues/858), Ian 2026-09-13).
 *
 * The config key used to be `translation.exclude`, a plain list of routes to
 * skip that defaulted to nothing: a brand that never thought about it paid a
 * provider for every post it had. `translation.include` is the inverse and
 * carries a real default (`['**', '!blog/**']`: the whole site except the
 * blog, which is where the words pile up), so the framework's answer is the
 * one a brand gets for free.
 *
 * The list reads like a .gitignore: patterns in ORDER, `!` negates, and the
 * LAST pattern that matches a route decides it. A route no pattern matches at
 * all is not translated, so an empty list translates nothing. A brand list
 * REPLACES the default outright (arrays replace at every level of the merge
 * chain, @omega.js/config's src/merge.js), never half of each.
 *
 * A page overrides the list for itself with `translation.include: true`/`false`
 * in its own frontmatter, the same key name one level down (Ian's 2026-09-09
 * same-name ruling). The build stamps that answer on `<html>`, the same seam
 * #355's base path uses, because the pass runs post-build over dist/ and
 * `omega translate` runs standalone, with no frontmatter in reach either way.
 *
 * None of this touches the framework's OWN default pages: their exclusion is
 * DERIVED from the packaged defaults tree (./default-routes.js, #605) and no
 * brand list or page stamp can put one back in front of a provider.
 */
const { minimatch } = require('minimatch');
const { TRANSLATION_INCLUDE_DEFAULT } = require('@omega.js/config/schema');
const { readHtmlStamp } = require('../html-stamp.js');

// The stamp the root layout writes when a page declares `translation.include`.
// Quoting is optional: production HTML goes through the minifier on its way to
// dist, and a stamp read is not the place to find out it dropped the quotes,
// so the read goes through the ONE tolerant reader (src/html-stamp.js).
const TRANSLATE_STAMP = 'data-omega-translate';

/**
 * A route as the list matches it: no leading or trailing slash, so `/docs/`,
 * `docs` and `/docs` are one route. Same normalization the exclusion sets have
 * always used.
 * @param {string} value
 * @returns {string}
 */
function normalizeRoute(value) {
  return String(value == null ? '' : value).replace(/^\/+|\/+$/g, '');
}

/**
 * Does one pattern match this route? A folder pattern covers the folder
 * ITSELF as well as its contents (`blog/**` matches `blog`, `blog/post-1` and
 * `blog/page/2`), which is the subtree semantics every exclusion set in the
 * pass already has: minimatch alone would leave the listing page translated
 * while skipping every post under it.
 * @param {string} route - normalized route
 * @param {string} pattern - normalized pattern, `!` already stripped
 * @returns {boolean}
 */
function matches(route, pattern) {
  if (minimatch(route, pattern)) return true;

  return pattern.endsWith('/**') && minimatch(route, pattern.slice(0, -3));
}

/**
 * Is this route translated, given an include list? The LAST pattern that
 * matches decides; no match at all means no.
 * @param {string} route - a built page's route ('' is the home page)
 * @param {string[]} patterns - the `translation.include` list
 * @returns {boolean}
 */
function routeIncluded(route, patterns) {
  const normalized = normalizeRoute(route);
  let included = false;

  for (const entry of patterns || []) {
    const negated = String(entry).startsWith('!');
    const pattern = normalizeRoute(negated ? String(entry).slice(1) : entry);

    if (matches(normalized, pattern)) included = !negated;
  }

  return included;
}

/**
 * The include list a resolved config carries. A load through @omega.js/config
 * always resolves the schema default into it; a caller that hand-built a
 * config (a test, a fixture) gets the same framework answer here rather than a
 * silently empty list, which would translate nothing.
 * @param {object} config - resolved config
 * @returns {string[]}
 */
function includePatterns(config) {
  const include = config && config.translation && config.translation.include;

  return Array.isArray(include) ? include : TRANSLATION_INCLUDE_DEFAULT;
}

/**
 * A page's own answer, off the `<html>` stamp: true (translate me), false
 * (do not), or null when the page said nothing and the list decides.
 * @param {string} html - a built page
 * @returns {boolean|null}
 */
function readTranslateStamp(html) {
  const value = readHtmlStamp(html, TRANSLATE_STAMP);
  if (value === null) return null;

  return value === 'true' ? true : (value === 'false' ? false : null);
}

module.exports = { routeIncluded, includePatterns, readTranslateStamp, normalizeRoute };
