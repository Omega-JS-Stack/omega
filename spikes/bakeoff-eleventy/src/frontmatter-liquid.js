/**
 * Frontmatter-value Liquid rendering (cached) — the Eleventy home for
 * jekyll-uj-powertools' variable_resolver behavior: corpus frontmatter carries
 * `{{ site.* }}` refs in values ("… - {{ site.brand.name }}") and the legacy
 * bracket hack in layout values (`themes/[ site.theme.id ]/frontend/core/base`).
 *
 * The scope is the CONSTANT site global, so rendered strings are cached by
 * their raw source — across 1030 posts most frontmatter templates repeat.
 */
const { Liquid } = require('liquidjs');

// Engine-machinery keys the frontmatter walker must never enter: dynamic
// permalinks belong to Eleventy, and the rest hold globals or other
// templates' raw content (which may contain unregistered tags).
const DEFAULT_SKIP = new Set([
  'permalink', 'pagination', 'collections', 'eleventy', 'pkg', 'page',
  'content', 'site', 'assetManifest', 'eleventyComputed', 'resolved',
]);

/**
 * Create a resolver bound to a site global.
 * @param {object} options
 * @param {object} options.site - the `site.*` global (constant per build)
 * @returns {{ render(value: string): string, resolveData(data: object): void, cacheSize(): number }}
 */
function createFrontmatterResolver(options) {
  const engine = new Liquid();
  const scope = { site: options.site };
  const cache = new Map();

  /**
   * Render a single frontmatter string value (bracket refs + Liquid), cached.
   * @param {string} value
   * @returns {string}
   */
  function render(value) {
    if (cache.has(value)) return cache.get(value);

    // Legacy bracket refs first ([ site.theme.id ] → {{ site.theme.id }})
    let rendered = value.replace(/\[\s*(site\.[a-zA-Z0-9_.]+)\s*\]/g, '{{ $1 }}');
    if (rendered.includes('{{') || rendered.includes('{%')) {
      rendered = engine.parseAndRenderSync(rendered, scope);
    }

    cache.set(value, rendered);
    return rendered;
  }

  /**
   * Deep-walk a frontmatter data object, rendering every string value that
   * contains Liquid or bracket refs, in place. Top-level keys in `skip` are
   * left alone — the caller passes the engine-machinery keys (collections,
   * pagination, permalink, globals…): Eleventy renders dynamic permalinks
   * itself, and machinery subtrees contain other templates' raw content.
   * @param {object} data
   * @param {Set<string>} [skip]
   */
  function resolveData(data, skip = DEFAULT_SKIP) {
    const seen = new WeakSet();
    for (const key of Object.keys(data)) {
      if (skip.has(key)) continue;
      if (typeof data[key] === 'string') data[key] = maybeRender(data[key]);
      else walk(data[key], seen);
    }
  }

  function walk(node, seen) {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') node[i] = maybeRender(node[i]);
        else walk(node[i], seen);
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (typeof node[key] === 'string') node[key] = maybeRender(node[key]);
      else walk(node[key], seen);
    }
  }

  function maybeRender(value) {
    return (value.includes('{{') || value.includes('[ site.')) ? render(value) : value;
  }

  return { render, resolveData, cacheSize: () => cache.size };
}

module.exports = { createFrontmatterResolver };
