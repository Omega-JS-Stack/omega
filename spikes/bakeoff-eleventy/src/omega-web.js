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
const { createFrontmatterResolver } = require('./frontmatter-liquid.js');
const { collectLayered, registerVirtualLayouts, composeSymlinkFarm } = require('./themes.js');

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
  eleventyConfig.setLiquidOptions({
    jekyllInclude: true,
    root: layers.map((layer) => path.join(layer, '_includes')),
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
      return out;
    },
  });

  // ---- Collections: posts, alternatives, blog taxonomy
  const toDoc = (item) => ({ id: item.inputPath, url: item.url, data: item.data });

  eleventyConfig.addCollection('posts', (api) => {
    const posts = api.getFilteredByTag('posts').sort((a, b) => b.date - a.date);
    collectionsHolder.set('posts', posts.map(toDoc));
    return posts;
  });

  eleventyConfig.addCollection('alternatives', (api) => {
    const docs = api.getFilteredByTag('alternatives').sort((a, b) => a.url.localeCompare(b.url));
    collectionsHolder.set('alternatives', docs.map(toDoc));
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

  for (const item of api.getFilteredByTag('posts')) {
    for (const name of (item.data.post && item.data.post[field]) || []) {
      if (!groups.has(name)) groups.set(name, { name, slug: slugify(name), posts: [] });
      groups.get(name).posts.push(item);
    }
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan the consumer dir for page permalinks (cheap frontmatter regex — used
 * only to decide default-page suppression, ~100 files).
 * @param {string} consumerDir
 * @returns {Set<string>} normalized URLs (`/about` → `/about/`)
 */
function scanConsumerPermalinks(consumerDir) {
  const urls = new Set();
  const pagesDir = path.join(consumerDir, 'pages');
  if (!fs.existsSync(pagesDir)) return urls;

  for (const entry of fs.readdirSync(pagesDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(md|html)$/.test(entry.name)) continue;

    const raw = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
    const url = permalinkOf(raw);
    if (url) urls.add(url);
  }

  return urls;
}

/**
 * Extract and normalize the `permalink:` value from raw frontmatter.
 * @param {string} raw
 * @returns {string|null}
 */
function permalinkOf(raw) {
  const match = raw.match(/^permalink:\s*(\S+)\s*$/m);
  if (!match) return null;

  let url = match[1].replace(/^["']|["']$/g, '');
  if (!path.extname(url) && !url.endsWith('/')) url += '/';
  return url;
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
