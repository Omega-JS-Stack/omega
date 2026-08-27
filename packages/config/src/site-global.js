/**
 * site-global.js — shape a resolved omega.json5 config as the Jekyll-style
 * `site.*` global, so existing template references port verbatim to the new
 * SSG (plan §2: toSiteGlobal()).
 *
 * Scoped by the real-usage audit (2026-07-06) of UJM's theme/blueprints +
 * somiibo: config-owned keys referenced in templates are the resolved
 * config's own shape, so this is an identity mapping plus: machinery keys
 * stripped (`targets`, `enabled`), `url` derived (explicit url, else
 * brand.url), `baseurl` defaulted. ENGINE-owned keys (posts, pages, data,
 * time) are the SSG's job, not config's. `collections` is NOT one of them
 * (#207): it is the config-carried collections DECLARATION
 * (`targets.web.collections`), which rides the identity mapping like any
 * other section and which the engine reads to generate each declared
 * collection's pages.
 *
 * The resolved config for target 'web' already overlays targets.web onto the
 * top level, so web-specific sections land here automatically.
 *
 * site.targets (#85) is a CURATED view of the raw `targets` machinery —
 * an explicit allow-list of display-safe facts (presence, the derived
 * desktop releases URL, extension store listings), never a spread of the
 * raw config. It is the ONLY home of those facts
 * ([#610](https://github.com/Omega-JS-Stack/omega/issues/610)): the
 * `/download` page, the `/extension` page and the shortlink generator all
 * read `site.targets.desktop.releasesUrl` and
 * `site.targets.extension.listings` directly. The legacy UJM-shaped
 * `download`/`extension` page maps — and the derivation that filled them —
 * are gone; the validator refuses a config still carrying either key.
 *
 * The desktop derivation is OPT-IN (#124): only a brand that carries a
 * `targets.desktop.releases` block gets releases/latest links — merely
 * declaring a desktop target derives nothing, since the release may not
 * exist yet.
 */

// Keys that are resolution machinery, not site content
const MACHINERY_KEYS = ['targets', 'enabled'];

/**
 * Whether the brand OPTED IN to derived desktop download links (#124):
 * declaring a desktop target is not enough — a `targets.desktop.releases`
 * block must be present (`enabled` defaults true when it is), and
 * `releases.enabled: false` always suppresses. On the pipeline's second
 * toSiteGlobal pass the raw block is gone, so a curated `releasesUrl` is
 * itself the opt-in (idempotence).
 * @param {object} config - resolved config object
 * @returns {boolean}
 */
function desktopReleasesEnabled(config) {
  const desktop = targetEntry(config, 'desktop');
  if (!desktop) return false;
  if (desktop.releases) return desktop.releases.enabled !== false;

  return Boolean(desktop.releasesUrl);
}

/**
 * The GitHub releases URL a desktop target's downloads point at.
 * Repo precedence: targets.desktop.releases.repo (where built artifacts
 * live) → repo.providers.github.repo (the brand website repo) → brand.id (the derivation
 * default for the repo name). No repo.providers.github.org → no URL.
 * @param {object} config - resolved config object
 * @returns {string|undefined}
 */
function desktopReleasesUrl(config) {
  const desktop = targetEntry(config, 'desktop');
  const org = config?.repo?.providers?.github?.org;
  const repo = desktop?.releases?.repo;

  if (repo && org) return `https://github.com/${org}/${repo}/releases/latest`;

  // Idempotence: the build pipeline applies toSiteGlobal more than once
  // (consumer.js loadSiteData, then engine.js configureOmega). On a second
  // pass the raw releases.repo is gone — the curated view's own URL is the
  // authority, and re-deriving from repo.providers.github.repo/brand.id would silently
  // change it.
  if (desktop?.releasesUrl) return desktop.releasesUrl;

  const fallback = config?.repo?.providers?.github?.repo || config?.brand?.id;
  if (!org || !fallback) return undefined;

  return `https://github.com/${org}/${fallback}/releases/latest`;
}

/**
 * A target's config entry when it is the plain-object form. Array-form
 * (multi-instance) targets return undefined: which instance's facts belong
 * on the site is ambiguous, so instance-form brands supply explicit page
 * maps instead of getting a silently wrong derivation.
 * @param {object} config - resolved config object
 * @param {string} name - target key
 * @returns {object|undefined}
 */
function targetEntry(config, name) {
  const entry = config?.targets?.[name];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  return entry;
}

/**
 * Curate one target's display-safe view. Presence = enabled; per-type
 * extras are allow-listed here, never spread from the raw entry.
 * @param {string} name - target key (web, backend, desktop, extension, …)
 * @param {object} config - resolved config object
 * @returns {object}
 */
function curateTarget(name, config) {
  const view = { enabled: true };

  if (name === 'desktop' && desktopReleasesEnabled(config)) {
    const releasesUrl = desktopReleasesUrl(config);
    if (releasesUrl) view.releasesUrl = releasesUrl;
  }

  if (name === 'extension') {
    const listings = targetEntry(config, 'extension')?.listings;
    if (listings) {
      const curated = {};
      for (const [store, entry] of Object.entries(listings)) {
        if (!entry?.url && !entry?.state) continue; // empty entries stay absent, never a truthy {}
        curated[store] = {
          ...(entry.url ? { url: entry.url } : {}),
          ...(entry.state ? { state: entry.state } : {}),
        };
      }
      if (Object.keys(curated).length) view.listings = curated;
    }
  }

  return view;
}

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

  // Curated targets view (#85) — raw machinery stays stripped above.
  const targets = config?.targets;
  if (targets && typeof targets === 'object') {
    site.targets = {};
    for (const name of Object.keys(targets)) {
      site.targets[name] = curateTarget(name, config);
    }
  }

  return site;
}

module.exports = { toSiteGlobal };
