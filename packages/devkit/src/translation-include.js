/**
 * The `translation.exclude` → `translation.include` conversion, shared by the
 * brand-root migrate table and the web leg's UJM converter: one rule, two
 * migration callers. Running code never reads the old key.
 */

/**
 * Every route the brand skipped becomes a negation on top of `**`, in the
 * order written, normalized the way the translation pass normalizes routes
 * (no leading or trailing slash). A carrying brand keeps translating exactly
 * what it translated before, never the framework's newer default.
 * @param {*} value - the authored `exclude` list
 * @returns {string[]} the `include` list that means the same thing
 */
function excludeToInclude(value) {
  const routes = Array.isArray(value) ? value : [];

  return ['**', ...routes.map((entry) => `!${String(entry).replace(/^\/+|\/+$/g, '')}`)];
}

module.exports = { excludeToInclude };
