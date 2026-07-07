/**
 * site-global.js — shape a resolved omega.json5 config as the Jekyll-style
 * `site.*` global, so existing template references port verbatim to the new
 * SSG (plan §2: toSiteGlobal()).
 *
 * Scoped by the real-usage audit (2026-07-06) of UJM's theme/blueprints +
 * somiibo: config-owned keys referenced in templates are site.{brand, url,
 * theme, meta, socials, download, translation, extension, analytics,
 * web_manager, icons, currency, advertising, …} — which is the resolved
 * config's own shape, so this is an identity mapping plus: machinery keys
 * stripped (`targets`, `enabled`), `url` derived (explicit url, else
 * brand.url), `baseurl` defaulted. ENGINE-owned keys (site.posts, site.pages,
 * site.data, site.time, site.collections) are the SSG's job, not config's.
 *
 * The resolved config for target 'web' already overlays targets.web onto the
 * top level, so web-specific sections land here automatically.
 */

// Keys that are resolution machinery, not site content
const MACHINERY_KEYS = ['targets', 'enabled'];

/**
 * Convert a RESOLVED config (loadConfig(...).config) into the site.* global.
 * @param {object} config - resolved config object
 * @returns {object} the site global (new object; config is not mutated)
 */
function toSiteGlobal(config) {
  const site = {};

  for (const [key, value] of Object.entries(config || {})) {
    if (MACHINERY_KEYS.includes(key)) continue;
    site[key] = value;
  }

  site.url = config?.url || config?.brand?.url || '';
  site.baseurl = config?.baseurl || '';

  return site;
}

module.exports = { toSiteGlobal };
