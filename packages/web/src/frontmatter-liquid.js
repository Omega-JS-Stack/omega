/**
 * Frontmatter-value Liquid rendering (cached) — the Eleventy home for
 * jekyll-uj-powertools' variable_resolver behavior: corpus frontmatter carries
 * `{{ site.* }}` refs in values ("… - {{ site.brand.name }}").
 *
 * Site-only values render against the CONSTANT site global and cache by raw
 * source — across 1030 posts most frontmatter templates repeat. Per-page
 * values (`page.*`, `resolved.*`) bypass the cache entirely.
 *
 * The context-free omega_* filters are registered here too: LiquidJS drops an
 * unknown filter SILENTLY (the value passes through un-filtered), so a
 * frontmatter value reaching for one used to lose it with no signal — the
 * taxonomy pages' `meta.title` needs omega_title_case (#294). Only the pure
 * filter pack: the omega_* TAGS need the collection/icon wiring the render
 * engine owns, and nothing may render a section at frontmatter time.
 */
const { Liquid } = require('liquidjs');
const { FILTER_NAMES } = require('@omega.js/template-kit/filters');

// Engine-machinery keys the frontmatter walker must never enter: dynamic
// permalinks belong to Eleventy, and the rest hold globals or other
// templates' raw content (which may contain unregistered tags).
// sectionLibrary is the showcase's data source — its demo args liquify at
// the section tag's CALL SITE, never at frontmatter time (walking here would
// bake the first page's rendering into the shared global).
const DEFAULT_SKIP = new Set([
  'permalink', 'pagination', 'collections', 'eleventy', 'pkg', 'page',
  'content', 'site', 'assetManifest', 'eleventyComputed', 'resolved',
  'sectionLibrary',
]);

// Per-page refs: `page.*` (the real sweet-saucy recipe meta) and `resolved.*`
// (layout defaults templating on the merged cascade — cover's align knob,
// the base alternative competitor values). These render UNCACHED against
// the caller's per-page scope; the raw-string cache would serve the first
// page's rendering to every page.
const PER_PAGE_RE = /\b(?:page|resolved)\./;

/**
 * Create a resolver bound to a site global.
 * @param {object} options
 * @param {object} options.site - the `site.*` global (constant per build)
 * @returns {{ render(value: string): string, resolveData(data: object): void, cacheSize(): number }}
 */
function createFrontmatterResolver(options) {
  const engine = new Liquid();
  for (const [name, fn] of Object.entries(FILTER_NAMES)) engine.registerFilter(name, fn);
  const scope = { site: options.site };
  const cache = new Map();

  /**
   * Render a single frontmatter string value (Liquid), cached.
   * Per-page values (PER_PAGE_RE: `page.*` recipe meta, `resolved.*` layout
   * defaults) render UNCACHED against `extraScope`; site-only values are
   * build-constant and cache by raw source.
   * @param {string} value
   * @param {object} [extraScope] - per-page scope ({ resolved, page })
   * @returns {string}
   */
  function render(value, extraScope) {
    if (PER_PAGE_RE.test(value)) {
      // Per-page: WITHOUT a page scope, defer (leave raw) — the engine's
      // `resolved` computed re-renders with { resolved, page } once the
      // cascade is merged; rendering here would empty the refs (no scope)
      // and mutate layout objects SHARED across pages.
      if (!extraScope) return value;
      return engine.parseAndRenderSync(value, { ...scope, ...extraScope });
    }

    if (cache.has(value)) return cache.get(value);

    let rendered = value;
    if (rendered.includes('{{') || rendered.includes('{%')) {
      rendered = engine.parseAndRenderSync(rendered, scope);
    }

    cache.set(value, rendered);
    return rendered;
  }

  /**
   * Deep-walk a frontmatter data object, rendering every string value that
   * contains Liquid refs, in place. Top-level keys in `skip` are
   * left alone — the caller passes the engine-machinery keys (collections,
   * pagination, permalink, globals…): Eleventy renders dynamic permalinks
   * itself, and machinery subtrees contain other templates' raw content.
   * @param {object} data
   * @param {Set<string>} [skip]
   */
  function resolveData(data, skip = DEFAULT_SKIP, extraScope) {
    const seen = new WeakSet();
    for (const key of Object.keys(data)) {
      if (skip.has(key)) continue;
      if (typeof data[key] === 'string') data[key] = maybeRender(data[key], extraScope);
      else walk(data[key], seen, extraScope);
    }
  }

  function walk(node, seen, extraScope) {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') node[i] = maybeRender(node[i], extraScope);
        else walk(node[i], seen, extraScope);
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (typeof node[key] === 'string') node[key] = maybeRender(node[key], extraScope);
      else walk(node[key], seen, extraScope);
    }
  }

  function maybeRender(value, extraScope) {
    return value.includes('{{') ? render(value, extraScope) : value;
  }

  /**
   * Copy-on-write render pass over a data tree: returns the SAME references
   * wherever nothing needed rendering, and shallow copies only along paths
   * where a string rendered. Safe for per-page `resolved` computation —
   * cascade sub-objects shared across pages are never mutated, and foreign
   * objects with throwing getters (Eleventy collection items expose a
   * templateContent getter that throws before render) stay opaque.
   * @param {object} data
   * @param {object} [extraScope] - per-page scope ({ page }) for page refs
   * @returns {object} rendered tree (original object when nothing changed)
   */
  function renderData(data, extraScope) {
    const seen = new WeakSet();

    const transform = (node) => {
      if (typeof node === 'string') return maybeRender(node, extraScope);
      if (node === null || typeof node !== 'object' || seen.has(node)) return node;
      // Eleventy collection items (pagination aliases carry them, e.g. a
      // taxonomy group's `posts`) stay opaque — checked WITHOUT touching the
      // getter: templateContent THROWS before render, and constructing those
      // errors per item per page was a measured corpus hotspot (~19% CPU).
      if ('templateContent' in node) return node;
      seen.add(node);

      let entries;
      try {
        entries = Object.entries(node);
      } catch {
        return node; // foreign object (throwing getter) — leave opaque
      }

      let copy = null;
      for (const [key, value] of entries) {
        const next = transform(value);
        if (next !== value && copy === null) copy = Array.isArray(node) ? [...node] : { ...node };
        if (copy !== null && next !== value) copy[key] = next;
      }
      return copy === null ? node : copy;
    };

    return transform(data);
  }

  return { render, resolveData, renderData, cacheSize: () => cache.size };
}

module.exports = { createFrontmatterResolver };
