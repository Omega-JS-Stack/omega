/**
 * The default-page translations PACKAGED with @omega.js/web (#621).
 *
 * Every brand renders the SAME framework chrome on its auth, account, payment
 * and portal screens, so before #605 every brand paid a provider to translate
 * the identical strings, and after it those pages shipped in English. The
 * framework translates them ONCE (./generate-defaults.js), commits the result
 * inside the package, and every consumer reads it: default routes stay out of
 * PROVIDER calls and still get their /{lang}/ copies.
 *
 * Layout: `<pkg>/translations/{lang}/pages/{route}.json` — the SAME
 * `{lang}/{namespace}.json` shape as a consumer's own committed cache, loaded
 * by the same devkit loader, so a packaged file is reviewable, hand-fixable
 * and pruned exactly like one.
 *
 * The one difference is the KEY. A consumer's cache hashes the string as its
 * own site rendered it, brand name and all; the packaged one is brand-NEUTRAL
 * — the generator replaces its fixture brand with the SENTINEL before hashing,
 * and the read-through replaces the consumer's own brand name with the same
 * token before the lookup, then puts it back on the way out. "Sign in to
 * OmegaBrandFixture" and "Sign in to MiniCo" are one packaged entry.
 */
const jetpack = require('fs-jetpack');
const { hashKey, loadCache, LANGUAGE_NAMES } = require('@omega.js/devkit/translate');
const { PATHS } = require('../paths.js');

// The brand-name placeholder inside a packaged translation. Deliberately
// unmistakable: it must survive a round trip through a translation model
// (the generator names it in the prompt's extra rules) and it must never
// collide with real page copy.
const SENTINEL = '__OMEGA_BRAND__';

/**
 * The cache namespace a page route is stored under — the packaged cache and a
 * consumer's own cache spell it the same way.
 * @param {string} route - route in routeOf() shape ('' for the home page)
 * @returns {string}
 */
function pageNamespace(route) {
  return `pages/${route || 'home'}`;
}

/**
 * Replace a brand's name with the sentinel, so the string hashes the same for
 * every brand that renders it.
 * @param {string} text - the rendered source string
 * @param {string} brand - the brand name as it appears in the render
 * @returns {string}
 */
function normalizeBrand(text, brand) {
  return brand ? text.split(brand).join(SENTINEL) : text;
}

/**
 * Put a brand's name back where the sentinel stands.
 * @param {string} text - a packaged translation
 * @param {string} brand - the consuming brand's name
 * @returns {string}
 */
function denormalizeBrand(text, brand) {
  return text.split(SENTINEL).join(brand);
}

/**
 * The languages @omega.js/web ships default-page translations for — read off
 * the packaged tree, never a list (adding a language is adding its folder).
 * @param {string} [root] - packaged translations root (tests override it)
 * @returns {string[]} known language codes, sorted
 */
function packagedLanguages(root) {
  return (jetpack.list(root || PATHS.translations) || [])
    .filter((entry) => Object.hasOwn(LANGUAGE_NAMES, entry))
    .sort();
}

/**
 * Load one route's packaged map for one language.
 * @param {string} root - packaged translations root
 * @param {string} lang - language code
 * @param {string} route - route in routeOf() shape
 * @returns {object} sentinel-keyed hash → translation ({} when the package
 *   ships nothing for this route/language)
 */
function loadPackaged(root, lang, route) {
  return loadCache(root, lang, pageNamespace(route));
}

/**
 * Resolve a page's source strings against a packaged map.
 * @param {object} options
 * @param {string[]} options.strings - the page's source strings, in collector order
 * @param {string} options.brand - the consuming brand's name
 * @param {object} options.cache - the packaged map for this route/language
 * @returns {{ translated: Array<string|undefined>, hits: number, misses: number }}
 *   translated is positionally aligned with strings; a miss is undefined, which
 *   the caller leaves in the source language
 */
function resolvePackaged(options) {
  const { strings, brand, cache } = options;
  const translated = new Array(strings.length);
  let hits = 0;

  strings.forEach((text, i) => {
    // A brand named after a word the chrome itself uses ("Sign", "Apply")
    // normalizes strings that never mention the brand — every occurrence goes,
    // brand-name or not — so a normalized miss tries the RAW key too: a string
    // with no brand in it was packaged under exactly that plain hash.
    const value = cache[hashKey(normalizeBrand(text, brand))] ?? cache[hashKey(text)];

    if (value !== undefined) {
      translated[i] = denormalizeBrand(value, brand);
      hits++;
    }
  });

  return { translated, hits, misses: strings.length - hits };
}

module.exports = {
  SENTINEL,
  pageNamespace,
  normalizeBrand,
  denormalizeBrand,
  packagedLanguages,
  loadPackaged,
  resolvePackaged,
};
