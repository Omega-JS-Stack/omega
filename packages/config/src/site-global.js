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
 * exist yet. WHICH repo those links address is not decided here: it is
 * [repo.js](repo.js)'s `releasesRepo`, the one home of the brand's public
 * releases repo (#799).
 *
 * Beside the hub sits `downloads` ([#620](https://github.com/Omega-JS-Stack/omega/issues/620)):
 * one DIRECT-download URL per artifact, so a download button hands over a file
 * instead of a GitHub page. The filenames are
 * [desktop-artifacts.js](desktop-artifacts.js)'s — the same rule
 * @omega.js/desktop packages under — and they carry no version, so releasing a
 * desktop build never touches the website.
 */

const { desktopProductName, desktopArtifactNames } = require('./desktop-artifacts.js');
const { releasesRepo } = require('./repo.js');

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
 * The GitHub releases URL a desktop target's downloads point at: the brand's ONE
 * public releases repo, whose address `@omega.js/config`'s `releasesRepo` owns
 * (#799). Nothing is derived here; a repo the derivation cannot address (no
 * owner, no brand.id) yields no URL.
 * @param {object} config - resolved config object
 * @returns {string|undefined}
 */
function desktopReleasesUrl(config) {
  const desktop = targetEntry(config, 'desktop');

  // Idempotence: the build pipeline applies toSiteGlobal more than once
  // (consumer.js loadSiteData, then engine.js configureOmega). On a second pass
  // the raw releases block is gone, so the curated view's own URL is the
  // authority: re-deriving would rename a brand's explicit releases.repo to the
  // `<brand.id>-releases` default behind its back.
  if (!desktop?.releases && desktop?.releasesUrl) return desktop.releasesUrl;

  const { repo } = releasesRepo(config);

  return repo ? `https://github.com/${repo}/releases/latest` : undefined;
}

/**
 * The direct-download URL of every desktop artifact, keyed platform → artifact
 * (#620). GitHub's `/releases/latest/download/<asset>` serves the newest
 * release's asset by name, which only holds because the names are versionless.
 * @param {object} config - resolved config object
 * @param {string} releasesUrl - the derived releases hub URL
 * @returns {object|undefined}
 */
function desktopDownloads(config, releasesUrl) {
  const desktop = targetEntry(config, 'desktop');

  // Idempotence, same trap as the URL above: the second toSiteGlobal pass sees
  // the curated view, which carries no app block and no brand-derived product
  // name — the curated URLs are the authority by then.
  if (desktop?.downloads) return desktop.downloads;

  // No product name (an invalid config — brand.name is required) derives
  // nothing: a guessed filename is a download button that 404s.
  const names = desktopArtifactNames(desktopProductName({ app: desktop?.app, brand: config?.brand }));
  if (!Object.keys(names).length) return undefined;

  const downloads = {};
  for (const [platform, artifacts] of Object.entries(names)) {
    downloads[platform] = {};
    for (const [artifact, filename] of Object.entries(artifacts)) {
      downloads[platform][artifact] = `${releasesUrl}/download/${filename}`;
    }
  }

  return downloads;
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
    if (releasesUrl) {
      view.releasesUrl = releasesUrl;
      const downloads = desktopDownloads(config, releasesUrl);
      if (downloads) view.downloads = downloads;
    }
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
