/**
 * resolve.mjs — the `page.resolved` equivalent for the Astro candidate.
 *
 * Astro has no layout-frontmatter data cascade, so layout defaults live as
 * `export const defaults = {…}` in each layout component; chained layouts
 * merge their parent's defaults at module scope (see any blueprint layout).
 * `computeResolved()` then deep-merges page frontmatter OVER the layout
 * chain's defaults — page keys win, layout-only keys survive — matching
 * inject-properties.rb / Eleventy's native cascade.
 */

// Frontmatter keys that are engine machinery, not page data
const RESOLVED_OMIT = new Set(['layout', 'permalink', 'eleventyExcludeFromCollections', 'pagination']);

/**
 * Deep-merge `over` onto `base`: objects merge recursively, arrays and
 * scalars replace (page arrays win whole — same as the Jekyll behavior).
 * @param {object} base
 * @param {object} over
 * @returns {object} new object
 */
export function deepMerge(base, over) {
  const out = { ...base };
  for (const key of Object.keys(over || {})) {
    const a = out[key];
    const b = over[key];
    out[key] = isPlainObject(a) && isPlainObject(b) ? deepMerge(a, b) : b;
  }
  return out;
}

/**
 * Compute the resolved page data: page frontmatter over layout defaults.
 * @param {object} layoutDefaults - the layout chain's merged defaults
 * @param {object} data - page frontmatter (already Liquid-rendered)
 * @returns {object}
 */
export function computeResolved(layoutDefaults, data) {
  const page = {};
  for (const key of Object.keys(data)) {
    if (!RESOLVED_OMIT.has(key)) page[key] = data[key];
  }
  return deepMerge(layoutDefaults || {}, page);
}

/**
 * Normalize a Jekyll layout name to the theme-relative form, including the
 * legacy bracket hack — `themes/[ site.theme.id ]/frontend/core/base` (the
 * bracket ref is Liquid-rendered by the frontmatter resolver first, so this
 * sees `themes/<id>/frontend/core/base`). Unlike Eleventy (where layout
 * values resolve before any data hook), Astro lets us normalize in plain JS.
 * @param {string} name
 * @returns {string|null}
 */
export function normalizeLayout(name) {
  if (!name) return null;
  return String(name)
    .trim()
    .replace(/^themes\/[^/]+\/frontend\//, '')
    .replace(/\.html$/, '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
