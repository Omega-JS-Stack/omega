/**
 * The Eleventy engine core of @omega.js/web: layered themes (virtual templates
 * / symlink farm), template-kit registration on Eleventy's own LiquidJS
 * instance, frontmatter Liquid rendering, the `resolved` data alias
 * (page.resolved equivalent — native data cascade), Jekyll conventions (dated
 * post filenames, permalink normalization), blog collections + taxonomy, and
 * default pages as virtual templates suppressed by same-URL consumer files.
 * Promoted from the winning bake-off spike (spikes/bakeoff-shared/DECISION.md).
 */
const fs = require('node:fs');
const path = require('node:path');
const markdownIt = require('markdown-it');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { toSiteGlobal } = require('@omega.js/config/site-global');
const { createFrontmatterResolver } = require('./frontmatter-liquid.js');
const { collectLayered } = require('./layers.js');
const { permalinkOf, scanConsumerPermalinks } = require('./consumer-scan.js');
const { registerVirtualLayouts, composeSymlinkFarm } = require('./layouts.js');
const { registerCollections } = require('./collections.js');
const { PATHS } = require('./paths.js');

// Data-cascade keys that are engine machinery, not page/layout data — everything
// else IS the resolved page data (the cascade already deep-merged layout
// defaults under page frontmatter, which is exactly what inject-properties.rb
// computed as page.resolved).
const RESOLVED_OMIT = new Set([
  'collections', 'content', 'page', 'eleventy', 'pkg', 'eleventyComputed',
  'resolved', 'permalink', 'layout', 'tags', 'pagination', 'site', 'assetManifest',
  'paginator', 'pageAssets', 'jekyll',
]);

// Site keys that do NOT seed `resolved` (bulk/runtime values templates read
// via site.* directly — mirrors inject-properties.rb's config exclusions,
// which also dropped `collections`; seeding the site collection arrays
// would make every page's resolved walk all 1,030 post docs).
const RESOLVED_SITE_EXCLUDE = new Set(['data', 'uj', 'time', 'posts', 'team', 'updates', 'alternatives']);

// Plain-object deep merge (b wins) — fresh containers, never mutates either side.
// Deliberately NOT @omega.js/config's deepMerge: the resolved-data cascade
// merges VALUES pairwise (deepMerge(out[key], data[key])), so an explicit null
// in later data must REPLACE — config's variadic merge would skip it as a
// falsy layer.
function deepMerge(a, b) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const key of Object.keys(b)) out[key] = deepMerge(a[key], b[key]);
    return out;
  }
  return b === undefined ? a : b;
}

/**
 * Configure an Eleventy instance as an OMEGA web engine.
 * @param {object} eleventyConfig
 * @param {object} options
 * @param {string} options.consumerDir - the consumer site — Eleventy input dir
 * @param {object} options.siteData - raw site data (site-data.json shape / resolved omega config)
 * @param {string} [options.themesDir] - directory containing theme layer dirs (default: packaged themes)
 * @param {string} [options.coreDir] - the framework core layer (default: packaged core)
 * @param {string} [options.defaultsDir] - framework default pages dir (default: packaged defaults)
 * @param {string} [options.activeTheme] - theme id (default: siteData.theme.id)
 * @param {string} [options.layoutMode] - 'virtual' (default) or 'farm'
 * @param {string} [options.farmDir] - symlink-farm target (farm mode)
 * @param {object} [options.assetManifest] - js/css manifest from the asset build
 * @returns {object} internals exposed for tests ({ site, layers, frontmatter })
 */
function configureOmega(eleventyConfig, options) {
  const themesDir = options.themesDir || PATHS.themes;
  const coreDir = options.coreDir || PATHS.core;
  const defaultsDir = options.defaultsDir || PATHS.defaults;
  const site = toSiteGlobal(options.siteData);
  const activeTheme = options.activeTheme || (site.theme && site.theme.id) || 'classy';
  const layoutMode = options.layoutMode || 'virtual';

  // Reflect the active theme into the site global templates render against
  site.theme = { ...(site.theme || {}), id: activeTheme };

  // ---- Runtime composition: omega.json5 keeps ONE home per shared section
  // (cloud, payment at the top level); the chrome + client contract
  // reads them through site.web_manager (pricing loops over
  // site.web_manager.payment.products, the Configuration spread feeds the
  // client). Compose here — same bridge pattern as extension's package.js
  // mapping analytics.providers → the client's flat shape.
  site.web_manager = site.web_manager || {};
  if (site.cloud && site.cloud.config) {
    site.web_manager.firebase = site.web_manager.firebase || {};
    site.web_manager.firebase.app = site.web_manager.firebase.app || {};
    site.web_manager.firebase.app.config = site.cloud.config;
  }
  if (site.payment) site.web_manager.payment = site.payment;

  // ---- Theme layer chain: active theme → classy base → core
  const themeLayers = [...new Set([activeTheme, 'classy'])]
    .map((id) => path.join(themesDir, id));
  const layers = [...themeLayers, coreDir];

  // ---- LiquidJS: Jekyll include syntax + layered include roots.
  // timezoneOffset 0: filename dates are UTC midnights; rendering them in UTC
  // matches CI-built Jekyll output (Actions runners are UTC).
  // Consumer _includes first (somiibo's index includes
  // frontend/components/hero-demo.html from its own _includes), then layers.
  // EXISTING dirs only — LiquidJS probes every root per include lookup, and
  // a nonexistent root costs ~1s over the corpus (measured: 3.60→4.65s).
  const includeRoots = [path.join(options.consumerDir, '_includes'), ...layers.map((layer) => path.join(layer, '_includes'))]
    .filter((dir) => fs.existsSync(dir));
  eleventyConfig.setLiquidOptions({
    jekyllInclude: true,
    root: includeRoots,
    timezoneOffset: 0,
    // Parsed-template cache for includes: without it LiquidJS re-reads and
    // re-parses every {% include %} on every render — the real core chrome
    // (head/body/foot ≈ 885 lines) made that the corpus bottleneck
    // (40.6s → measured again with cache below). Keyed by resolved file
    // path, so theme switches (different winning path) stay correct.
    cache: true,
  });

  // ---- Jekyll site-data emulation.
  // site.data._includes.<path> mirrors UJM's json-in-_includes data system
  // (admin sidebar/topbar read site.data._includes.admin.sections.sidebar):
  // every .json under a layered include root lands at its path, higher
  // layers win.
  const dataIncludes = {};
  for (const root of [...includeRoots].reverse()) {
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const rel = path.relative(root, path.join(entry.parentPath, entry.name));
      const segments = rel.replace(/\.json$/, '').split(path.sep);
      let node = dataIncludes;
      for (const segment of segments.slice(0, -1)) node = node[segment] = node[segment] || {};
      try {
        node[segments[segments.length - 1]] = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
      } catch { /* malformed data file — leave the slot empty */ }
    }
  }
  site.data = { ...(site.data || {}), _includes: dataIncludes };


  // ---- template-kit on Eleventy's own Liquid instance
  const md = markdownIt({ html: true });
  const collectionsHolder = new Map();

  // site.posts / site.team / site.updates / site.alternatives are Jekyll's
  // site collections, flattened to Jekyll doc shape (post.url, post.date,
  // post.post.title). Real arrays SYNCED when the holder fills — mutated in
  // place, never reassigned: the site object is captured into Eleventy's
  // data cascade at data-init (before collections compute), so replacing the
  // array (or lazy getters) after that is invisible to templates.
  const SITE_COLLECTIONS = ['posts', 'team', 'updates', 'alternatives'];
  for (const name of SITE_COLLECTIONS) site[name] = [];
  const holderSet = collectionsHolder.set.bind(collectionsHolder);
  collectionsHolder.set = (name, docs) => {
    if (SITE_COLLECTIONS.includes(name)) {
      site[name].length = 0;
      site[name].push(...docs.map((doc) => ({ url: doc.url, date: doc.date, ...doc.data })));
    }
    return holderSet(name, docs);
  };

  eleventyConfig.amendLibrary('liquid', (engine) => {
    registerLiquid(engine, {
      site,
      getCollection: (name) => collectionsHolder.get(name) || [],
      getCollectionNames: () => [...collectionsHolder.keys()],
      fileExists: (file) => fs.existsSync(path.join(options.consumerDir, file)),
      markdown: (content) => md.render(content),
      icons: {
        fontAwesomeDir: path.join(coreDir, 'icons'),
        flagsDir: path.join(coreDir, 'icons', 'flags'),
        style: 'solid',
      },
      logos: { dir: path.join(coreDir, 'logos') },
    });
  });

  // ---- Layered layouts (zero copying): virtual templates or symlink farm.
  // Layer order: consumer-local _layouts (sweet-saucy ships src/_layouts/
  // recipe.html) → active theme → classy → core (blueprint/root/modules —
  // the theme-agnostic framework layouts live in the core layer).
  // The farm must live OUTSIDE the input dir — inside it, Eleventy processes
  // the symlinked layouts as content templates (and `../`-relative inputs
  // defeat ignore globs).
  const layoutMap = collectLayered([
    path.join(options.consumerDir, '_layouts'),
    ...themeLayers.map((layer) => path.join(layer, '_layouts')),
    path.join(coreDir, '_layouts'),
  ]);
  // Consumer _layouts live INSIDE the input dir — without an ignore, Eleventy
  // would process them as content templates (each writing to /index.html).
  // Eleventy matches ignores against CWD-RELATIVE paths (`../corpus/...` for
  // `../`-relative input dirs — the known farm gotcha), so the glob must be
  // built the same way; the bare `**/` form covers cwd-contained inputs.
  eleventyConfig.ignores.add('**/_layouts/**');
  eleventyConfig.ignores.add(path.join(path.relative(process.cwd(), options.consumerDir), '_layouts', '**'));
  if (layoutMode === 'farm') {
    composeSymlinkFarm(layoutMap, options.farmDir);
    eleventyConfig.setIncludesDirectory(path.relative(options.consumerDir, options.farmDir));
  } else {
    registerVirtualLayouts(eleventyConfig, layoutMap);
  }

  // ---- Legacy bracket-layout hack → alias table. Layout values are resolved
  // BEFORE preprocessors run (Template #getData vs getTemplates), so this
  // cannot be a data transform — every layer-resolved layout name gets its
  // legacy spellings aliased (`themes/[ site.theme.id ]/frontend/pages/X`,
  // plus hardcoded `themes/<id>/X`). Migrated content uses the plain names;
  // the migration codemod (B4) rewrites the legacy idioms away permanently.
  const themeIds = fs.readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const rel of layoutMap.keys()) {
    const plain = rel.replace(/\.[a-z]+$/, '');
    const spellings = [
      `themes/[ site.theme.id ]/${plain}`,
      `themes/[site.theme.id]/${plain}`,
      ...themeIds.map((id) => `themes/${id}/${plain}`),
    ];
    for (const from of spellings) eleventyConfig.addLayoutAlias(from, rel);
  }

  // ---- Frontmatter Liquid + collection tagging
  const frontmatter = createFrontmatterResolver({ site });
  eleventyConfig.addPreprocessor('omega-frontmatter', 'md,html,liquid', (data) => {
    const inputPath = data.page.inputPath;
    if (inputPath.includes('/_posts/')) data.tags = ['posts'];
    else if (inputPath.includes('/_alternatives/')) data.tags = ['alternatives'];
    else if (inputPath.includes('/_team/')) data.tags = ['team'];
    else if (inputPath.includes('/_updates/')) data.tags = ['updates'];

    frontmatter.resolveData(data);
  });

  // ---- Jekyll conventions + page.resolved equivalent
  eleventyConfig.addGlobalData('eleventyComputed', {
    permalink: (data) => {
      const inputPath = data.page.inputPath;
      // Collection URLs mirror UJM's Jekyll defaults (permalink: "/<coll>/
      // :title", with Eleventy's fileSlug stripping the dated-filename part) —
      // but an EXPLICIT permalink in the doc's frontmatter wins, like Jekyll.
      // '' counts as absent: Eleventy's computed dependency pass probes with
      // an empty-string proxy, and that probe value persists into the data.
      if (data.permalink === undefined || data.permalink === '') {
        if (inputPath.includes('/_posts/')) return `/blog/${data.page.fileSlug}/`;
        if (inputPath.includes('/_alternatives/')) return `/alternatives/${data.page.fileSlug}/`;
        if (inputPath.includes('/_team/')) return `/team/${data.page.fileSlug}/`;
        if (inputPath.includes('/_updates/')) return `/updates/${data.page.fileSlug}/`;
      }
      // Jekyll pretty URLs: `/about` means `/about/index.html`
      if (typeof data.permalink === 'string' && !path.extname(data.permalink) && !data.permalink.endsWith('/')) {
        return `${data.permalink}/`;
      }
      return data.permalink;
    },
    // Jekyll paginator compat: layouts iterate `paginator.posts` with Jekyll
    // post shapes (post.url, post.post.title), so items are flattened
    // ({ url, date, ...data }) — references, not copies.
    paginator: (data) => {
      const p = data.pagination;
      if (!p || !p.items) return undefined;
      const totalPages = (p.pages || []).length;
      return {
        posts: p.items.map((item) => ({ url: item.url, date: item.date, ...item.data })),
        page: p.pageNumber + 1,
        per_page: p.items.length,
        total_pages: totalPages,
        previous_page: p.pageNumber > 0 ? p.pageNumber : null,
        previous_page_path: (p.href && p.href.previous) || null,
        next_page: p.pageNumber + 2 <= totalPages ? p.pageNumber + 2 : null,
        next_page_path: (p.href && p.href.next) || null,
      };
    },
    // Per-page asset lookups against the content-hash manifest: `<key>` for
    // flat entries (js/pages/pricing.js), `<key>/index` for per-page dirs
    // (js/pages/pricing/index.js). `asset_path` frontmatter overrides the
    // URL-derived key (blueprint/blog/post sets asset_path: blog/post).
    pageAssets: (data) => {
      const manifest = data.assetManifest || {};
      const trimmed = (data.page.url || '/').replace(/^\/|\/$/g, '');
      const base = data.asset_path || (trimmed === '' ? 'index' : trimmed);
      const pick = (map) => (map && (map[base] ?? map[`${base}/index`])) || null;
      return {
        js: pick(manifest.js && manifest.js.pages),
        css: pick(manifest.css && manifest.css.pages),
        themeCss: pick(manifest.css && manifest.css.themePages),
      };
    },
    resolved: (data) => {
      // inject-properties.rb parity: resolved = site config ← layout chain ←
      // page data. The cascade already merged layouts under page frontmatter;
      // the site seed adds the site-level sections (brand, theme, analytics,
      // web_manager…) every core include reads via resolved.*.
      const out = {};
      for (const key of Object.keys(site)) {
        if (!RESOLVED_SITE_EXCLUDE.has(key)) out[key] = site[key];
      }
      for (const key of Object.keys(data)) {
        if (!RESOLVED_OMIT.has(key)) out[key] = deepMerge(out[key], data[key]);
      }

      // Layout-frontmatter Liquid: the preprocessor only sees PAGE frontmatter,
      // so cascade data contributed by layouts (real classy contact carries
      // `{{ site.brand.name }}`, real sweet-saucy recipe carries
      // `{{ page.recipe.title }}` in meta values) still holds raw refs here.
      // `resolved` is in context too — layout defaults template on the merged
      // data (classy alternative: tagline "The #1 {{ resolved.alternative.
      // competitor.name }} alternative"); `page.resolved` covers the legacy
      // spelling in not-yet-migrated consumer frontmatter.
      // Copy-on-write: shared cascade sub-objects are never mutated, and
      // pages with no remaining refs return `out` untouched.
      return frontmatter.renderData(out, {
        resolved: out,
        page: { ...out, resolved: out, url: data.page.url, slug: data.page.fileSlug, fileSlug: data.page.fileSlug },
      });
    },
  });

  // ---- Collections: posts, alternatives, team, blog taxonomy
  registerCollections(eleventyConfig, collectionsHolder);

  // ---- Default pages: virtual templates unless the consumer owns the URL
  const consumerUrls = scanConsumerPermalinks(options.consumerDir);
  const defaultPages = collectLayered([path.join(defaultsDir, 'pages')]);
  const suppressed = [];
  for (const [rel, abs] of defaultPages) {
    const raw = fs.readFileSync(abs, 'utf8');
    const url = permalinkOf(raw);
    if (url && consumerUrls.has(url)) {
      suppressed.push(url);
      continue;
    }
    eleventyConfig.addTemplate(`omega-defaults/${rel}`, raw);
  }

  // ---- Globals. site.uj carries UJM-runtime site values the core includes
  // read (cache_breaker in the @omega.js/client Configuration, date.year in the
  // copyright meta, placeholder.src in lazy-loaded imgs).
  site.uj = {
    cache_breaker: 0,
    date: { year: new Date().getFullYear() },
    placeholder: { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' },
    ...(site.uj || {}),
  };
  eleventyConfig.addGlobalData('site', site);
  eleventyConfig.addGlobalData('jekyll', { environment: options.environment || 'development' });
  eleventyConfig.addGlobalData('assetManifest', options.assetManifest || { js: { pages: {} }, css: { pages: {}, themePages: {} } });

  return { site, layers, layoutMap, frontmatter, suppressed, collectionsHolder };
}

module.exports = { configureOmega };
