/**
 * The Eleventy engine core for the OMEGA A1 slice — everything the bake-off
 * scores lives here: layered themes (virtual templates / symlink farm),
 * template-kit registration on Eleventy's own LiquidJS instance, frontmatter
 * Liquid rendering, the `resolved` data alias (page.resolved equivalent —
 * native data cascade), Jekyll conventions (dated post filenames, permalink
 * normalization), blog collections + taxonomy, and default pages as virtual
 * templates suppressed by same-URL consumer files.
 */
const fs = require('node:fs');
const path = require('node:path');
const markdownIt = require('markdown-it');
const { registerLiquid } = require('@omegajs/template-kit/register-liquid');
const { toSiteGlobal } = require('@omegajs/config/site-global');
const { createFrontmatterResolver } = require('@omegajs/bakeoff-shared/src/frontmatter-liquid.js');
const { collectLayered } = require('@omegajs/bakeoff-shared/src/layers.js');
const { permalinkOf, scanConsumerPermalinks } = require('@omegajs/bakeoff-shared/src/consumer-scan.js');
const { registerVirtualLayouts, composeSymlinkFarm } = require('./themes.js');

// Data-cascade keys that are engine machinery, not page/layout data — everything
// else IS the resolved page data (the cascade already deep-merged layout
// defaults under page frontmatter, which is exactly what inject-properties.rb
// computed as page.resolved).
const RESOLVED_OMIT = new Set([
  'collections', 'content', 'page', 'eleventy', 'pkg', 'eleventyComputed',
  'resolved', 'permalink', 'layout', 'tags', 'pagination', 'site', 'assetManifest',
]);

/**
 * Configure an Eleventy instance as an OMEGA web engine.
 * @param {object} eleventyConfig
 * @param {object} options
 * @param {string} options.consumerDir - the consumer site (corpus) — Eleventy input dir
 * @param {object} options.siteData - raw site data (site-data.json shape / resolved omega config)
 * @param {string} options.themesDir - directory containing theme layer dirs
 * @param {string} options.coreDir - the framework core layer (icons, css, js)
 * @param {string} options.defaultsDir - framework default pages dir
 * @param {string} [options.activeTheme] - theme id (default: siteData.theme.id)
 * @param {string} [options.layoutMode] - 'virtual' (default) or 'farm'
 * @param {string} [options.farmDir] - symlink-farm target (farm mode)
 * @param {object} [options.assetManifest] - js/css manifest from the asset build
 * @returns {object} internals exposed for tests ({ site, layers, frontmatter })
 */
function configureOmega(eleventyConfig, options) {
  const site = toSiteGlobal(options.siteData);
  const activeTheme = options.activeTheme || (site.theme && site.theme.id) || 'classy';
  const layoutMode = options.layoutMode || 'virtual';

  // Reflect the active theme into the site global templates render against
  site.theme = { ...(site.theme || {}), id: activeTheme };

  // ---- Theme layer chain: active theme → classy base → core
  const themeLayers = [...new Set([activeTheme, 'classy'])]
    .map((id) => path.join(options.themesDir, id));
  const layers = [...themeLayers, options.coreDir];

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
  });

  // ---- template-kit on Eleventy's own Liquid instance
  const md = markdownIt({ html: true });
  const collectionsHolder = new Map();

  eleventyConfig.amendLibrary('liquid', (engine) => {
    registerLiquid(engine, {
      site,
      getCollection: (name) => collectionsHolder.get(name) || [],
      getCollectionNames: () => [...collectionsHolder.keys()],
      fileExists: (file) => fs.existsSync(path.join(options.consumerDir, file)),
      markdown: (content) => md.render(content),
      icons: {
        fontAwesomeDir: path.join(options.coreDir, 'icons'),
        flagsDir: path.join(options.coreDir, 'icons', 'flags'),
        style: 'solid',
      },
      logos: { dir: path.join(options.coreDir, 'logos') },
    });
  });

  // ---- Layered layouts (zero copying): virtual templates or symlink farm.
  // The farm must live OUTSIDE the input dir — inside it, Eleventy processes
  // the symlinked layouts as content templates (and `../`-relative inputs
  // defeat ignore globs).
  const layoutMap = collectLayered(themeLayers.map((layer) => path.join(layer, '_layouts')));
  if (layoutMode === 'farm') {
    composeSymlinkFarm(layoutMap, options.farmDir);
    eleventyConfig.setIncludesDirectory(path.relative(options.consumerDir, options.farmDir));
  } else {
    registerVirtualLayouts(eleventyConfig, layoutMap);
  }

  // ---- Legacy bracket-layout hack → alias table. Layout values are resolved
  // BEFORE preprocessors run (Template #getData vs getTemplates), so this
  // cannot be a data transform — it's a fixed alias set for the one legacy
  // idiom (`themes/[ site.theme.id ]/frontend/core/base`); the migration
  // codemod (B4) rewrites these away permanently.
  const themeIds = fs.readdirSync(options.themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const legacyForms = [
    'themes/[ site.theme.id ]/frontend/core/base',
    'themes/[site.theme.id]/frontend/core/base',
    ...themeIds.map((id) => `themes/${id}/frontend/core/base`),
  ];
  for (const from of legacyForms) eleventyConfig.addLayoutAlias(from, 'core/base.html');

  // ---- Frontmatter Liquid + collection tagging
  const frontmatter = createFrontmatterResolver({ site });
  eleventyConfig.addPreprocessor('omega-frontmatter', 'md,html,liquid', (data) => {
    const inputPath = data.page.inputPath;
    if (inputPath.includes('/_posts/')) data.tags = ['posts'];
    else if (inputPath.includes('/_alternatives/')) data.tags = ['alternatives'];
    else if (inputPath.includes('/_team/')) data.tags = ['team'];

    frontmatter.resolveData(data);
  });

  // ---- Jekyll conventions + page.resolved equivalent
  eleventyConfig.addGlobalData('eleventyComputed', {
    permalink: (data) => {
      const inputPath = data.page.inputPath;
      // Jekyll dated filenames: Eleventy's fileSlug already strips the date
      if (inputPath.includes('/_posts/')) return `/blog/${data.page.fileSlug}/`;
      if (inputPath.includes('/_alternatives/')) return `/alternatives/${data.page.fileSlug}/`;
      // Jekyll pretty URLs: `/about` means `/about/index.html`
      if (typeof data.permalink === 'string' && !path.extname(data.permalink) && !data.permalink.endsWith('/')) {
        return `${data.permalink}/`;
      }
      return data.permalink;
    },
    resolved: (data) => {
      const out = {};
      for (const key of Object.keys(data)) {
        if (!RESOLVED_OMIT.has(key)) out[key] = data[key];
      }

      // Layout-frontmatter Liquid: the preprocessor only sees PAGE frontmatter,
      // so cascade data contributed by layouts (real classy contact carries
      // `{{ site.brand.name }}`, real sweet-saucy recipe carries
      // `{{ page.recipe.title }}` in meta values) still holds raw refs here.
      // Copy-on-write: shared cascade sub-objects are never mutated, and
      // pages with no remaining refs return `out` untouched.
      return frontmatter.renderData(out, {
        page: { ...out, url: data.page.url, slug: data.page.fileSlug, fileSlug: data.page.fileSlug },
      });
    },
  });

  // ---- Collections: posts, alternatives, blog taxonomy
  const toDoc = (item) => ({ id: item.inputPath, url: item.url, data: item.data });

  eleventyConfig.addCollection('posts', (api) => {
    // Slug tie-break: same-date posts must order identically across engines
    const posts = api.getFilteredByTag('posts')
      .sort((a, b) => (b.date - a.date) || a.page.fileSlug.localeCompare(b.page.fileSlug));
    collectionsHolder.set('posts', posts.map(toDoc));
    return posts;
  });

  eleventyConfig.addCollection('alternatives', (api) => {
    const docs = api.getFilteredByTag('alternatives').sort((a, b) => a.url.localeCompare(b.url));
    collectionsHolder.set('alternatives', docs.map(toDoc));
    return docs;
  });

  eleventyConfig.addCollection('team', (api) => {
    const docs = api.getFilteredByTag('team').sort((a, b) => a.url.localeCompare(b.url));
    collectionsHolder.set('team', docs.map(toDoc));
    return docs;
  });

  eleventyConfig.addCollection('postCategories', (api) => aggregateTaxonomy(api, 'categories'));
  eleventyConfig.addCollection('postTags', (api) => aggregateTaxonomy(api, 'tags'));

  // ---- Default pages: virtual templates unless the consumer owns the URL
  const consumerUrls = scanConsumerPermalinks(options.consumerDir);
  const defaultPages = collectLayered([path.join(options.defaultsDir, 'pages')]);
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

  // ---- Globals
  eleventyConfig.addGlobalData('site', site);
  eleventyConfig.addGlobalData('assetManifest', options.assetManifest || { js: {}, css: {} });

  return { site, layers, layoutMap, frontmatter, suppressed, collectionsHolder };
}

/**
 * Aggregate the blog taxonomy from posts' `post.categories` / `post.tags`.
 * @param {object} api - Eleventy collection API
 * @param {string} field
 * @returns {Array<{ name: string, slug: string, posts: object[] }>}
 */
function aggregateTaxonomy(api, field) {
  const groups = new Map();

  // Same order as the posts collection (date desc, slug tie-break) so
  // taxonomy listings match across engines
  const posts = api.getFilteredByTag('posts')
    .sort((a, b) => (b.date - a.date) || a.page.fileSlug.localeCompare(b.page.fileSlug));

  for (const item of posts) {
    for (const name of (item.data.post && item.data.post[field]) || []) {
      if (!groups.has(name)) groups.set(name, { name, slug: slugify(name), posts: [] });
      groups.get(name).posts.push(item);
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Minimal slug helper (mirrors the corpus generator's slugify).
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

module.exports = { configureOmega };
