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
const { slugify } = require('@omega.js/template-kit/jekyll-compat');
const { toSiteGlobal } = require('@omega.js/config/site-global');
const { resolveWinbackOffer } = require('@omega.js/config/winback');
const Logger = require('@omega.js/devkit/logger');
const reads = require('@omega.js/devkit/reads');
const { KEYLESS_STAMP } = require('@omega.js/devkit/license');
const { createFrontmatterResolver } = require('./frontmatter-liquid.js');
const { collectLayered, resolveThemeLayers } = require('./layers.js');
const { applyMarkdownImages } = require('./markdown-images.js');
const { permalinkOf } = require('./consumer-scan.js');
const { createDecisions } = require('./decisions.js');
const { registerVirtualLayouts, composeSymlinkFarm } = require('./layouts.js');
const { registerSectionTags, buildSectionLibrary } = require('./sections.js');
const { watchHeroAnimations, HERO_DIR } = require('./hero-animations.js');
const { registerCollections, BUILT_IN_COLLECTIONS } = require('./collections.js');
const { applyCollectionLimits } = require('./limit-collections.js');
const { readCollections, collectionPages, applyDocumentData } = require('./dynamic-pages.js');
const { readSocials, socialPages } = require('./social-pages.js');
const { readTargetShortlinks, targetShortlinkPages } = require('./target-shortlinks.js');
const { resolvePageAsset } = require('./assets.js');
const { resolvePathPrefix, prefixHtml } = require('./path-prefix.js');
const { SAMPLE_SETS, resolveAnchor, generateSampleSet } = require('./sample-content.js');
const { composePricing } = require('./pricing.js');
const { composeBrandTokens } = require('./brand-tokens.js');
const { resolveFontAwesomeRoots, createIconLoader } = require('@omega.js/devkit/icons');
const { inlineIcons } = require('./inline-icons.js');
const { getEnvironment } = require('./mode-helpers.js');
const { ogLocale } = require('@omega.js/devkit/translate');
const { PATHS } = require('./paths.js');
const {
  CONFIG_SECTIONS, DEAD_SITE_SECTIONS, SITE_FACT_KEYS, RANDOM_ID_ASSIGN_IDIOM,
  templateReads, randomIdReads, assignsRandomId,
} = require('./config-sections.js');

const logger = new Logger('engine');

// Data-cascade keys that are engine machinery, not page/layout data — everything
// else IS the resolved page data (the cascade already deep-merged layout
// defaults under page frontmatter, which is exactly what inject-properties.rb
// computed as page.resolved).
const RESOLVED_OMIT = new Set([
  'collections', 'content', 'page', 'eleventy', 'pkg', 'eleventyComputed',
  'resolved', 'permalink', 'layout', 'tags', 'pagination', 'site', 'assetManifest',
  'paginator', 'pageAssets', 'layoutAssets', 'jekyll', 'sectionLibrary',
]);

// Build-fact keys that do NOT seed `resolved` (bulk/runtime values templates
// read via site.* directly — mirrors inject-properties.rb's config exclusions;
// seeding the site collection arrays would make every page's resolved walk all
// 1,030 post docs). Every SITE COLLECTION joins them per build — the built-ins
// and the brand's own alike (SITE_COLLECTIONS below, #593).
const RESOLVED_SITE_EXCLUDE = new Set(['data', 'omega', 'time']);

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
// `config` is the page's omega.json5 override block (#607) — every config
// section a page restates lives under it, and nothing else may: what is in
// the config file goes under `config:`, what is not may not. Every other key
// here is PAGE machinery, which is why it has no config home: `meta` (the
// head walk, the only meta there is) and `schema` (JSON-LD SEO) are the
// page's own SEO surface, and `redirect` (the modules/utilities/redirect
// layout's target — docs/web/index.md) is layout MACHINERY a page configures
// the same way: shipped contracts that worked only from defaults/ and
// _layouts/ until #247 — a consumer page lost them silently.
// `sitemap` is NOT here: #564 folded `sitemap.include` into `meta.index`, so
// there is no longer a way to be indexable and out of the sitemap.
const PAGE_FRONTMATTER_ALLOW = new Set([
  'config', 'meta',
  'schema', 'redirect', 'templateEngineOverride', 'eleventyExcludeFromCollections',
]);

// Deep merge shared with the section tag's defaults ← data ← args chain —
// one semantics for both override lanes (see src/merge.js).
const { deepMerge } = require('./merge.js');

// Dev surfaces never ship (#554, Ian 2026-08-24): every page the framework
// publishes under /test — the index, the styleguide, the library harnesses,
// the translation page — is a DEVELOPMENT surface, and so is a consumer page
// that claims one of those URLs. A production build emits none of them, the
// same omission the showcase gallery already rides. The boundary is a path
// SEGMENT, not a bare prefix: /testimonials is brand content.
const DEV_ONLY_URL_RE = /^\/test(\/|\.|$)/;

/**
 * The first dead config read in a CONFIG VALUE
 * ([#671](https://github.com/Omega-JS-Stack/omega/issues/671)). The per-template
 * census cannot see this one: `targets.web.tagline: "Agency - {{ site.brand.name }}"`
 * lives in omega.json5, renders through the same Liquid, and has rendered the
 * brand name EMPTY since #611 on every page that falls through to the default.
 * Same census, same section list — the address is a config key path instead of
 * a file and line.
 * @param {*} node - a config value (walked recursively)
 * @param {string[]} [trail] - the key path to this node
 * @returns {{ path: string, read: object }|null}
 */
function deadConfigValueRead(node, trail = []) {
  if (typeof node === 'string') {
    const read = templateReads(node).find((entry) => entry.root === 'site' && DEAD_SITE_SECTIONS.has(entry.key));
    return read ? { path: trail.join('.'), read } : null;
  }
  if (!node || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node)) {
    const found = deadConfigValueRead(value, [...trail, key]);
    if (found) return found;
  }
  return null;
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
 * @param {string} [options.version] - the website target's own package version (site.omega.version → the Configuration block)
 * @param {string} [options.pathPrefix] - the base path the built site is served under (#355) — default the domain root
 * @param {string} [options.sampleAnchor] - YYYY-MM-DD rolling-date anchor for sample content (default: OMEGA_SAMPLE_ANCHOR env, then today)
 * @param {object} [options.license] - the deploy-time license stamp (#320) → site.license (default: the keyless stamp)
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
  // The environment (#717): read ONCE, from the one surface every OMEGA
  // framework answers with. `options.environment` is still the deliberate
  // override the verbs thread (`omega build` → production) — it just arrives
  // through getEnvironment() now instead of being compared as a loose string.
  const environment = getEnvironment.call(options);
  const themesDir = options.themesDir || PATHS.themes;
  const coreDir = options.coreDir || PATHS.core;
  const defaultsDir = options.defaultsDir || PATHS.defaults;
  // The packaged defaults tree is a config-time input WHOLE (#136): default
  // pages, the showcase and the sample corpora are all read out of it below,
  // and probing the root records the tree as ONE dependency — nothing under it
  // rides the incremental path, so a defaults reader added later is watched
  // whether or not it reads through a dir this build touched.
  reads.dirExists(defaultsDir);
  // The two namespaces (#607): `config` is the brand's omega.json5 for this
  // target, which every template reads through `resolved.config.*` (with the
  // page's own `config:` block merged on top); `site` is BUILD FACTS — what
  // the build knows and the config cannot say. The curated targets view is
  // the one thing toSiteGlobal derives that IS a build fact, so it moves
  // across; src/config-sections.js names both sets.
  const config = toSiteGlobal(options.siteData);
  const site = { targets: config.targets };
  delete config.targets;

  // The config-VALUE half of the #611 read guard (#671), before anything reads
  // one: a dead read here is ONE key in omega.json5 and it silently drains the
  // brand name out of every page's <title>. The curated targets view is gone
  // by now — it is a build fact, not a config value.
  const deadValue = deadConfigValueRead(config);
  if (deadValue) {
    throw new Error(
      `[@omega.js/web:engine] config \`${deadValue.path}\` reads \`${deadValue.read.expression}\` — the brand config left `
      + `the \`site\` global, which is BUILD FACTS only (${SITE_FACT_KEYS.join(', ')}, plus the collections `
      + `targets.web.collections declares). Spell it `
      + `\`${deadValue.read.expression.replace(/^site\./, 'resolved.config.')}\` in omega.json5. `
      + 'Run `omega migrate` to rewrite it (docs/web/index.md).',
    );
  }

  const activeTheme = options.activeTheme || (config.theme && config.theme.id) || 'classy';
  const layoutMode = options.layoutMode || 'virtual';

  // Reflect the active theme into the config templates render against
  config.theme = { ...(config.theme || {}), id: activeTheme };

  // ---- The brand's own collections (#207): validated HERE, before anything
  // reads them, so a bad entry fails the config build instead of quietly
  // generating nothing. Built-ins plus these are the whole collection roster —
  // directory tagging, permalinks, dev sampling and the generated pages below
  // all read this one list.
  const dynamicCollections = readCollections(config.collections);
  const allCollections = [...BUILT_IN_COLLECTIONS, ...dynamicCollections];

  // ---- Runtime composition: omega.json5 keeps ONE home per shared section
  // (cloud, payment at the top level); the chrome + @omega.js/client contract
  // reads them through resolved.config.client — the client settings blob (#1:
  // renamed from the legacy `web_manager`; WebManager is not an OMEGA concept).
  // Pricing loops over config.client.payment.products and the Configuration
  // spread feeds the client. Compose here — same bridge pattern as extension's
  // package.js mapping analytics.providers → the client's flat shape.
  config.client = config.client || {};
  if (config.cloud && config.cloud.config) {
    config.client.firebase = config.client.firebase || {};
    config.client.firebase.app = config.client.firebase.app || {};
    config.client.firebase.app.config = config.cloud.config;
  }
  if (config.cloud && config.cloud.messaging && config.cloud.messaging.vapidKey) {
    config.client.firebase = config.client.firebase || {};
    config.client.firebase.messaging = config.client.firebase.messaging || {};
    config.client.firebase.messaging.config = config.client.firebase.messaging.config || {};
    config.client.firebase.messaging.config.vapidKey = config.cloud.messaging.vapidKey;
  }
  // The cancel-flow save offer (#268) is RESOLVED here, not in the browser: the
  // framework default (50% off the next cycle) has ONE home in @omega.js/config,
  // and the backend's apply route resolves the same section through the same
  // function — so the dialog the customer reads and the coupon the provider
  // creates can never name different numbers. The spread leaves config.payment
  // itself alone; templates and the pricing composer read the brand's section.
  if (config.payment) config.client.payment = { ...config.payment, winback: resolveWinbackOffer(config.payment) };

  // The FEATURES CATALOG rides the same bridge (#647): the account page's usage
  // bars and plan bullets read names, icons and definitions from it, and a
  // feature is DEFINED in exactly one place for the server and the browser both.
  if (config.features) config.client.features = config.features;

  // Pricing view-model (C2): payment.products is the ONLY plan source — the
  // seed surfaces as resolved.pricing (cascade still lets consumer frontmatter
  // override presentation). A composed VIEW of the config, not config itself,
  // so it rides the build-fact global. null = honest empty state.
  site.pricing = composePricing(config.payment, config.features);

  // Brand accent ramp (C3/D6): brand.color → the --omega-accent-* family,
  // emitted by head.html after the CSS bundles. null (no/invalid color) =
  // the token sheet's neutral placeholder stands.
  site.brandTokens = composeBrandTokens(config.brand?.color);

  // The license verdict ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)):
  // a BUILD fact — the production build's one deploy-time check, whose
  // `attribution` decides the footer's "Powered by omegajs.dev" block. Nothing
  // handed in (dev, a test, any lane that runs no check) is the keyless stamp,
  // which is the state every build ships in today.
  site.license = options.license || KEYLESS_STAMP;

  // ---- Theme layer chain: active theme → base → core
  // (consumer-local themes/<id> beats the packaged theme — C3 tier 2)
  const themeLayers = resolveThemeLayers({ activeTheme, consumerDir: options.consumerDir, themesDir });
  const layers = [...themeLayers, coreDir];

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
  site.data = { ...(config.data || {}), _includes: dataIncludes };


  // ---- template-kit on Eleventy's own Liquid instance
  // This instance backs template-kit's `markdown` filter; Eleventy keeps its
  // own for .md templates. BOTH get the optimized image renderer (#193) so a
  // markdown image is the same markup wherever the markdown is rendered, and
  // BOTH run the typographer (#547): Kramdown smartened quotes, apostrophes,
  // dashes and ellipses at build time, so a brand converted off Jekyll drifts
  // into straight punctuation on its very next build without it (HARD RULE 5 —
  // preserve semantics). A hard default, no consumer knob.
  const md = markdownIt({ html: true, typographer: true });
  applyMarkdownImages(md);
  eleventyConfig.amendLibrary('md', (mdLib) => {
    mdLib.set({ typographer: true });
    applyMarkdownImages(mdLib);
  });
  const collectionsHolder = new Map();

  // site.posts / site.team / site.updates / site.alternatives are Jekyll's
  // site collections, flattened to Jekyll doc shape (post.url, post.date,
  // post.post.title). Real arrays SYNCED when the holder fills — mutated in
  // place, never reassigned: the site object is captured into Eleventy's
  // data cascade at data-init (before collections compute), so replacing the
  // array (or lazy getters) after that is invisible to templates.
  //
  // A BRAND's own collection (#207) publishes the same way (#593): a UJM
  // consumer's `{% for product in site.products %}` is how a declared
  // collection is read, and reaching templates only as `collections.products`
  // (frontmatter under `.data`) rendered that loop empty on a green build —
  // no warning, no output (HARD RULE 5, preserve semantics).
  const SITE_COLLECTIONS = allCollections.map((collection) => collection.name);
  for (const name of SITE_COLLECTIONS) site[name] = [];
  // A collection array is a build fact templates read off `site` directly,
  // never a `resolved` key — the brand's own on exactly the built-ins' terms.
  const resolvedSiteExclude = new Set([...RESOLVED_SITE_EXCLUDE, ...SITE_COLLECTIONS]);
  const holderSet = collectionsHolder.set.bind(collectionsHolder);
  collectionsHolder.set = (name, docs) => {
    if (SITE_COLLECTIONS.includes(name)) {
      site[name].length = 0;
      // ONE flattener for both lanes (#711): `jekyllDoc` gives a site doc the
      // same lazy `content` the paginator's docs carry, so a layout reading
      // `post.content` off site.posts counts the post's real body instead of
      // an empty string (the newsflash homepage printed "1 min read" for every
      // cover story and tile). id rides along inside it (Jekyll doc parity —
      // layouts pass member.id/post.id to the omega_member/omega_post tags).
      site[name].push(...docs.map((doc) => jekyllDoc(doc)));
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

  // The hero animation folders (#441): probed through the captured-read helper
  // so a `_hero/` dir appearing mid-session resets the config, exactly like the
  // section walk's own probes. The tag registered below reads them at render
  // time, which is why the probe has to be its own line here.
  watchHeroAnimations([options.consumerDir, ...themeLayers]);

  eleventyConfig.amendLibrary('liquid', (engine) => {
    // The section/component library tags resolve through the same precedence
    // as every other layer: consumer-local _sections/_components → active
    // theme → base (docs/web/omega-sections-spec.md).
    // …and with them `{% hero_animation %}` (#441): the hero's custom demo
    // branch calls it, and section markup is context-free by contract, so a TAG
    // is how the folder's markup reaches the section at all.
    registerSectionTags(engine, { baseDirs: [options.consumerDir, ...themeLayers] });
    registerLiquid(engine, {
      // template-kit's `site` slot is the CONFIG it reads (url, baseurl,
      // icons.style, translation) — `relative_url`/`absolute_url` and every
      // tag's ctx.site.config. The build-fact global is not its business.
      site: config,
      getCollection: (name) => collectionsHolder.get(name) || [],
      getCollectionNames: () => [...collectionsHolder.keys()],
      fileExists: (file) => fs.existsSync(path.join(options.consumerDir, file)),
      markdown: (content) => md.render(content),
      logos: { dir: path.join(coreDir, 'logos') },
    });
  });

  // ONE slugifier (#488): Eleventy ships a universal `slugify` filter of its
  // own, and it OUTRANKS the template-kit one amendLibrary registers (the
  // Liquid engine applies universal filters after the amendments) — so a term
  // containing `&` was linked at `a-and-r` while the taxonomy page it pointed
  // at was generated at `a-r` (src/collections.js slugifies with template-kit).
  // Every term with an `&` shipped a guaranteed dead link. template-kit's is
  // the authority — Jekyll-parity, so a migrating brand's taxonomy URLs never
  // move — and a PLUGIN is where it has to be claimed: this config callback
  // runs BEFORE Eleventy's own defaults, plugins run after.
  eleventyConfig.addPlugin((config) => config.addFilter('slugify', slugify));

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
  // Consumer-local section/component/hero-animation folders are template
  // machinery too — without the ignore, Eleventy would emit every section.html
  // (and every `_hero/<name>/index.html`, #441) as content.
  for (const machineryDir of ['_sections', '_components', HERO_DIR]) {
    eleventyConfig.ignores.add(`**/${machineryDir}/**`);
    eleventyConfig.ignores.add(path.join(path.relative(process.cwd(), options.consumerDir), machineryDir, '**'));
  }
  // A tier-2 theme lives INSIDE the input dir (`<src>/themes/<id>/`), and
  // everything under it is LAYER SOURCE — never content. The families above
  // covered a consumer's own machinery dirs but not a theme's copies of them,
  // so a consumer-local theme shipping an include override failed the build on
  // a duplicate permalink, and an INACTIVE local theme did it without even
  // being in the chain ([#773](https://github.com/Omega-JS-Stack/omega/issues/773)).
  // The whole namespace is the rule, because that is what it means: pages live
  // in `pages/`, and `resolveThemeLayers` probes exactly this directory.
  eleventyConfig.ignores.add(path.join(path.relative(process.cwd(), options.consumerDir), 'themes', '**'));
  // The cwd-relative twin, kept to the machinery families rather than the whole
  // namespace: unanchored, `**/themes/**` would also swallow a brand's own page
  // at `pages/themes/…`, and no page is ever called `_includes`.
  for (const machineryDir of ['_includes', '_layouts', '_sections', '_components', HERO_DIR]) {
    eleventyConfig.ignores.add(`**/themes/*/${machineryDir}/**`);
  }
  if (layoutMode === 'farm') {
    composeSymlinkFarm(layoutMap, options.farmDir);
    eleventyConfig.setIncludesDirectory(path.relative(options.consumerDir, options.farmDir));
  } else {
    registerVirtualLayouts(eleventyConfig, layoutMap);
  }

  // The layout CHAIN behind a page, for the layout-keyed asset lane (#624).
  // Eleventy merges a layout's frontmatter into the cascade but `data.layout`
  // stays the page's OWN declaration, so the chain is walked here from the same
  // layered map the render resolves through: `blueprint/careers` →
  // `modules/utilities/redirect` → `frontend/core/cover`, and every layout in
  // it contributes its assets.
  // The one frontmatter fence, read by both hand-parsers below (the layout
  // chain here, the page's own frontmatter further down).
  const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
  const layoutFiles = new Map();
  for (const [rel, abs] of layoutMap) layoutFiles.set(rel.replace(/\.[^.]+$/, '').split(path.sep).join('/'), abs);
  const layoutParent = new Map();
  const parentOf = (name) => {
    if (layoutParent.has(name)) return layoutParent.get(name);
    let parent = null;
    const file = layoutFiles.get(name);
    if (file) {
      const match = (reads.read(file) || '').match(FRONTMATTER_RE);
      try {
        const own = match ? yaml.load(match[1]) : null;
        if (own && typeof own.layout === 'string') parent = own.layout;
      } catch { /* exotic frontmatter — the chain simply ends here */ }
    }
    layoutParent.set(name, parent);
    return parent;
  };
  // Outermost FIRST (the root layout, then each layout that renders inside it),
  // so assets load general → specific exactly as the layer chain does.
  const layoutChain = (layout) => {
    const chain = [];
    let name = typeof layout === 'string' ? layout : null;
    while (name && !chain.includes(name)) {
      chain.unshift(name);
      name = parentOf(name);
    }
    return chain;
  };

  // ---- Frontmatter Liquid + collection tagging
  const frontmatter = createFrontmatterResolver({ site });
  // The page's pagination ALIAS (#544): `pagination.alias` is a declaration in
  // the very cascade being resolved, so a frontmatter value naming the alias is
  // per-page BY DEFINITION — it defers to the `resolved` pass exactly like a
  // `resolved.`/`page.` ref, where the alias binding exists. Without this the
  // value rendered empty at cache time and cached it, and every generated page
  // shipped the same nameless title (280 of them, found porting trusteroo).
  const aliasRoots = (data) => {
    const alias = data.pagination && data.pagination.alias;
    return alias ? new Set([alias]) : undefined;
  };
  // The alias BINDING, for the two passes that render with a per-page scope.
  const aliasScope = (data) => {
    const alias = data.pagination && data.pagination.alias;
    return alias ? { [alias]: data[alias] } : undefined;
  };
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
  const pageOwnSource = new Map();
  const readOwnSource = (inputPath) => {
    if (pageOwnSource.has(inputPath)) return pageOwnSource.get(inputPath);
    let source = null;
    try {
      source = fs.readFileSync(path.resolve(inputPath), 'utf8');
    } catch { /* virtual template — there is no file behind it */ }
    pageOwnSource.set(inputPath, source);
    return source;
  };
  const readOwnFrontmatter = (inputPath) => {
    if (pageOwnData.has(inputPath)) return pageOwnData.get(inputPath);
    let own = null;
    try {
      const match = (readOwnSource(inputPath) || '').match(FRONTMATTER_RE);
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

  // The template's own SIDECAR data file (`<template>.11tydata.*`), re-read
  // for the same reason (#269): page frontmatter is meta-only, so the sidecar
  // is the page-level lane for a SHELL layout's band data — and Eleventy's
  // cascade CONCATS a sidecar array onto the layout default, so a page could
  // only append to a band, never replace it. `resolved` re-applies the sidecar
  // with OUR deepMerge, the arrays-replace rule every other override lane
  // obeys; object/string keys land exactly where the cascade already put them.
  // EVERY sidecar form Eleventy reads synchronously rides the lane (#543):
  // .js/.cjs first, .json last, the order Eleventy itself merges them in, so
  // one contract holds no matter which extension a page reached for (found
  // porting trusteroo: the identical data as .11tydata.js still concatenated a
  // 6-item faqs.items onto the layout default). `.mjs` is async-only and stays
  // on pure cascade behavior, as a missing file — the common case — does.
  const SIDECAR_EXTENSIONS = ['.js', '.cjs', '.json'];
  const pageSidecarData = new Map();
  const sidecarPath = (inputPath, extension) => {
    const file = path.resolve(inputPath);
    return path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.11tydata${extension}`);
  };
  // A module sidecar is `require`d, so its exports outlive a config reset —
  // busting the entry keeps a dev edit from serving the boot-time value.
  const readSidecarFile = (file) => {
    if (!file.endsWith('.json')) {
      delete require.cache[require.resolve(file)];
      const loaded = require(file);
      return typeof loaded === 'function' ? loaded() : loaded;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const readSidecarData = (inputPath) => {
    if (pageSidecarData.has(inputPath)) return pageSidecarData.get(inputPath);
    let sidecar = null;
    for (const extension of SIDECAR_EXTENSIONS) {
      try {
        const parsed = readSidecarFile(sidecarPath(inputPath, extension));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          sidecar = sidecar || {};
          for (const key of Object.keys(parsed)) {
            if (!RESOLVED_OMIT.has(key)) sidecar[key] = deepMerge(sidecar[key], parsed[key]);
          }
        }
      } catch { /* no sidecar at this extension, or a malformed one — cascade behavior stands */ }
    }
    pageSidecarData.set(inputPath, sidecar);
    return sidecar;
  };

  // Is a frontmatter key a CONFIG section (#607)? Every section the schema
  // declares for a web build, plus whatever this brand's own omega.json5
  // carries — a brand key with no schema rule yet is still config, and
  // restating it bare would reach nothing at all. The SAME question decides
  // both directions of the namespace rule (Ian 2026-08-26): a section spelled
  // bare is an error, and a key under `config:` that is not one is an error.
  const isConfigSection = (key) => CONFIG_SECTIONS.has(key) || Object.hasOwn(config, key);

  // The READ half of the same seam (#611). A config key restated bare in
  // frontmatter throws above; a config key READ off the `site` global does not
  // fail at all — it renders an empty string, silently, on every page carrying
  // one. So the page's own source is censused and the first sighting stops the
  // build with the file and the expression. The census runs over the WHOLE
  // file: `{{ site.brand.name }}` inside a frontmatter value is the same dead
  // read as one in the body, and the playground's own pages hid theirs there.
  //
  // The section list is `CONFIG_SECTIONS` EXACTLY — never `isConfigSection`'s
  // `hasOwn(config, key)` widening, which is right for the frontmatter lane and
  // wrong here (the blind-verifier walk, 2026-08-25). `toSiteGlobal` always
  // derives a top-level `url`, and a brand may override `omega`/`characters` in
  // its own omega.json5; under the widening every one of those became "config",
  // so `{{ site.url }}` — the canonical idiom `omega migrate` rule 7 itself
  // writes — failed the build with no way to comply. A read guard's false
  // positive is a build a brand cannot fix, so it answers to the schema alone.
  //
  // What COUNTS as a read (Liquid context, no fenced code, no `{% raw %}`) is
  // config-sections.js's `templateReads` — the same census `omega migrate`'s
  // rule 24 rewrites from, so the guard can never fail on something the verb
  // would not have fixed.
  // `meta` IS flagged here even though it is not config at all: a page spells
  // `meta:` bare, but `site.meta` is as dead as any config read (the walk
  // lives at `resolved.meta`), and rule 24 rewrites it — so the guard may
  // demand it. DEAD_SITE_SECTIONS is that list, config sections plus `meta`.
  const configReadsIn = (source) => templateReads(source)
    .filter((read) => read.root === 'site' && DEAD_SITE_SECTIONS.has(read.key));

  eleventyConfig.addPreprocessor('omega-frontmatter', 'md,html,liquid', (data) => {
    const inputPath = data.page.inputPath;
    const ownSource = readOwnSource(inputPath) || '';

    // The OTHER dead read the census owns (#595): UJM's per-render `random_id`
    // global, which OMEGA does not have — the read renders empty and every id
    // it scopes collides. A WARNING, not a throw, unlike the config reads
    // above: `random_id` is an ordinary variable name, so a layout or an
    // include may legitimately assign it for this page, and a read guard's
    // false positive is a build a brand cannot fix.
    if (!assignsRandomId(ownSource)) {
      const leftover = randomIdReads(ownSource);
      if (leftover.length) {
        logger.warn(
          `${inputPath}:${leftover[0].line}: reads a bare \`random_id\` — UJM's per-render global is gone, so it renders `
          + `EMPTY and every id built from it collides. Assign it first: \`${RANDOM_ID_ASSIGN_IDIOM}\`. `
          + 'Run `omega migrate` to write it (docs/web/index.md).',
        );
      }
    }

    // The dead-read guard (#611), over every template with a FILE behind it —
    // a page, a collection document, a consumer's own anything. Virtual
    // templates (blueprints, the showcase, sample content) have no source to
    // read and the static lane already covers those surfaces.
    const deadReads = configReadsIn(ownSource);
    if (deadReads.length) {
      const first = deadReads[0];
      throw new Error(
        `[@omega.js/web:engine] ${inputPath}:${first.line}: reads \`${first.expression}\` — the brand config left the `
        + `\`site\` global, which is BUILD FACTS only (${SITE_FACT_KEYS.join(', ')}, plus the collections `
        + `targets.web.collections declares). Spell it `
        + `\`${first.expression.replace(/^site\./, 'resolved.config.')}\``
        + `${deadReads.length > 1 ? ` (and ${deadReads.length - 1} more in this file)` : ''}. `
        + 'Run `omega migrate` to rewrite them (docs/web/index.md).',
      );
    }

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
      applyDocumentData(collection, data, config.brand && config.brand.name);
    }

    // The OTHER half of the namespace rule (#607, Ian 2026-08-26): what is in
    // the config file goes under `config:`, and what is NOT in the config file
    // may not. A key under `config:` that no omega.json5 section answers to
    // merges into `resolved.config` and is read by nothing — a typo (`them:`),
    // or page data written into the config lane, both silent. It fails here,
    // for every template that carries frontmatter: a collection document's
    // `config:` block is the same block a page's is.
    const ownFrontmatter = readOwnFrontmatter(inputPath) || {};
    if ('config' in ownFrontmatter) {
      const ownConfig = ownFrontmatter.config;

      // Before the membership check: a `config:` that is not a MAP of sections
      // at all. `resolved` deep-merges the page block OVER the seeded config,
      // and a null (the empty key `config:` with nothing under it), an array or
      // a scalar REPLACES it — so resolved.config stops being the brand config
      // for that page and every read under it renders empty, silently. The
      // shape is the brand's own typo, so it fails here naming what arrived.
      if (!ownConfig || typeof ownConfig !== 'object' || Array.isArray(ownConfig)) {
        const shape = ownConfig === null || ownConfig === undefined
          ? 'an EMPTY key (null)'
          : (Array.isArray(ownConfig) ? 'an array' : `a ${typeof ownConfig}`);
        throw new Error(
          `[@omega.js/web:engine] ${inputPath}: \`config:\` is ${shape} — it must be a MAP of omega.json5 `
          + 'sections (config:\n  theme:\n    …). Any other shape REPLACES the whole merged config for this page, '
          + 'so every `resolved.config.*` read on it renders empty. Delete the key, or put the sections under it '
          + '(docs/web/frontmatter.md).',
        );
      }

      const strays = Object.keys(ownConfig).filter((key) => !isConfigSection(key));
      if (strays.length) {
        throw new Error(
          `[@omega.js/web:engine] ${inputPath}: \`config:\` carries `
          + `${strays.length > 1 ? 'keys' : 'a key'} ${strays.map((key) => `\`${key}\``).join(', ')} that omega.json5 has no `
          + `${strays.length > 1 ? 'sections' : 'section'} for, so nothing reads `
          + `${strays.length > 1 ? 'them' : 'it'}. \`config:\` holds omega.json5 sections ONLY `
          + `(${[...CONFIG_SECTIONS].join(', ')}); page machinery (meta, schema, redirect) stays bare, and page `
          + 'CONTENT lives in {% section %} calls in the page body (docs/web/frontmatter.md).',
        );
      }
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
      const ownKeys = own ? Object.keys(own).filter((key) => !PAGE_FRONTMATTER_ALLOW.has(key)) : [];

      // A config section restated BARE is a build ERROR, not smuggled content
      // (#607): the two namespaces are separate, so a bare `theme:` would look
      // like it overrode omega.json5 and reach nothing. No backwards
      // compatibility — `omega migrate` rewrites the page.
      const bareConfig = ownKeys.filter((key) => isConfigSection(key));
      if (bareConfig.length) {
        throw new Error(
          `[@omega.js/web:engine] ${inputPath}: frontmatter restates the config `
          + `${bareConfig.length > 1 ? 'sections' : 'section'} ${bareConfig.map((key) => `\`${key}\``).join(', ')} bare. `
          + 'A page overrides omega.json5 under a `config:` parent '
          + `(config:\n  ${bareConfig[0]}:\n    …); no config section keeps a bare spelling. `
          + 'Run `omega migrate` to move it (docs/web/frontmatter.md).',
        );
      }

      const contentKeys = ownKeys.filter((key) => !isConfigSection(key));
      if (contentKeys.length) {
        for (const key of contentKeys) delete data[key];
        logger.warn(
          `${inputPath}: ignoring frontmatter content keys (${contentKeys.join(', ')}) — `
          + `consumer page frontmatter is meta-only (layout, permalink, meta, schema, config); `
          + `content lives in {% section %} calls in the page body (docs/web/sections.md).`,
        );
      }
    }

    // The cascade IS the frontmatter render scope (#542): a value reaching for
    // one of the consumer's own `_data` globals (`{{ brands.size }}` beside a
    // `_data/brands.json`) reads the same globals a template render reads,
    // instead of rendering empty against a site-only scope. The page's own
    // pagination alias defers with the per-page refs (#544).
    frontmatter.resolveData(data, {
      globals: data,
      defer: aliasRoots(data),
      file: inputPath,
    });
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
    // THAT item's scope, whole: its pagination alias binding (#544) and the
    // `_data` globals its own cascade carries (#542) — a generated page's
    // per-document title has to read the same here as in its own head.
    return frontmatter.render(value, {
      resolved,
      page: { ...resolved, resolved, url: item.url, slug: item.data.page.fileSlug, fileSlug: item.data.page.fileSlug },
      ...aliasScope(item.data),
    }, { globals: item.data, file: item.data.page.inputPath });
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
  // Every template's permalink resolves through THIS — the global computed
  // below and every gated virtual template (renderGate) — so the production
  // /test omission (#554) covers a consumer's own page at a /test URL exactly
  // as it covers the framework default that page took over.
  const resolvePermalink = (data) => {
    const permalink = jekyllPermalink(data, allCollections);
    if (environment === 'production' && typeof permalink === 'string' && DEV_ONLY_URL_RE.test(permalink)) {
      return false;
    }
    return permalink;
  };
  eleventyConfig.addGlobalData('eleventyComputed', {
    permalink: resolvePermalink,
    // Jekyll paginator compat: layouts iterate `paginator.posts` with Jekyll
    // post shapes (post.url, post.post.title), so items are flattened
    // ({ url, date, ...data }) — references, not copies.
    paginator: (data) => {
      const p = data.pagination;
      if (!p || !p.items) return undefined;
      const totalPages = (p.pages || []).length;
      return {
        posts: p.items.map(jekyllDoc),
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
    // Each answer is a LIST — every layer that ships a file for this URL, in
    // load order (#624), because page assets never replace one another.
    pageAssets: (data) => {
      const manifest = data.assetManifest || {};
      const trimmed = (data.page.url || '/').replace(/^\/|\/$/g, '');
      const base = trimmed === '' ? 'index' : trimmed;
      return {
        js: resolvePageAsset(manifest.js && manifest.js.pages, base) || [],
        css: resolvePageAsset(manifest.css && manifest.css.pages, base) || [],
      };
    },
    // The same lookup, keyed by LAYOUT instead of URL (#624): a page gets every
    // asset of every layout in its chain, outermost first — the chain, not just
    // `data.layout`, because a blueprint that sits on the redirect layout
    // (blueprint/careers) must still get the redirect layout's script.
    layoutAssets: (data) => {
      const manifest = data.assetManifest || {};
      const chain = layoutChain(data.layout);
      return {
        js: chain.flatMap((name) => resolvePageAsset(manifest.js && manifest.js.layouts, name) || []),
        css: chain.flatMap((name) => resolvePageAsset(manifest.css && manifest.css.layouts, name) || []),
      };
    },
    resolved: (data) => {
      // inject-properties.rb parity: resolved = build facts ← layout chain ←
      // page data, PLUS the config namespace (#607).
      //
      // `resolved.config` is the WHOLE brand config with this page's own
      // `config:` block merged on top — the seed below puts the entire config
      // under the cascade (never a filtered subset: a brand section with no
      // schema rule is config too), and the generic merge that follows lets a
      // layout's or page's `config:` win key by key. `resolved.meta` carries
      // ONE seed and nothing more: meta is page machinery (Ian 2026-08-26), so
      // the walk is the site-wide index floor → page `meta:` → layout `meta`,
      // with head.html falling back to brand.name / brand.description.
      const out = {};
      for (const key of Object.keys(site)) {
        if (!resolvedSiteExclude.has(key)) out[key] = site[key];
      }
      out.config = config;

      // The site-wide index default (#564, Ian 2026-09-09, one name at both
      // levels): `targets.web.meta.index` is the SAME key a page writes, so
      // the site default and the page override never drift apart. It is a
      // SEED, not a second emission path: every signal reads the one resolved
      // `meta.index` below, so the robots meta, sitemap.xml, llms.txt and
      // pages.json cannot disagree. The merge that follows puts page and
      // layout `meta:` over it, which is how a page's own `meta.index: true`
      // exempts itself from a noindexed site. Consequential-feature doctrine
      // (#527): only the LITERAL false takes a whole site off search — absent
      // or true is today's behavior.
      if (config.meta && config.meta.index === false) out.meta = { index: false };

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

      // The index posture's AUTOMATIC exclusions (#564). Everything above is
      // authored: the site default, the layout's `meta:`, the page's own.
      // These are the framework's own, applied last because they are not
      // overridable: a draft is unpublished, a dev surface never ships, an
      // admin screen is private, a redirect stub is a forwarding URL, and
      // pages 2..N of a LISTING are duplicates of the canonical page 1. Every
      // output reads the ONE value they land on, so no template keeps a rule
      // list of its own and the signals cannot disagree.
      //
      // Alias pagination is the other shape the machinery serves (one page per
      // taxonomy TERM, `size: 1` + `alias`), where a page number is an index
      // into terms and says nothing about duplication; those pages carry their
      // own `meta.index` on their layout. Eleventy's computed-data dependency
      // pass probes with proxies, so the number is only a number on a real
      // render.
      const pageNumber = data.pagination && !data.pagination.alias && data.pagination.pageNumber;
      const url = typeof data.page.url === 'string' ? data.page.url : '';
      const layoutName = typeof out.layout === 'string' ? out.layout : '';

      if (out.draft
        || DEV_ONLY_URL_RE.test(url)
        || url.startsWith('/admin/')
        || layoutName.includes('redirect')
        || (typeof pageNumber === 'number' && pageNumber > 0)) {
        out.meta = { ...out.meta, index: false };
      }

      // Layout-frontmatter Liquid: the preprocessor only sees PAGE frontmatter,
      // so cascade data contributed by layouts (the real base contact layout
      // carries `{{ site.brand.name }}`, real sweet-saucy recipe carries
      // `{{ page.recipe.title }}` in meta values) still holds raw refs here.
      // `resolved` is in context too — layout defaults template on the merged
      // data (base alternative: tagline "The #1 {{ resolved.alternative.
      // competitor.name }} alternative"); `page.resolved` covers the legacy
      // spelling in not-yet-migrated consumer frontmatter.
      // The page's pagination alias is bound here too (#544) — this IS the
      // render-time pass its refs deferred to — and the cascade rides along as
      // the globals a `_data` ref resolves against (#542): the sidecar re-apply
      // above put RAW values back, so this is where they render.
      // Copy-on-write: shared cascade sub-objects are never mutated, and
      // pages with no remaining refs return `out` untouched.
      return frontmatter.renderData(out, {
        resolved: out,
        page: { ...out, resolved: out, url: data.page.url, slug: data.page.fileSlug, fileSlug: data.page.fileSlug },
        ...aliasScope(data),
      }, { globals: data, file: data.page.inputPath });
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
    limits: config.dev && config.dev.limitCollections,
    collections: dynamicCollections,
    environment,
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
    environment,
  });
  // Re-scan before every REBUILD, so a render can never read a decision older
  // than its own build — whichever watcher saw the file event first. The dev
  // loop's rescan watcher is the prompt lane (it updates and reports the
  // moment a file lands, before any rebuild finishes); this is the ordering
  // guarantee. A production build has exactly one build and one scan.
  if (environment !== 'production') {
    eleventyConfig.on('eleventy.before', () => decisions.refresh());
  }

  // ---- Default pages: virtual templates the consumer can take over by
  // claiming the same permalink. The showcase (development only) rides the
  // same lane: auto-generated pages over the resolved library — /test/sections
  // + one page per entry (spec §9). Production builds omit the showcase
  // entirely: a page rendering EVERY section would keep every section's CSS
  // alive through the PurgeCSS content scan and quietly defeat §7
  // self-trimming.
  // The framework's own /test pages ride that same omission (#554): their
  // permalinks are config-time facts, so a production build never registers
  // them at all. A consumer page at a /test URL is a render-time fact and is
  // shut by resolvePermalink above.
  const frameworkPages = [
    ...[...collectLayered([path.join(defaultsDir, 'pages')])]
      .map(([rel, abs]) => ({ virtual: `omega-defaults/${rel}`, label: `defaults/pages/${rel}`, abs })),
    ...(environment === 'production' ? [] : [...collectLayered([path.join(defaultsDir, 'showcase')])]
      .map(([rel, abs]) => ({ virtual: `omega-defaults/showcase/${rel}`, label: `defaults/showcase/${rel}`, abs }))),
  ].map((page) => {
    const raw = reads.read(page.abs);
    return { ...page, raw, url: permalinkOf(raw) };
  }).filter((page) => !(environment === 'production' && DEV_ONLY_URL_RE.test(page.url || '')));

  for (const page of frameworkPages) {
    // Registered UNCONDITIONALLY, gated at render time: suppression is a live
    // answer now, and a template skipped at config time could only come back
    // through a config reset.
    eleventyConfig.addTemplate(page.virtual, page.raw, renderGate(() => !decisions.suppresses(page.url), resolvePermalink));
  }

  // ---- Social shortlinks (#429): a redirect page per entry of the socials
  // block, on the same lane and the same gate as the default pages above — the
  // permalink is a config-time fact (`/<platform>`), so a consumer page at one
  // of them takes just that URL over.
  // ---- Target shortlinks (#561): the same lane again, for the download
  // platform/artifact URLs (/download/mac, /download/linux/snap) and the
  // extension store URLs (/extension/chrome) legacy UJM shipped as hand-made
  // default pages. The declaration is the SAME map /download and /extension
  // already render from.
  const shortlinkPages = [
    ...socialPages(readSocials(config.socials)),
    ...targetShortlinkPages(readTargetShortlinks(site)),
  ];
  for (const page of shortlinkPages) {
    eleventyConfig.addTemplate(page.virtual, page.raw, renderGate(() => !decisions.suppresses(page.url), resolvePermalink));
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
  decisions.framework([...frameworkPages, ...shortlinkPages, ...dynamicPages].filter((page) => page.url));

  // ---- Sample content (development only): a content-less brand still gets
  // living pages locally. Injected as virtual templates under the matching
  // collection segment so they ride the exact same lane as real content
  // (tags, permalinks, taxonomy). Dates ROLL — the corpus rhythm re-anchors
  // to the build day (or the OMEGA_SAMPLE_ANCHOR / sampleAnchor pin), spec
  // §8. The FIRST consumer file in a collection — or a production build —
  // removes that collection's samples entirely, and in dev that happens on the
  // very next render: the gate is the live own-content answer.
  if (environment !== 'production') {
    const sampleAnchorMs = resolveAnchor(options.sampleAnchor);
    for (const set of SAMPLE_SETS) {
      for (const { name, content } of generateSampleSet(defaultsDir, set, sampleAnchorMs)) {
        eleventyConfig.addTemplate(
          `omega-defaults/${set.collectionDir}/${name}`,
          content,
          renderGate(() => !decisions.hasOwn(set.collectionDir), resolvePermalink),
        );
      }
    }
  }

  // ---- Globals. ONE instant per build, so every stamp below names the same
  // moment instead of drifting a millisecond apart.
  const buildTime = new Date();
  // site.time: Jekyll's build timestamp, kept as a real build fact (#613) —
  // `article:modified_time` in the head and the BlogPosting `dateModified` in
  // the foot both read it, and with nothing setting it both shipped EMPTY on
  // every post. `site.omega.date.iso` is the same instant by construction.
  site.time = buildTime.toISOString();
  // site.omega carries UJM-runtime site values the core includes read
  // (cache_breaker in the @omega.js/client Configuration, date.year in the
  // copyright meta, date.iso as the sitemap/feed build stamp,
  // placeholder.src in lazy-loaded imgs).
  site.omega = {
    // The build stamp the runtime lazy-loader appends (cb=) — same value as
    // omega_cachebreak and the omega-cachebreak-img transform. Was 0 (inert)
    // until the central cache-breaker landed.
    cache_breaker: CACHE_TIMESTAMP,
    // The WEBSITE TARGET's own package version, read by the caller off the target
    // root's package.json (the engine only ever sees the src dir). It rides the
    // Configuration block as `version`, which is the release tag every error
    // report carries — `brand.id@version` (#380). null (a caller that hands
    // none) leaves @omega.js/client on its build-stamp fallback.
    version: options.version || null,
    date: { year: buildTime.getFullYear(), iso: site.time },
    placeholder: { src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' },
    ...(config.omega || {}),
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
    ...(config.characters || {}),
  };
  eleventyConfig.addGlobalData('site', site);
  // og:locale wants Open Graph's language_TERRITORY form (en → en_US), and the
  // code → locale map is the devkit language SSOT — the head include cannot
  // derive it in Liquid, so it arrives as a computed global.
  eleventyConfig.addGlobalData('ogLocale', ogLocale(config.translation?.default || 'en'));
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
    environment,
    dev: (typeof options.dev === 'function' ? options.dev() : options.dev) || null,
  }));
  // The manifest is a FUNCTION for the same reason (#765): an object handed to
  // addGlobalData is snapshotted into the data cascade at registration, so a
  // dev rebuild that folds a new font-preload list into the live manifest was
  // invisible to every later render — measured: the object form still served
  // the boot list after a rebuild AND after a template edit, while the
  // callback form served the new one. The dev lane mutates that object in
  // place, so the callback re-reads what the last asset build produced.
  const emptyManifest = { js: { pages: {}, layouts: {} }, css: { pages: {}, layouts: {} } };
  eleventyConfig.addGlobalData('assetManifest', () => options.assetManifest || emptyManifest);

  // ---- Icon inlining (#619, dev AND prod): every empty `<i>` whose classes
  // name an icon gets that icon's SVG inlined, so static chrome costs zero
  // runtime fetches and never flashes. What the pass emits is exactly what the
  // runtime watcher would have produced (runtime/icons.js), and the stamp it
  // leaves is what tells the watcher to leave the element alone.
  const loadIcon = createIconLoader({
    svgsDirs: [path.join(coreDir, 'icons'), ...fa.svgsDirs],
    aliasFile: fa.aliasFile,
  });
  // Warn ONCE per name per build: a missing icon in packaged chrome is a
  // framework bug a consumer cannot fix (#86), and the marker the pass leaves
  // on the element is what the dev audit reports in the browser.
  const warnedIcons = new Set();
  eleventyConfig.addTransform('omega-inline-icons', function (content) {
    if (this.page.outputPath && this.page.outputPath.endsWith('.html')) {
      return inlineIcons(content, loadIcon, (key) => {
        if (warnedIcons.has(key)) return;
        warnedIcons.add(key);
        logger.warn(`no SVG in the icon set for "${key}" — rendering an empty icon`);
      });
    }
    return content;
  });

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

  // ---- Base path (#355): a site mounted under a URL path (a GitHub Pages
  // project site) gets every root-relative URL it emits moved under that path,
  // plus the stamp the browser half reads (src/path-prefix.js). Registered ONLY
  // when a prefix is set — a build at the domain root runs no pass at all, so
  // its output is what it has always been, byte for byte. The dev server serves
  // at the root and never passes one.
  const pathPrefix = resolvePathPrefix(options.pathPrefix);
  if (pathPrefix) {
    eleventyConfig.addTransform('omega-path-prefix', function (content) {
      if (this.page.outputPath && this.page.outputPath.endsWith('.html')) {
        return prefixHtml(content, pathPrefix);
      }
      return content;
    });
  }

  // ---- Production HTML minification (the UJM minifyHtml successor). Only
  // .html outputs — the meta-files (sitemap.xml, feeds, robots.txt, …) ship
  // exactly as their templates render them.
  if (environment === 'production') {
    const { minifyHtml } = require('./minify-html.js');
    eleventyConfig.addTransform('omega-minify-html', function (content) {
      if (this.page.outputPath && this.page.outputPath.endsWith('.html')) {
        return minifyHtml(content);
      }
      return content;
    });
  }

  return { site, config, layers, layoutMap, frontmatter, suppressed: decisions.suppressedUrls(), decisions, collectionsHolder };
}

/**
 * One Eleventy collection item as a JEKYLL document: the flat shape layouts
 * iterate (`post.url`, `post.date`, `post.post.title`) plus Jekyll's
 * `post.content` — a reference to the item, never a copy.
 *
 * `content` is LAZY and non-enumerable (#598). Eleventy renders collection
 * content AFTER computed data resolves, so reading it here would throw its
 * premature-use error, and an enumerable getter would throw the same error in
 * every data walk that copies the doc (the `resolved` merge, the frontmatter
 * render pass). Read at RENDER time it is the post's real body — which is
 * what `{% omega_readtime %}` counts: the blog hub's featured card printed
 * "1 min read" for a twelve-minute post while the post's own page printed 12.
 *
 * BOTH doc lanes flatten through here (#711): `paginator.posts` passes raw
 * Eleventy items, the `site.<name>` arrays pass the collection holder's docs
 * (collections.js `toDoc`, which forwards `templateContent` the same lazy
 * way). `id` is the holder doc's — an item has none — and sits before the data
 * spread so a document's explicit frontmatter id still wins.
 * @param {object} item - an Eleventy collection item, or a holder doc
 * @returns {object} the Jekyll doc shape
 */
function jekyllDoc(item) {
  const identity = item.id === undefined ? {} : { id: item.id };
  const doc = { ...identity, url: item.url, date: item.date, ...item.data };
  Object.defineProperty(doc, 'content', {
    get: () => item.templateContent,
    enumerable: false,
    configurable: true,
  });
  return doc;
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
 * @param {function} resolvePermalink - the build's shared permalink resolver (jekyllPermalink plus the production /test omission)
 * @returns {object} addTemplate data
 */
function renderGate(isActive, resolvePermalink) {
  return {
    eleventyComputed: {
      // Open gate: the same permalink the global computed would have produced
      // (a per-template `eleventyComputed.permalink` replaces that key).
      permalink: (data) => (isActive() ? resolvePermalink(data) : false),
      // Open gate: the page's OWN frontmatter answer stands VERBATIM — `true`,
      // the list-of-collections form, or undefined for the pages that never
      // set it. Narrowing it to a boolean here would quietly rewrite a
      // template's own answer into one this gate never asked about.
      eleventyExcludeFromCollections: (data) => (isActive() ? data.eleventyExcludeFromCollections : true),
    },
  };
}

module.exports = { configureOmega };
