/**
 * jekyll-compat.js: the retired Jekyll-era filter names, each mapped to its
 * omega_* successor in the filter pack (filters.js).
 *
 * Every old name stays registered as a thrower, so an unmigrated template
 * fails its build naming the fix. `omega migrate`'s compat-filters rule and the
 * liquid-lint's jekyll-filter check read the same table.
 */

// Old filter name => the omega_* name that replaces it
const COMPAT_REPLACEMENTS = {
  slugify: 'omega_slugify',
  date_to_xmlschema: 'omega_date_xmlschema',
  date_to_rfc822: 'omega_date_rfc822',
  jsonify: 'omega_jsonify',
  strip_html: 'omega_strip_html',
  number_of_words: 'omega_number_of_words',
  where_exp: 'omega_where',
  group_by_exp: 'omega_group_by',
  relative_url: 'omega_relative_url',
  absolute_url: 'omega_absolute_url',
  markdownify: 'omega_markdownify',
};

/**
 * The filter registered under a retired name: it throws naming the replacement.
 * @param {string} oldName - a COMPAT_REPLACEMENTS key
 * @returns {function}
 */
function jekyllFilter(oldName) {
  // A name outside the table is a caller bug, never a template's
  if (!Object.hasOwn(COMPAT_REPLACEMENTS, oldName)) {
    throw new Error(`[@omega.js/template-kit] ${oldName} is not a retired Jekyll filter`);
  }

  const replacement = COMPAT_REPLACEMENTS[oldName];
  return function retiredJekyllFilter() {
    throw new Error(`[@omega.js/template-kit] ${oldName} is a Jekyll filter: use ${replacement} `
      + '(npx omega migrate --target=<name> --execute rewrites it)');
  };
}

module.exports = { COMPAT_REPLACEMENTS, jekyllFilter };
