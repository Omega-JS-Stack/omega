/**
 * The Eleventy engine core of @omega.js/web: layered themes (virtual templates
 * / symlink farm), template-kit registration on Eleventy's own LiquidJS
 * instance, frontmatter Liquid rendering, the `resolved` data alias
 * (page.resolved equivalent — native data cascade), Jekyll conventions (dated
 * post filenames, permalink normalization), blog collections + taxonomy, and
 * default pages as virtual templates suppressed by same-URL consumer files.
 * Promoted from the winning bake-off spike (_attic/spikes/bakeoff-shared/DECISION.md).
 */
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');
const yaml = require('js-yaml');
const markdownIt = require('markdown-it');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { CACHE_TIMESTAMP } = require('@omega.js/template-kit/filters');
const { toSiteGlobal } = require('@omega.js/config/site-global');
const { resolveWinbackOffer } = require('@omega.js/config/winback');
const Logger = require('@omega.js/devkit/logger');
const reads = require('@omega.js/devkit/reads');
const { createFrontmatterResolver } = require('./frontmatter-liquid.js');
const { collectLayered, resolveThemeLayers } = require('./layers.js');
const { applyMarkdownImages } = require('./markdown-images.js');
const { permalinkOf } = require('./consumer-scan.js');
const { createDecisions } = require('./decisions.js');
const { registerVirtualLayouts, composeSymlinkFarm } = require('./layouts.js');
const { registerSectionTags, buildSectionLibrary } = require('./sections.js');
const { registerCollections, BUILT_IN_COLLECTIONS } = require('./collections.js');
const { applyCollectionLimits } = require('./limit-collections.js');
const { readCollections, collectionPages, applyDocumentData } = require('./dynamic-pages.js');
const { resolvePageAsset } = require('./assets.js');
const { SAMPLE_SETS, resolveAnchor, generateSampleSet } = require('./sample-content.js');
const { composePricing } = require('./pricing.js');
const { composeBrandTokens } = require('./brand-tokens.js');
const { resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');
const { ogLocale } = require('@omega.js/devkit/translate');
const { PATHS } = require('./paths.js');

const logger = new Logger('engine');

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
// `collections` is excluded on the same grounds it was in the legacy engine,
// for its CURRENT meaning (#207): it is the config-carried collections
// declaration the engine reads to generate pages — machinery, not page data,
// so nothing should be reading the raw map off `resolved`.
const RESOLVED_SITE_EXCLUDE = new Set(['data', 'omega', 'time', 'posts', 'team', 'updates', 'alternatives', 'collections']);

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
// `theme` (shell chrome config, e.g. main class), `schema` (JSON-LD SEO) and
// `client` (the @omega.js/client settings blob — auth policy, cookie consent,
// chatsy…) are page PRESENTATION/machinery config, not band content — legal.
// `redirect` (the modules/utilities/redirect layout's target — docs/web/index.md)
// and `prerender_icons` (core/body.html's icon prerender list) are layout
// MACHINERY a page configures the same way: shipped contracts that worked only
// from defaults/ and _layouts/ until #247 — a consumer page lost them silently.
const PAGE_FRONTMATTER_ALLOW = new Set([
  'meta', 'schema', 'theme', 'client', 'append', 'sitemap', 'redirect', 'prerender_icons', 'templateEngineOverride', 'eleventyExcludeFromCollections',
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
  // The capture scope (#200): every config-time read below goes through
  // @omega.js/devkit/reads, and each one records the dir it touched. `omega dev` arms a
  // handler before this runs and registers the recorded union as its
  // config-reset watch targets when the scope closes on the way out — so a
  // capture added here can never drift out of the watch set. Other callers
  // (`omega build`, tests) open a scope nobody consumes: recording is cheap.
  reads.openScope({ consumerDir: options.consumerDir });
  try {
    return buildConfig(eleventyConfig, options);
  } finally {
    // Config-time reading is over: hand the recorded union to whoever armed a
    // handler (the dev loop's watch registration — src/commands/dev.js). In a
    // FINALLY because a config build that throws (a bad section.json5, a
    // broken omega.json5) must still register what it read: those very dirs
    // are where the fix lands, and an unregistered union means the fix needs a
    // restart to be seen.
    reads.closeScope();
  }
}

/**
 * The config build itself — everything between opening and closing the capture
 * scope (configureOmega above owns that lifecycle).
 * @param {object} eleventyConfig
 * @param {object} options - configureOmega's options
 * @returns {object} internals exposed for tests ({ site, layers, frontmatter })
 */
function buildConfig(eleventyConfig, options) {
  const themesDir = options.themesDir || PATHS.themes;
  const coreDir = options.coreDir || PATHS.core;
  const defaultsDir = options.defaultsDir || PATHS.defaults;
  // The packaged defaults tree is a config-time input WHOLE (#136): default
  // pages, the showcase and the sample corpora are all read out of it below,
  // and probing the root records the tree as ONE dependency — nothing under it
  // rides the incremental path, so a defaults reader added later is watched
  // whether or not it reads through a dir this build touched.
  reads.dirExists(defaultsDir);
  const site = toSiteGlobal(options.siteData);
  const activeTheme = options.activeTheme || (site.theme && site.theme.id) || 'classy';
  const layoutMode = options.layoutMode || 'virtual';

  // Reflect the active theme into the site global templates render against
  site.theme = { ...(site.theme || {}), id: activeTheme };

  // ---- The brand's own collections (#207): validated HERE, before anything
  // reads them, so a bad entry fails the config build instead of quietly
  // generating nothing. Built-ins plus these are the whole collection roster —
  // directory tagging, permalinks, dev sampling and the generated pages below
  // all read this one list.
  const dynamicCollections = readCollections(site.collections);
  const allCollections = [...BUILT_IN_COLLECTIONS, ...dynamicCollections];

  // ---- Runtime composition: omega.json5 keeps ONE home per shared section
  // (cloud, payment at the top level); the chrome + @omega.js/client contract
  // reads them through site.client — the client settings blob (#1: renamed
  // from the legacy `web_manager`; WebManager is not an OMEGA concept). Pricing
  // loops over site.client.payment.products and the Configuration spread feeds
  // the client. Compose here — same bridge pattern as extension's package.js
  // mapping analytics.providers → the client's flat shape.
  site.client = site.client || {};
  if (site.cloud && site.cloud.config) {
    site.client.firebase = site.client.firebase || {};
    site.client.firebase.app = site.client.firebase.app || {};
    site.client.firebase.app.config = site.cloud.config;
  }
  if (site.cloud && site.cloud.messaging && site.cloud.messaging.vapidKey) {
    site.client.firebase = site.client.firebase || {};
    site.client.firebase.messaging = site.client.firebase.messaging || {};
    site.client.firebase.messaging.config = site.client.firebase.messaging.config || {};
    site.client.firebase.messaging.config.vapidKey = site.cloud.messaging.vapidKey;
  }
  // The cancel-flow save offer (#268) is RESOLVED here, not in the browser: the
  // framework default (50% off the next cycle) has ONE home in @omega.js/config,
  // and the backend's apply route resolves the same section through the same
  // function — so the dialog the customer reads and the coupon the processor
  // creates can never name different numbers. The spread leaves site.payment
  // itself alone; templates and the pricing composer read the brand's section.
  if (site.payment) site.client.payment = { ...site.payment, winback: resolveWinbackOffer(site.payment) };

  // Pricing view-model (C2): payment.products is the ONLY plan source — the
  // seed surfaces as resolved.pricing (cascade still lets consumer frontmatter
  // override presentation). Lives OUTSIDE site.client so the client
  // Configuration payload stays the raw catalog. null = honest empty state.
  site.pricing = composePricing(site.payment);

  // Brand accent ramp (C3/D6): brand.color → the --omega-accent-* family,
  // emitted by head.html after the CSS bundles. null (no/invalid color) =
  // the token sheet's neutral placeholder stands.
  site.brandTokens = composeBrandTokens(site.brand?.color);

  // ---- Theme layer chain: active theme → base → core
  // (consumer-local themes/<id> beats the packaged theme — C3 tier 2)
  const themeLayers = resolveThemeLayers({ activeTheme, consumerDir: options.consumerDir, themesDir });
  const layers = [...themeLayers, coreDir];

  // Font preloads: the active theme's normal-weight latin faces are the
  // first-paint fonts — preloading them eliminates the FOUT (system-font
  // flash on a cold cache). First theme layer WITH a fonts/ dir wins — a
  // consumer-local theme that vendors no faces rides the base theme's.
  // Sorted: readdir order is filesystem-dependent and the emitted HTML
  // must be deterministic.
  // EVERY layer is probed, not just up to the winner: the probe is what arms
  // the dev watch (#200), so a fonts dir that appears in any layer mid-session
  // resets the config instead of serving the captured face list.
  const themeFontsDir = themeLayers
    .map((layer) => path.join(layer, 'fonts'))
    .filter((dir) => reads.dirExists(dir))[0];
  site.fontPreloads = themeFontsDir
    ? reads.readdir(themeFontsDir)
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
    .filter((dir) => reads.dirExists(dir));
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
    for (const entry of reads.readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const rel = path.relative(root, path.join(entry.parentPath, entry.name));
      const segments = rel.replace(/\.json$/, '').split(path.sep);
      let node = dataIncludes;
      for (const segment of segments.slice(0, -1)) node = node[segment] = node[segment] || {};
      try {
        // JSON5 — the packaged section files (nav/footer/sidebar) use
        // unquoted keys, comments, and trailing commas
        node[segments[segments.length - 1]] = JSON5.parse(reads.read(path.join(root, rel)));
      } catch { /* malformed data file — leave the slot empty */ }
    }
  }
  site.data = { ...(site.data || {}), _includes: dataIncludes };


  // ---- template-kit on Eleventy's own Liquid instance
  // This instance backs template-kit's `markdown` filter; Eleventy keeps its
  // own for .md templates. BOTH get the optimized image renderer (#193) so a
  // markdown image is the same markup wherever the markdown is rendered.
  const md = markdownIt({ html: true });
  applyMarkdownImages(md);
  eleventyConfig.amendLibrary('md', applyMarkdownImages);
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
      // to the omega_member/omega_post tags); explicit frontmatter id still wins
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
    // theme → base (docs/web/omega-sections-spec.md).
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
  // recipe.html) → active theme → base → core (blueprint/root/modules —
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

  // The template's own SIDECAR data file (`<template>.11tydata.json`), re-read
  // for the same reason (#269): page frontmatter is meta-only, so the sidecar
  // is the page-level lane for a SHELL layout's band data — and Eleventy's
  // cascade CONCATS a sidecar array onto the layout default, so a page could
  // only append to a band, never replace it. `resolved` re-applies the sidecar
  // with OUR deepMerge, the arrays-replace rule every other override lane
  // obeys; object/string keys land exactly where the cascade already put them.
  // JSON is the sidecar form Eleventy reads without a data-extension of ours
  // (a module sidecar keeps pure cascade behavior), and a missing file — the
  // common case — degrades the same way any read/parse failure does.
  const pageSidecarData = new Map();
  const sidecarPath = (inputPath) => {
    const file = path.resolve(inputPath);
    return path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.11tydata.json`);
  };
  const readSidecarData = (inputPath) => {
    if (pageSidecarData.has(inputPath)) return pageSidecarData.get(inputPath);
    let sidecar = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(sidecarPath(inputPath), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        sidecar = {};
        for (const key of Object.keys(parsed)) {
          if (!RESOLVED_OMIT.has(key)) sidecar[key] = parsed[key];
        }
      }
    } catch { /* no sidecar, or malformed JSON — cascade behavior stands */ }
    pageSidecarData.set(inputPath, sidecar);
    return sidecar;
  };
  eleventyConfig.addPreprocessor('omega-frontmatter', 'md,html,liquid', (data) => {
    const inputPath = data.page.inputPath;
    // Directory → collection tag, the Jekyll convention: a document under
    // `_<collection>/` belongs to that collection, the brand's own included.
    const collection = allCollections.find((entry) => inputPath.includes(`/${entry.dir}/`));
    if (collection) data.tags = [collection.name];

    // A BRAND collection's documents (#317): the built-ins ship their own
    // blueprint layouts and meta, a declared collection's documents get theirs
    // here — the collection block their layout renders from, and per-document
    // meta. A document that falls back to the site's title and description is
    // the indexable duplication #312 fixed one layer up.
    if (collection && dynamicCollections.includes(collection)) {
      applyDocumentData(collection, data, site.brand && site.brand.name);
    }

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
        logger.warn(
          `${inputPath}: ignoring frontmatter content keys (${contentKeys.join(', ')}) — `
          + `consumer page frontmatter is meta-only (layout, permalink, meta, schema, theme, client, sitemap, append); `
          + `content lives in {% section %} calls in the page body (docs/web/sections.md).`,
        );
      }
    }

    frontmatter.resolveData(data);
  });

  // The meta-file lane's reader (#141): a page's cascade data may still hold
  // RAW Liquid contributed by a LAYOUT (blueprint/updates/update sets
  // `meta.title: "Version {{ page.update.version }} - {{ site.brand.name }}"`)
  // — per-page refs defer at frontmatter time and render in that page's own
  // `resolved` computed. sitemap.xml/pages.json/llms.txt read OTHER pages'
  // data, so they read it through this filter: the value renders against THAT
  // item's scope, exactly as the page's own head rendered it. Reading
  // `item.data.resolved` directly would work too but change the fallbacks —
  // resolved seeds the site sections, so every entry without its own title
  // would inherit the SITE's meta.title instead of the template's default.
  const dataAt = (data, dottedPath) => String(dottedPath).split('.')
    .reduce((node, key) => (node == null ? node : node[key]), data);
  eleventyConfig.addFilter('omega_rendered', (item, dottedPath) => {
    const value = dataAt(item && item.data, dottedPath);
    if (typeof value !== 'string' || !(value.includes('{{') || value.includes('{%'))) return value;
    const resolved = item.data.resolved;
    if (!resolved) return value; // no computed data (never in a real build) — raw beats crashing
    return frontmatter.render(value, {
      resolved,
      page: { ...resolved, resolved, url: item.url, slug: item.data.page.fileSlug, fileSlug: item.data.page.fileSlug },
    });
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
    permalink: (data) => jekyllPermalink(data, allCollections),
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
      // client…) every core include reads via resolved.*.
      const out = {};
      for (const key of Object.keys(site)) {
        if (!RESOLVED_SITE_EXCLUDE.has(key)) out[key] = site[key];
      }
      for (const key of Object.keys(data)) {
        if (!RESOLVED_OMIT.has(key)) out[key] = deepMerge(out[key], data[key]);
      }

      // Parity repair — sidecar lane (#269): the page's own data file is the
      // sanctioned page-level lane for shell-layout band data, so its keys are
      // re-applied here with the arrays-replace rule. It sits BELOW the
      // template's own frontmatter, exactly where the cascade puts it.
      const sidecar = readSidecarData(data.page.inputPath);
      if (sidecar) {
        for (const key of Object.keys(sidecar)) {
          out[key] = deepMerge(out[key], sidecar[key]);
        }
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
      // so cascade data contributed by layouts (the real base contact layout
      // carries `{{ site.brand.name }}`, real sweet-saucy recipe carries
      // `{{ page.recipe.title }}` in meta values) still holds raw refs here.
      // `resolved` is in context too — layout defaults template on the merged
      // data (base alternative: tagline "The #1 {{ resolved.alternative.
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

  // ---- Collections: posts, alternatives, team, blog taxonomy, and the
  // brand's own collections plus their taxonomies (#207)
  registerCollections(eleventyConfig, collectionsHolder, dynamicCollections);

  // ---- Dev-mode collection limiting (#190): a brand with thousands of posts
  // samples them locally so the dev build stays fast — the sampled-out
  // documents never enter the build at all. The config is validated in EVERY
  // environment (a typo must fail `omega build` too), but only a development
  // build samples: a shipped site is always the whole site.
  applyCollectionLimits(eleventyConfig, {
    consumerDir: options.consumerDir,
    limits: site.dev && site.dev.limitCollections,
    collections: dynamicCollections,
    environment: options.environment,
  });

  // ---- The live decisions (#200 Lane B): which URLs the consumer's own pages
  // claim, and which collections the brand has real content in. Both are
  // CONTENT facts, so both are rescan captures — a config-time value would
  // only refresh through a config reset, and a config reset on every page edit
  // is exactly what the incremental contract forbids. Everything below asks
  // this object at render time.
  const decisions = createDecisions({
    consumerDir: options.consumerDir,
    collectionDirs: SAMPLE_SETS.map((set) => set.collectionDir),
    environment: options.environment,
  });
  // Re-scan before every REBUILD, so a render can never read a decision older
  // than its own build — whichever watcher saw the file event first. The dev
  // loop's rescan watcher is the prompt lane (it updates and reports the
  // moment a file lands, before any rebuild finishes); this is the ordering
  // guarantee. A production build has exactly one build and one scan.
  if (options.environment !== 'production') {
    eleventyConfig.on('eleventy.before', () => decisions.refresh());
  }

  // ---- Default pages: virtual templates the consumer can take over by
  // claiming the same permalink. The showcase (development only) rides the
  // same lane: auto-generated pages over the resolved library — /test/sections
  // + one page per entry (spec §9). Production builds omit the showcase
  // entirely: a page rendering EVERY section would keep every section's CSS
  // alive through the PurgeCSS content scan and quietly defeat §7
  // self-trimming.
  const frameworkPages = [
    ...[...collectLayered([path.join(defaultsDir, 'pages')])]
      .map(([rel, abs]) => ({ virtual: `omega-defaults/${rel}`, label: `defaults/pages/${rel}`, abs })),
    ...(options.environment === 'production' ? [] : [...collectLayered([path.join(defaultsDir, 'showcase')])]
      .map(([rel, abs]) => ({ virtual: `omega-defaults/showcase/${rel}`, label: `defaults/showcase/${rel}`, abs }))),
  ].map((page) => {
    const raw = reads.read(page.abs);
    return { ...page, raw, url: permalinkOf(raw) };
  });

  for (const page of frameworkPages) {
    // Registered UNCONDITIONALLY, gated at render time: suppression is a live
    // answer now, and a template skipped at config time could only come back
    // through a config reset.
    eleventyConfig.addTemplate(page.virtual, page.raw, renderGate(() => !decisions.suppresses(page.url), allCollections));
  }

  // ---- Dynamic pages (#207): the listing and category pages of every
  // collection the brand declared, generated as virtual templates on the SAME
  // lane as the default pages above. Their permalink is only known per RENDER
  // (the listing's page number, the category's slug), so the gate asks the
  // live decisions about that page's own URL — a consumer page at any one of
  // them takes just that URL over.
  const dynamicPages = dynamicCollections.flatMap(collectionPages);
  for (const page of dynamicPages) {
    eleventyConfig.addTemplate(page.virtual, page.raw, {
      eleventyComputed: {
        permalink: (data) => {
          const url = page.urlOf(data);
          return url && !decisions.suppresses(url) ? `${url}.html` : false;
        },
      },
    });
  }

  // The collision picture: the default pages plus every generated page whose
  // URL is a config-time fact (a listing's own page 1). A category page's URL
  // is a CONTENT fact — it exists because a document names that term — so it
  // can only be answered by the render-time gate above.
  decisions.framework([...frameworkPages, ...dynamicPages].filter((page) => page.url));

  // ---- Sample content (development only): a content-less brand still gets
  // living pages locally. Injected as virtual templates under the matching
  // collection segment so they ride the exact same lane as real content
  // (tags, permalinks, taxonomy). Dates ROLL — the corpus rhythm re-anchors
  // to the build day (or the OMEGA_SAMPLE_ANCHOR / sampleAnchor pin), spec
  // §8. The FIRST consumer file in a collection — or a production build —
  // removes that collection's samples entirely, and in dev that happens on the
  // very next render: the gate is the live own-content answer.
  if (options.environment !== 'production') {
    const sampleAnchorMs = resolveAnchor(options.sampleAnchor);
    for (const set of SAMPLE_SETS) {
      for (const { name, content } of generateSampleSet(defaultsDir, set, sampleAnchorMs)) {
        eleventyConfig.addTemplate(
          `omega-defaults/${set.collectionDir}/${name}`,
          content,
          renderGate(() => !decisions.hasOwn(set.collectionDir), allCollections),
        );
      }
    }
  }

  // ---- Globals. site.omega carries UJM-runtime site values the core includes
  // read (cache_breaker in the @omega.js/client Configuration, date.year in
  // the copyright meta, date.iso as the sitemap/feed build stamp — legacy
  // site.time, placeholder.src in lazy-loaded imgs).
  site.omega = {
    // The build stamp the runtime lazy-loader appends (cb=) — same value as
    // omega_cachebreak and the omega-cachebreak-img transform. Was 0 (inert)
    // until the central cache-breaker landed.
    cache_breaker: CACHE_TIMESTAMP,
    date: { year: new Date().getFullYear(), iso: new Date().toISOString() },
    placeholder: { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' },
    ...(site.omega || {}),
  };
  // site.characters: the literal-character set templates interpolate rather
  // than type — head.html's copyright meta reads characters.copyright, and
  // with nothing defining the set every page fleet-wide shipped a leading
  // blank. The legacy _config_default.yml set carried over verbatim (#286);
  // a brand key wins, like site.omega's.
  site.characters = {
    asterisk: '*',
    'brace-left': '{',
    'brace-right': '}',
    'brace-both': '{}',
    'bracket-left': '[',
    'bracket-right': ']',
    'bracket-both': '[]',
    copyright: '©',
    underscore: '_',
    ...(site.characters || {}),
  };
  eleventyConfig.addGlobalData('site', site);
  // og:locale wants Open Graph's language_TERRITORY form (en → en_US), and the
  // code → locale map is the devkit language SSOT — the head include cannot
  // derive it in Liquid, so it arrives as a computed global.
  eleventyConfig.addGlobalData('ogLocale', ogLocale(site.translation?.default || 'en'));
  // `dev` rides the jekyll global into the Configuration chrome (N7): `omega
  // dev` passes { ports } with the resolved map; production builds pass
  // nothing → null, and @omega.js/client falls back to the classic ports.
  //
  // A FUNCTION `dev` is a LIVE map, re-read on every render — the sibling
  // backend's ports file is pid-stamped and deleted on shutdown, so the map a
  // boot-time read produced is wrong the moment the emulator boots late or
  // restarts on bumped numbers, and the browser has no other channel
  // ([#300](https://github.com/Omega-JS-Stack/omega/issues/300)). Global data
  // registered as a function is evaluated per build, so every re-render bakes
  // what is running RIGHT NOW.
  eleventyConfig.addGlobalData('jekyll', () => ({
    environment: options.environment || 'development',
    dev: (typeof options.dev === 'function' ? options.dev() : options.dev) || null,
  }));
  eleventyConfig.addGlobalData('assetManifest', options.assetManifest || { js: { pages: {} }, css: { pages: {}, themePages: {} } });

  // ---- Image cache-breaker (dev AND prod): every local <img>/<source> URL
  // in a .html output carries ?cb=<build stamp> so image edits show up on
  // rebuilds. Registered before the minifier (transforms run in order) and
  // shares the omega_cachebreak filter's stamp — one value per build process.
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

  return { site, layers, layoutMap, frontmatter, suppressed: decisions.suppressedUrls(), decisions, collectionsHolder };
}

/**
 * The permalink every template computes — the ONE Jekyll-convention rule, so a
 * gated virtual template (renderGate below) resolves its URL exactly like an
 * ungated one.
 * @param {object} data - the template's data cascade
 * @param {object[]} collections - the declared collections (#207): `{ dir: '_<name>', base }` — a document under `dir` publishes at `<base>/<slug>`
 * @returns {string|object|undefined} the permalink Eleventy writes to
 */
function jekyllPermalink(data, collections) {
  const inputPath = data.page.inputPath;
  let permalink = data.permalink;
  // Collection URLs mirror UJM's Jekyll defaults (permalink: "/<coll>/
  // :title", with Eleventy's fileSlug stripping the dated-filename part) —
  // but an EXPLICIT permalink in the doc's frontmatter wins, like Jekyll.
  // '' counts as absent: Eleventy's computed dependency pass probes with
  // an empty-string proxy, and that probe value persists into the data.
  if (permalink === undefined || permalink === '') {
    const collection = collections.find((entry) => inputPath.includes(`/${entry.dir}/`));
    if (collection) permalink = `${collection.base}/${data.page.fileSlug}`;
  }
  // Jekyll flat URLs (legacy UJM parity): `/about` writes `about.html`,
  // NOT `about/index.html` — site URLs carry no trailing slash. page.url
  // stays extensionless ('/about') via configureOmega's .html-stripping
  // urlTransform, exactly like Jekyll's page.url for extensionless permalinks.
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
}

/**
 * The render-time gate of a virtual template (#200 Lane B). The template is
 * registered unconditionally and decides per BUILD whether it SHIPS:
 * `permalink: false` writes no file and `eleventyExcludeFromCollections` keeps
 * it out of every collection, so nothing downstream can see it. Eleventy
 * computes both per build, so a decision that flips between watch rebuilds
 * lands on the very next render with no config reset.
 *
 * What a shut gate does NOT do is skip the render: Eleventy still renders a
 * `permalink: false` template and throws away the output. The cost is real —
 * a template error inside a suppressed default page is still a fatal build
 * error — and it is the price of the lane: a template skipped at config time
 * could only come back through a config reset.
 *
 * The gate is also invisible to PAGINATED templates: Eleventy reads
 * `eleventyExcludeFromCollections` off the raw frontmatter when it expands
 * pagination, before any computed value exists. Every paginated default
 * therefore spells the key in its own frontmatter (pinned by
 * test/collections-gate.test.js).
 * @param {function} isActive - () => boolean, asked at data time
 * @param {Array<object>} collections - the collection roster jekyllPermalink reads
 * @returns {object} addTemplate data
 */
function renderGate(isActive, collections) {
  return {
    eleventyComputed: {
      // Open gate: the same permalink the global computed would have produced
      // (a per-template `eleventyComputed.permalink` replaces that key).
      permalink: (data) => (isActive() ? jekyllPermalink(data, collections) : false),
      // Open gate: the page's OWN frontmatter answer stands VERBATIM — `true`,
      // the list-of-collections form, or undefined for the pages that never
      // set it. Narrowing it to a boolean here would quietly rewrite a
      // template's own answer into one this gate never asked about.
      eleventyExcludeFromCollections: (data) => (isActive() ? data.eleventyExcludeFromCollections : true),
    },
  };
}

module.exports = { configureOmega };
