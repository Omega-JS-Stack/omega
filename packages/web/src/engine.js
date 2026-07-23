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
const JSON5 = require('json5');
const yaml = require('js-yaml');
const markdownIt = require('markdown-it');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { CACHE_TIMESTAMP } = require('@omega.js/template-kit/filters');
const { toSiteGlobal } = require('@omega.js/config/site-global');
const { createFrontmatterResolver } = require('./frontmatter-liquid.js');
const { collectLayered, resolveThemeLayers } = require('./layers.js');
const { permalinkOf, scanConsumerPermalinks } = require('./consumer-scan.js');
const { registerVirtualLayouts, composeSymlinkFarm } = require('./layouts.js');
const { registerSectionTags, buildSectionLibrary } = require('./sections.js');
const { registerCollections } = require('./collections.js');
const { resolvePageAsset } = require('./assets.js');
const { SAMPLE_SETS, resolveAnchor, generateSampleSet, hasOwnContent } = require('./sample-content.js');
const { composePricing } = require('./pricing.js');
const { composeBrandTokens } = require('./brand-tokens.js');
const { resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');
const { PATHS } = require('./paths.js');

// Data-cascade keys that are engine machinery, not page/layout data — everything
// else IS the resolved page data (the cascade already deep-merged layout
// defaults under page frontmatter, which is exactly what inject-properties.rb
// computed as page.resolved).
const RESOLVED_OMIT = new Set([
  'collections', 'content', 'page', 'eleventy', 'pkg', 'eleventyComputed',
  'resolved', 'permalink', 'layout', 'tags', 'pagination', 'site', 'assetManifest',
  'paginator', 'pageAssets', 'jekyll', 'sectionLibrary',
]);

// Site keys that do NOT seed `resolved` (bulk/runtime values templates read
// via site.* directly — mirrors inject-properties.rb's config exclusions,
// which also dropped `collections`; seeding the site collection arrays
// would make every page's resolved walk all 1,030 post docs).
const RESOLVED_SITE_EXCLUDE = new Set(['data', 'uj', 'time', 'posts', 'team', 'updates', 'alternatives']);

// Consumer PAGE frontmatter is meta-only (Ian's rule, 2026-07-19: content
// lives in {% section %} calls — and nothing may even TRY to consume it from
// frontmatter). Softened same day (Ian: no build-fail): content keys in a
// page's own frontmatter are STRIPPED from the data cascade with a warning
// before resolution — sections/components can never see them, and the build
// proceeds. Plumbing keys (layout, permalink,
// tags, pagination — the RESOLVED_OMIT set) are filtered before this check;
// collections (_posts/_team/…) are content ENTRIES whose frontmatter IS the
// document, and layouts are theme voice that never renders standalone —
// neither passes through the guard.
// `theme` (shell chrome config, e.g. main class) and `schema` (JSON-LD SEO)
// are page PRESENTATION/meta machinery, not band content — legal.
const PAGE_FRONTMATTER_ALLOW = new Set([
  'meta', 'schema', 'theme', 'append', 'sitemap', 'templateEngineOverride', 'eleventyExcludeFromCollections',
]);

// Deep merge shared with the section tag's defaults ← data ← args chain —
// one semantics for both override lanes (see src/merge.js).
const { deepMerge } = require('./merge.js');

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
 * @param {string} [options.sampleAnchor] - YYYY-MM-DD rolling-date anchor for sample content (default: OMEGA_SAMPLE_ANCHOR env, then today)
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
  if (site.cloud && site.cloud.messaging && site.cloud.messaging.vapidKey) {
    site.web_manager.firebase = site.web_manager.firebase || {};
    site.web_manager.firebase.messaging = site.web_manager.firebase.messaging || {};
    site.web_manager.firebase.messaging.config = site.web_manager.firebase.messaging.config || {};
    site.web_manager.firebase.messaging.config.vapidKey = site.cloud.messaging.vapidKey;
  }
  if (site.payment) site.web_manager.payment = site.payment;

  // Pricing view-model (C2): payment.products is the ONLY plan source — the
  // seed surfaces as resolved.pricing (cascade still lets consumer frontmatter
  // override presentation). Lives OUTSIDE web_manager so the client
  // Configuration payload stays the raw catalog. null = honest empty state.
  site.pricing = composePricing(site.payment);

  // Brand accent ramp (C3/D6): brand.color → the --omega-accent-* family,
  // emitted by head.html after the CSS bundles. null (no/invalid color) =
  // the token sheet's neutral placeholder stands.
  site.brandTokens = composeBrandTokens(site.brand?.color);

  // ---- Theme layer chain: active theme → classy base → core
  // (consumer-local themes/<id> beats the packaged theme — C3 tier 2)
  const themeLayers = resolveThemeLayers({ activeTheme, consumerDir: options.consumerDir, themesDir });
  const layers = [...themeLayers, coreDir];

  // Font preloads: the active theme's normal-weight latin faces are the
  // first-paint fonts — preloading them eliminates the FOUT (system-font
  // flash on a cold cache). First theme layer WITH a fonts/ dir wins — a
  // consumer-local theme that vendors no faces rides the base theme's.
  // Sorted: readdir order is filesystem-dependent and the emitted HTML
  // must be deterministic.
  const themeFontsDir = themeLayers
    .map((layer) => path.join(layer, 'fonts'))
    .find((dir) => fs.existsSync(dir));
  site.fontPreloads = themeFontsDir
    ? fs.readdirSync(themeFontsDir)
        .filter((f) => f.endsWith('-normal-latin.woff2'))
        .sort()
        .map((f) => `/assets/fonts/${f}`)
    : [];

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
        // JSON5 — the packaged section files (nav/footer/sidebar) use
        // unquoted keys, comments, and trailing commas
        node[segments[segments.length - 1]] = JSON5.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
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
      // id rides along (Jekyll doc parity — layouts pass member.id/post.id
      // to the uj_member/uj_post tags); explicit frontmatter id still wins
      // via the data spread.
      site[name].push(...docs.map((doc) => ({ id: doc.id, url: doc.url, date: doc.date, ...doc.data })));
    }
    return holderSet(name, docs);
  };

  // Icon roots (C4 cp108/cp111): the curated core set wins, then the
  // brand's own Font Awesome set when one is supplied (Pro npm install or
  // OMEGA_FONTAWESOME_ROOT download dir), with the free npm set (resolved,
  // never vendored) as the always-present floor; the richest metadata
  // resolves legacy aliases (search → magnifying-glass).
  const fa = resolveFontAwesomeRoots();

  // The resolved library with meta — the showcase/docs data source (spec §9).
  // Registered unconditionally (deterministic data model, ~20 json5 reads);
  // only the PAGES consuming it are development-gated below.
  eleventyConfig.addGlobalData('sectionLibrary', buildSectionLibrary({
    baseDirs: [options.consumerDir, ...themeLayers],
    consumerDir: options.consumerDir,
  }));

  eleventyConfig.amendLibrary('liquid', (engine) => {
    // The section/component library tags resolve through the same precedence
    // as every other layer: consumer-local _sections/_components → active
    // theme → classy base (plans/omega-sections-spec.md).
    registerSectionTags(engine, { baseDirs: [options.consumerDir, ...themeLayers] });
    registerLiquid(engine, {
      site,
      getCollection: (name) => collectionsHolder.get(name) || [],
      getCollectionNames: () => [...collectionsHolder.keys()],
      fileExists: (file) => fs.existsSync(path.join(options.consumerDir, file)),
      markdown: (content) => md.render(content),
      icons: {
        fontAwesomeDirs: [
          path.join(coreDir, 'icons'),
          ...fa.svgsDirs,
        ],
        aliasFile: fa.aliasFile,
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
  // Consumer-local section/component folders are template machinery too —
  // without the ignore, Eleventy would emit every section.html as content.
  for (const machineryDir of ['_sections', '_components']) {
    eleventyConfig.ignores.add(`**/${machineryDir}/**`);
    eleventyConfig.ignores.add(path.join(path.relative(process.cwd(), options.consumerDir), machineryDir, '**'));
  }
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
  // Packaged ids + the active id — a consumer-local theme (C3 tier 2) is
  // not under themesDir, but its legacy spellings must alias all the same.
  const themeIds = [...new Set([
    activeTheme,
    ...fs.readdirSync(themesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  ])];
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
  // The template's OWN frontmatter, re-parsed from the source file — no
  // Eleventy hook sees template data apart from the cascade (preprocessors
  // already get the merged tree). Two consumers: the meta-only PAGE guard
  // below, and the collections parity repair in `resolved` — Eleventy's
  // cascade merge breaks the inject-properties.rb contract for content
  // ENTRIES (it CONCATS a doc array onto a layout-default array, and a
  // layout-default object beats a doc scalar), so `resolved` re-applies a
  // doc's own keys with OUR deepMerge. Values are raw (un-liquified) —
  // resolved's renderData pass liquifies them with the same resolver.
  // Virtual templates (blueprints, sample content) have no file to parse
  // and keep pure cascade behavior; ANY read/parse failure degrades the
  // same way.
  const pageOwnData = new Map();
  const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
  const readOwnFrontmatter = (inputPath) => {
    if (pageOwnData.has(inputPath)) return pageOwnData.get(inputPath);
    let own = null;
    try {
      const match = fs.readFileSync(path.resolve(inputPath), 'utf8').match(FRONTMATTER_RE);
      const parsed = match ? yaml.load(match[1]) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        own = {};
        for (const key of Object.keys(parsed)) {
          if (!RESOLVED_OMIT.has(key)) own[key] = parsed[key];
        }
      }
    } catch { /* virtual template or exotic frontmatter — cascade behavior stands */ }
    pageOwnData.set(inputPath, own);
    return own;
  };
  eleventyConfig.addPreprocessor('omega-frontmatter', 'md,html,liquid', (data) => {
    const inputPath = data.page.inputPath;
    if (inputPath.includes('/_posts/')) data.tags = ['posts'];
    else if (inputPath.includes('/_alternatives/')) data.tags = ['alternatives'];
    else if (inputPath.includes('/_team/')) data.tags = ['team'];
    else if (inputPath.includes('/_updates/')) data.tags = ['updates'];

    // The meta-only guard: real files under pages/ may carry ONLY meta keys
    // in frontmatter. readOwnFrontmatter already filters the plumbing set
    // (layout, permalink, tags, pagination…) and returns null for virtual
    // templates (blueprints, showcase) — so anything left outside the allow
    // set is content in frontmatter, a lane that doesn't exist: the keys are
    // deleted from the cascade before resolution (sections/components never
    // see them) and the build warns. The WHOLE key drops for this page — a
    // directory-data value merged under the same key falls back to section
    // defaults too; deleting the frontmatter key (what the warning says)
    // restores it.
    if (/\/pages\//.test(inputPath)) {
      const own = readOwnFrontmatter(inputPath);
      const contentKeys = own ? Object.keys(own).filter((key) => !PAGE_FRONTMATTER_ALLOW.has(key)) : [];
      if (contentKeys.length) {
        for (const key of contentKeys) delete data[key];
        console.warn(
          `[omega] ${inputPath}: ignoring frontmatter content keys (${contentKeys.join(', ')}) — `
          + `consumer page frontmatter is meta-only (layout, permalink, meta, schema, theme, sitemap, append); `
          + `content lives in {% section %} calls in the page body (docs/sections.md).`,
        );
      }
    }

    frontmatter.resolveData(data);
  });

  // A body that composes sections is Liquid-HTML, not prose: rendered
  // section markup must never pass through the markdown transform — blank
  // lines inside emitted HTML blocks become empty <p> elements that land
  // as REAL grid children (the 2026-07-19 live find: both brand homepages'
  // bento/stats scattered by phantom <p>s). `omega customize` obeys the
  // same rule by materializing .html copies; hand-authored .md
  // compositions get it automatically here.
  eleventyConfig.addPreprocessor('omega-composition-liquid', 'md', (data, content) => {
    if (data.templateEngineOverride === undefined && /^\s*{%-?\s*(section|composition)\b/m.test(content)) {
      data.templateEngineOverride = 'liquid';
    }
  });

  // ---- Jekyll conventions + page.resolved equivalent
  eleventyConfig.addGlobalData('eleventyComputed', {
    permalink: (data) => {
      const inputPath = data.page.inputPath;
      let permalink = data.permalink;
      // Collection URLs mirror UJM's Jekyll defaults (permalink: "/<coll>/
      // :title", with Eleventy's fileSlug stripping the dated-filename part) —
      // but an EXPLICIT permalink in the doc's frontmatter wins, like Jekyll.
      // '' counts as absent: Eleventy's computed dependency pass probes with
      // an empty-string proxy, and that probe value persists into the data.
      if (permalink === undefined || permalink === '') {
        if (inputPath.includes('/_posts/')) permalink = `/blog/${data.page.fileSlug}`;
        else if (inputPath.includes('/_alternatives/')) permalink = `/alternatives/${data.page.fileSlug}`;
        else if (inputPath.includes('/_team/')) permalink = `/team/${data.page.fileSlug}`;
        else if (inputPath.includes('/_updates/')) permalink = `/updates/${data.page.fileSlug}`;
      }
      // Jekyll flat URLs (legacy UJM parity): `/about` writes `about.html`,
      // NOT `about/index.html` — site URLs carry no trailing slash. page.url
      // stays extensionless ('/about') via the .html-stripping urlTransform
      // below, exactly like Jekyll's page.url for extensionless permalinks.
      // A whitelist of real output extensions, NOT path.extname — dotted slugs
      // (`/updates/v1.0.0`) must still get their .html. Liquid-carrying
      // permalinks (pagination/taxonomy) can't be shape-tested as raw strings —
      // they spell their full shape explicitly (blog.md ends in `.html`) and
      // pass through untouched.
      const KNOWN_EXT = /\.(html|xml|txt|json|js|css|webmanifest|svg|ics|pdf)$/i;
      if (typeof permalink === 'string' && !/[{}]/.test(permalink)
          && !KNOWN_EXT.test(permalink) && !permalink.endsWith('/')) {
        return `${permalink}.html`;
      }
      return permalink;
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
    // Per-page asset lookups against the content-hash manifest, keyed by URL
    // alone (spec §7 — the asset_path frontmatter override is dead): `<key>`
    // for flat entries (js/pages/pricing.js), `<key>/index` for per-page dirs
    // (js/pages/pricing/index.js), and [name] wildcard segments for generated
    // page families (js/pages/blog/[slug].js serves every /blog/<slug> post).
    pageAssets: (data) => {
      const manifest = data.assetManifest || {};
      const trimmed = (data.page.url || '/').replace(/^\/|\/$/g, '');
      const base = trimmed === '' ? 'index' : trimmed;
      return {
        js: resolvePageAsset(manifest.js && manifest.js.pages, base),
        css: resolvePageAsset(manifest.css && manifest.css.pages, base),
        themeCss: resolvePageAsset(manifest.css && manifest.css.themePages, base),
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

      // Parity repair — collections lane: Eleventy's cascade merge concats
      // arrays and lets a layout-default object beat a doc scalar — re-apply
      // the template's OWN frontmatter (re-parsed from source) with OUR
      // semantics, so a content entry (_posts/_team/_alternatives docs)
      // always wins its own keys outright: arrays REPLACE. Pages are
      // meta-only (guard above stripped content keys from the cascade) — this
      // lane filters to the allow set so nothing stripped re-enters here.
      const own = readOwnFrontmatter(data.page.inputPath);
      if (own) {
        const isPage = /\/pages\//.test(data.page.inputPath);
        for (const key of Object.keys(own)) {
          if (isPage && !PAGE_FRONTMATTER_ALLOW.has(key)) continue;
          out[key] = deepMerge(out[key], own[key]);
        }
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

  // page.url parity with Jekyll (legacy UJM): the flat `about.html` output
  // still reads as '/about' everywhere templates look (canonical, hreflang,
  // data-page-path, nav active-detection, collection doc.url). index.html
  // outputs are collapsed to directory URLs by Eleventy before transforms run.
  eleventyConfig.addUrlTransform(({ url }) => {
    if (typeof url === 'string' && url.endsWith('.html')) {
      return url.slice(0, -'.html'.length);
    }
    return undefined;
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

  // ---- Sample content (development only): a content-less brand still gets
  // living pages locally. Injected as virtual templates under the matching
  // collection segment so they ride the exact same lane as real content
  // (tags, permalinks, taxonomy). Dates ROLL — the corpus rhythm re-anchors
  // to the build day (or the OMEGA_SAMPLE_ANCHOR / sampleAnchor pin), spec
  // §8. The FIRST consumer file in a collection — or a production build —
  // removes that collection's samples entirely.
  if (options.environment !== 'production') {
    const sampleAnchorMs = resolveAnchor(options.sampleAnchor);
    for (const set of SAMPLE_SETS) {
      if (hasOwnContent(options.consumerDir, set.collectionDir)) continue;
      for (const { name, content } of generateSampleSet(defaultsDir, set, sampleAnchorMs)) {
        eleventyConfig.addTemplate(`omega-defaults/${set.collectionDir}/${name}`, content);
      }
    }

    // ---- The section showcase (development only, same gate): auto-generated
    // pages over the resolved library — /test/sections + one page per entry
    // (spec §9). Production builds omit them entirely: a page rendering EVERY
    // section would keep every section's CSS alive through the PurgeCSS
    // content scan and quietly defeat §7 self-trimming.
    for (const [rel, abs] of collectLayered([path.join(defaultsDir, 'showcase')])) {
      const raw = fs.readFileSync(abs, 'utf8');
      const url = permalinkOf(raw);
      if (url && consumerUrls.has(url)) {
        suppressed.push(url);
        continue;
      }
      eleventyConfig.addTemplate(`omega-defaults/showcase/${rel}`, raw);
    }
  }

  // ---- Globals. site.uj carries UJM-runtime site values the core includes
  // read (cache_breaker in the @omega.js/client Configuration, date.year in
  // the copyright meta, date.iso as the sitemap/feed build stamp — legacy
  // site.time, placeholder.src in lazy-loaded imgs).
  site.uj = {
    // The build stamp the runtime lazy-loader appends (cb=) — same value as
    // uj_cachebreak and the omega-cachebreak-img transform. Was 0 (inert)
    // until the central cache-breaker landed.
    cache_breaker: CACHE_TIMESTAMP,
    date: { year: new Date().getFullYear(), iso: new Date().toISOString() },
    placeholder: { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' },
    ...(site.uj || {}),
  };
  eleventyConfig.addGlobalData('site', site);
  // `dev` rides the jekyll global into the Configuration chrome (N7): `omega
  // dev` passes { ports } with the resolved map; production builds pass
  // nothing → null, and @omega.js/client falls back to the classic ports.
  eleventyConfig.addGlobalData('jekyll', {
    environment: options.environment || 'development',
    dev: options.dev || null,
  });
  eleventyConfig.addGlobalData('assetManifest', options.assetManifest || { js: { pages: {} }, css: { pages: {}, themePages: {} } });

  // ---- Image cache-breaker (dev AND prod): every local <img>/<source> URL
  // in a .html output carries ?cb=<build stamp> so image edits show up on
  // rebuilds. Registered before the minifier (transforms run in order) and
  // shares the uj_cachebreak filter's stamp — one value per build process.
  const { cachebreakHtml } = require('./cachebreak-html.js');
  eleventyConfig.addTransform('omega-cachebreak-img', function (content) {
    if (this.page.outputPath && this.page.outputPath.endsWith('.html')) {
      return cachebreakHtml(content, CACHE_TIMESTAMP);
    }
    return content;
  });

  // ---- Production HTML minification (the UJM minifyHtml successor). Only
  // .html outputs — the meta-files (sitemap.xml, feeds, robots.txt, …) ship
  // exactly as their templates render them.
  if (options.environment === 'production') {
    const { minifyHtml } = require('./minify-html.js');
    eleventyConfig.addTransform('omega-minify-html', function (content) {
      if (this.page.outputPath && this.page.outputPath.endsWith('.html')) {
        return minifyHtml(content);
      }
      return content;
    });
  }

  return { site, layers, layoutMap, frontmatter, suppressed, collectionsHolder };
}

module.exports = { configureOmega };
