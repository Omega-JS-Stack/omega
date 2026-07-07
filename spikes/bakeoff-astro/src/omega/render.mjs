/**
 * render.mjs — the per-page render orchestration every route shares:
 * frontmatter Liquid → layout dispatch → `resolved` deep-merge → body render.
 */
import templateKitConfig from '@omegajs/config/site-global';
import { activeThemeId, loadSiteData, loadAssetManifest } from './paths.mjs';
import { contentEngine, renderBody } from './liquid.mjs';
import { resolveLayoutModule } from './layouts.mjs';
import { computeResolved, normalizeLayout } from './resolve.mjs';

const { toSiteGlobal } = templateKitConfig;

// Site global cache — constant per build process
let siteCache = null;

/**
 * The `site.*` global templates render against, with the active theme id
 * reflected (mirrors the Eleventy candidate's configureOmega).
 * @returns {object}
 */
export function getSite() {
  if (siteCache) return siteCache;

  const site = toSiteGlobal(loadSiteData());
  site.theme = { ...(site.theme || {}), id: activeThemeId() };
  siteCache = site;
  return site;
}

/**
 * Prepare a content entry for rendering: returns everything the route's
 * template needs.
 * @param {object} entry - content-collection entry
 * @param {string} url - the page URL ('/pricing/')
 * @param {object} [extra] - extra page context (date for posts, …)
 * @returns {{ Layout: any, site: object, page: object, resolved: object, contentHtml: string, assetManifest: object }}
 */
export function renderPage(entry, url, extra = {}) {
  const site = getSite();
  const { frontmatter } = contentEngine(site);

  // The content layer freezes entry data — clone before the in-place
  // frontmatter Liquid pass. Page-referencing values ({{ page.recipe.* }})
  // render against the page scope, mirroring the Eleventy candidate.
  const slug = String(entry.id).split('/').filter(Boolean).pop();
  const data = structuredClone(entry.data);
  frontmatter.resolveData(data, undefined, { page: { ...data, url, slug } });

  const layoutName = normalizeLayout(data.layout) || 'core/base';
  const layoutModule = resolveLayoutModule(layoutName);
  const resolved = computeResolved(layoutModule.defaults, data);

  const page = {
    url,
    inputPath: entry.filePath || entry.id,
    slug,
    date: data.date,
    canonical: { url: site.url + url },
    ...extra,
  };
  const contentHtml = renderBody(entry, site, { page, resolved });

  return {
    Layout: layoutModule.default,
    site,
    page,
    resolved,
    contentHtml,
    assetManifest: loadAssetManifest(),
  };
}
