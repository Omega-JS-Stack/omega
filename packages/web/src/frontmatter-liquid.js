/**
 * Frontmatter-value Liquid rendering (cached) — the Eleventy home for
 * jekyll-uj-powertools' variable_resolver behavior: corpus frontmatter carries
 * `{{ site.* }}` refs in values ("… - {{ site.brand.name }}").
 *
 * Site-only values render against the CONSTANT site global and cache by raw
 * source — across 1030 posts most frontmatter templates repeat. Every other
 * value bypasses the cache: per-page values (`page.*`, `resolved.*`, and the
 * page's own pagination alias — #544) render against the caller's per-page
 * scope, and a value reaching for the consumer's `_data` globals (#542)
 * renders against the SAME cascade a template render gets. Which lane a value
 * takes is decided by its variable ROOTS, read with LiquidJS's own analyzer.
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
const PER_PAGE_ROOTS = new Set(['page', 'resolved']);

// The same test on the raw source, for the values LiquidJS cannot parse (a
// frontmatter string reaching for an omega_* TAG this engine never registers):
// no roots to classify, so the resolver falls back to what it always did.
const PER_PAGE_RE = /\b(?:page|resolved)\./;

/**
 * Create a resolver bound to a site global.
 * @param {object} options
 * @param {object} options.site - the `site.*` global (constant per build)
 * @returns {{ render(value: string): string, resolveData(data: object): void, renderData(data: object): object, cacheSize(): number }}
 */
function createFrontmatterResolver(options) {
  const engine = new Liquid();
  for (const [name, fn] of Object.entries(FILTER_NAMES)) engine.registerFilter(name, fn);
  const scope = { site: options.site };
  const cache = new Map();
  const rootsCache = new Map();

  /**
   * Every top-level variable a value reads, via LiquidJS's own analyzer — a
   * regex would have to model filters, string literals and for-loop locals.
   * Memoized by raw source beside the render cache: most frontmatter repeats.
   * @param {string} value
   * @returns {string[]|null} the roots, or null when LiquidJS cannot parse it
   */
  function rootsOf(value) {
    if (rootsCache.has(value)) return rootsCache.get(value);
    let roots = null;
    try {
      roots = engine.globalVariablesSync(value);
    } catch { /* unparseable here — the render below raises the real error */ }
    rootsCache.set(value, roots);
    return roots;
  }

  /**
   * The cascade bindings a value's roots need, by NAME (`{{ brands.size }}`
   * reads a bare `brands`, not `site.brands`) — #542. Only the roots the value
   * actually reads are touched: the cascade holds foreign objects whose
   * getters throw before render.
   * @param {object} [globals] - the template's data cascade
   * @param {string[]|null} roots
   * @returns {object}
   */
  function bindRoots(globals, roots) {
    const bound = {};
    if (!globals || !roots) return bound;
    for (const root of roots) {
      if (root !== 'site' && root in globals) bound[root] = globals[root];
    }
    return bound;
  }

  /**
   * Render a single frontmatter string value (Liquid), cached.
   * Per-page values (`page.*` recipe meta, `resolved.*` layout defaults, and
   * the page's own pagination alias) render UNCACHED against `extraScope`;
   * site-only values are build-constant and cache by raw source; everything
   * else renders uncached against the template's own cascade.
   * @param {string} value
   * @param {object} [extraScope] - per-page scope ({ resolved, page, <alias> })
   * @param {object} [context] - { globals, defer, strict, file } — see resolveData
   * @returns {string}
   */
  function render(value, extraScope, context = {}) {
    const roots = rootsOf(value);
    const perPage = roots === null
      ? PER_PAGE_RE.test(value)
      : roots.some((root) => PER_PAGE_ROOTS.has(root) || (context.defer && context.defer.has(root)));
    if (perPage) {
      // Per-page: WITHOUT a page scope, defer (leave raw) — the engine's
      // `resolved` computed re-renders with { resolved, page } once the
      // cascade is merged; rendering here would empty the refs (no scope)
      // and mutate layout objects SHARED across pages.
      if (!extraScope) return value;
      return engine.parseAndRenderSync(value, { ...scope, ...bindRoots(context.globals, roots), ...extraScope });
    }

    // Build-constant — `site.*` alone, or no refs at all — is the cacheable
    // lane. A value reading anything else renders against the cascade, per
    // template: what a global holds is not the resolver's to assume.
    const siteOnly = roots !== null && roots.every((root) => root === 'site');
    if (siteOnly && cache.has(value)) return cache.get(value);

    if (context.strict) assertRootsDefined(value, roots, context);

    let rendered = value;
    if (rendered.includes('{{') || rendered.includes('{%')) {
      rendered = engine.parseAndRenderSync(rendered, siteOnly ? scope : { ...scope, ...bindRoots(context.globals, roots) });
    }

    if (siteOnly) cache.set(value, rendered);
    return rendered;
  }

  /**
   * The loud half of #544: a meta value whose root nothing in the cascade
   * defines is a spelling mistake, and a meta value renders ONCE and CACHES —
   * so rendering it would ship an empty string on every page sharing the
   * value (280 trusteroo brand pages under one nameless title). Only the ROOT
   * is checked: `{{ site.meta.keywords }}` on a brand that sets no keywords is
   * a legit empty optional and passes.
   * @param {string} value
   * @param {string[]|null} roots
   * @param {object} context - { globals, file }
   */
  function assertRootsDefined(value, roots, context) {
    if (!roots || !context.globals) return;
    const missing = roots.filter((root) => root !== 'site' && !(root in context.globals));
    if (!missing.length) return;
    throw new Error(
      `[@omega.js/web:frontmatter-liquid] ${context.file || 'unknown template'}: meta value "${value}" reads `
      + `${missing.map((root) => `\`${root}\``).join(', ')} — nothing in this page's data defines that. `
      + 'A meta value renders once and caches, so this would ship as an empty string on every page that shares it. '
      + 'Name the page\'s pagination alias (it defers to render time), spell a layout/page value `resolved.<key>`, or fix the typo.',
    );
  }

  /**
   * Deep-walk a frontmatter data object, rendering every string value that
   * contains Liquid refs, in place. The engine-machinery keys (DEFAULT_SKIP:
   * collections, pagination, permalink, globals…) are left alone — Eleventy
   * renders dynamic permalinks itself, and machinery subtrees contain other
   * templates' raw content.
   *
   * This is the CACHE-TIME pass, which is why `meta` walks strict (#544): it
   * is the subtree whose values render once, cache, and ship into every page's
   * head. Everything else keeps rendering whatever the cascade gives it.
   * @param {object} data
   * @param {object} [context] - { globals: the data cascade (#542), defer: Set of per-page roots (a pagination alias), file: inputPath }
   */
  function resolveData(data, context) {
    const seen = new WeakSet();
    for (const key of Object.keys(data)) {
      if (DEFAULT_SKIP.has(key)) continue;
      const keyContext = key === 'meta' ? { ...context, strict: true } : context;
      if (typeof data[key] === 'string') data[key] = maybeRender(data[key], undefined, keyContext);
      else walk(data[key], seen, keyContext);
    }
  }

  function walk(node, seen, context, extraScope) {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') node[i] = maybeRender(node[i], extraScope, context);
        else walk(node[i], seen, context, extraScope);
      }
      return;
    }

    for (const key of Object.keys(node)) {
      if (typeof node[key] === 'string') node[key] = maybeRender(node[key], extraScope, context);
      else walk(node[key], seen, context, extraScope);
    }
  }

  function maybeRender(value, extraScope, context) {
    return value.includes('{{') ? render(value, extraScope, context) : value;
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
   * @param {object} [context] - { globals, file } — the cascade a `_data` ref resolves against (#542)
   * @returns {object} rendered tree (original object when nothing changed)
   */
  function renderData(data, extraScope, context) {
    const seen = new WeakSet();

    const transform = (node) => {
      if (typeof node === 'string') return maybeRender(node, extraScope, context);
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
