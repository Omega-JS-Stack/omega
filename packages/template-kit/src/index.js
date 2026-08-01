/**
 * index.js — @omega.js/template-kit public surface.
 *
 * The omega_* template filters/tags from jekyll-uj-powertools as plain,
 * engine-neutral JS, plus the Jekyll-compat filter pack and the LiquidJS
 * adapter. Eleventy path: `registerLiquid(engine, options)`. Astro/direct
 * path: import the functions and call them.
 */

const filters = require('./filters.js');
const { TAGS } = require('./tags/index.js');
const jekyllCompat = require('./jekyll-compat.js');
const { registerLiquid } = require('./register-liquid.js');
const variableResolver = require('./variable-resolver.js');
const { LANGUAGES } = require('./data/languages.js');
const { LANGUAGE_TO_COUNTRY } = require('./data/language-flags.js');
const { SOCIAL_URLS } = require('./data/social-urls.js');

module.exports = {
  filters,
  TAGS,
  jekyllCompat,
  registerLiquid,
  variableResolver,
  LANGUAGES,
  LANGUAGE_TO_COUNTRY,
  SOCIAL_URLS,
};
