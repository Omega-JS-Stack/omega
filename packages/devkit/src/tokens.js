/**
 * The ONE `{{ path }}` token renderer the framework builds share: desktop and
 * extension render views, page templates, manifests and store descriptions
 * with it, and the defaults engine and every scaffold render templates with it.
 * A token nothing resolves passes through literally, so each caller asks
 * `unresolvedTokens()` what is left and decides its fate.
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

/**
 * The error a build fails a view with when tokens are left in it.
 *
 * @param {string} view - The view's path from the project root.
 * @param {string[]} tokens - The leftovers `unresolvedTokens()` named.
 * @returns {Error} The error naming the view, each leftover and where to look.
 */
function unresolvedTokensError(view, tokens) {
  return new Error(`Cannot build ${view}: unresolved token(s) ${tokens.join(', ')}. Check config/omega.json5 and the token spelling`);
}

module.exports = { renderTokens, unresolvedTokens, unresolvedTokensError };
