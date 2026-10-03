/**
 * What one page loads, read off the asset manifest: the engine registers each
 * function here as a computed global of the same name. Every answer is a LIST
 * in load order, because page and layout assets never replace one another:
 * every layer that ships a file for a key loads, core first.
 */
const { resolvePageAsset } = require('./assets.js');

/**
 * The page's own assets, keyed by URL alone: `<key>` for flat entries
 * (js/pages/pricing.js), `<key>/index` for per-page dirs
 * (js/pages/pricing/index.js), and `[name]` wildcard segments for generated
 * page families (js/pages/blog/[slug].js serves every /blog/<slug> post).
 * @param {object} [manifest] - the asset manifest
 * @param {string|false} url - the page's URL
 * @returns {{ js: string[], css: object[] }}
 */
function pageAssets(manifest = {}, url) {
  const trimmed = (url || '/').replace(/^\/|\/$/g, '');
  const base = trimmed === '' ? 'index' : trimmed;
  return {
    js: resolvePageAsset(manifest.js && manifest.js.pages, base) || [],
    css: resolvePageAsset(manifest.css && manifest.css.pages, base) || [],
  };
}

/**
 * The same lookup keyed by LAYOUT: every asset of every layout in the page's
 * chain, outermost first. The chain, not just the page's own layout, because a
 * blueprint that sits on the redirect layout must still get its script.
 * @param {object} [manifest] - the asset manifest
 * @param {string[]} chain - layout names, outermost first
 * @returns {{ js: string[], css: object[] }}
 */
function layoutAssets(manifest = {}, chain) {
  return {
    js: chain.flatMap((name) => resolvePageAsset(manifest.js && manifest.js.layouts, name) || []),
    css: chain.flatMap((name) => resolvePageAsset(manifest.css && manifest.css.layouts, name) || []),
  };
}

/**
 * The modulepreload links for each module entry the page loads, in the order
 * the page loads them: first paint (the head), main, each layout, each page
 * module. A chunk two entries share is listed once, under the first.
 * @param {object} [manifest] - the asset manifest (`js.imports`: entry URL → its static chunks)
 * @param {string|false} url - the page's URL
 * @param {string[]} chain - layout names, outermost first
 * @returns {Object<string, string[]>} entry URL → the chunk URLs to preload beside it
 */
function modulePreloads(manifest = {}, url, chain) {
  const js = manifest.js || {};
  // A manifest from no asset build (an engine test's) carries no imports.
  const imports = js.imports || {};
  const linked = new Set();
  const byEntry = {};
  for (const entry of [js.firstPaint, js.main, ...layoutAssets(manifest, chain).js, ...pageAssets(manifest, url).js]) {
    if (entry in byEntry) continue;
    byEntry[entry] = (imports[entry] || []).filter((chunk) => !linked.has(chunk));
    byEntry[entry].forEach((chunk) => linked.add(chunk));
  }

  return byEntry;
}

module.exports = { pageAssets, layoutAssets, modulePreloads };
