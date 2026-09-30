/**
 * head-globals: the values head.html needs from a JS home that Liquid cannot
 * reach, registered as Eleventy globals so the template prints the one home's
 * answer instead of keeping a copy of its own.
 */
const { ogLocale } = require('@omega.js/devkit/translate');
const { applyStagger } = require('@omega.js/client/modules/reveal-stagger.js');

/**
 * Register the head's computed globals.
 * @param {object} eleventyConfig - the Eleventy config API
 * @param {object} options
 * @param {string} options.language - the site's default language code
 */
function registerHeadGlobals(eleventyConfig, { language }) {
  // og:locale wants Open Graph's language_TERRITORY form (en → en_US), and the
  // code → locale map is the devkit language SSOT.
  eleventyConfig.addGlobalData('ogLocale', ogLocale(language));
  // The inline first-paint starter cannot import the motion engine, so it runs
  // the engine's own applyStagger, printed from its source.
  eleventyConfig.addGlobalData('revealStagger', String(applyStagger));
}

module.exports = { registerHeadGlobals };
