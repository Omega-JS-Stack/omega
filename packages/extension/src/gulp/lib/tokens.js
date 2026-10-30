/**
 * The `{{ path }}` token renderer the build tasks share: the html task renders
 * views and the page template with it, and the package task the manifest and
 * the store descriptions. A token nothing resolves passes through literally,
 * so each caller asks `unresolvedTokens()` what is left and decides its fate.
 */

const { template } = require('node-powertools');

/**
 * Render the `{{ path }}` tokens in `text` against `data`.
 *
 * @param {string} text - The text to render.
 * @param {object} data - The values the token paths resolve against.
 * @returns {string} The rendered text; an unresolved token stays as written.
 */
function renderTokens(text, data) {
  return template(text, data, { brackets: ['{{', '}}'] });
}

/**
 * The distinct `{{ }}` tokens left in rendered text: the ones nothing resolved.
 *
 * @param {string} text - Rendered text.
 * @returns {string[]} Each leftover token once, as written.
 */
function unresolvedTokens(text) {
  return [...new Set(text.match(/\{\{[^}]*\}\}/g) || [])];
}

module.exports = { renderTokens, unresolvedTokens };
