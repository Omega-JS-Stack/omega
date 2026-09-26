/**
 * Download and extension shortlink pages (#561) — the download/extension half
 * of the shortlink lane #429 opened for socials.
 *
 * The pages it generates:
 * `/download/mac`, `/download/mac/universal`, `/download/linux/snap`,
 * `/extension/chrome`, … Each is linked from a store page, a third-party
 * listing or an old post, and every migrating brand 404s the lot of them.
 *
 * A brand never hand-authors these (FILE-AND-SKIP ruling), and since
 * [#610](https://github.com/Omega-JS-Stack/omega/issues/610) there is exactly
 * ONE declaration to read: the curated `site.targets` view — the same facts
 * `/download` and `/extension` render from.
 *
 *   <the desktop target>.downloads[platform][format] → every desktop shortlink
 *   <the extension target>.listings[store]            → /extension/<store>
 *
 * The view is keyed by target NAME ([#886](https://github.com/Omega-JS-Stack/omega/issues/886)),
 * so neither target is looked up by a key spelled for its type: a desktop
 * target named `app` declares its download shortlinks like any other.
 *
 * A download shortlink hands over the FILE, never the releases page
 * ([#620](https://github.com/Omega-JS-Stack/omega/issues/620)): the curated
 * view's per-artifact URLs are versionless, so a desktop release never touches
 * the website and these links never change.
 *
 * `/download/<platform>` with no format points at the platform's FIRST
 * format: /download/mac goes to the dmg and /download/linux to the .deb.
 *
 * The URL segments are FORMATS now, the one vocabulary
 * ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
 * `/download/mac/dmg`, `/download/windows/nsis`, `/download/linux/deb`. The
 * words those three replaced (`mac/universal`, `windows/universal`,
 * `linux/debian`) keep their pages as REDIRECTS to the same file: a link on a
 * third-party listing outlives our vocabulary, and a 404 is a lost download.
 */
const { redirectPage } = require('./redirect-page.js');

// A store key is a URL segment (a brand authors these under
// targets.extension.listings).
const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/** How a bad key prints in an error — readable when it is legal, quoted when not. */
const at = (key) => (KEY_PATTERN.test(key) ? key : JSON.stringify(key));

// The URL segments the format vocabulary replaced (#867), each pointing at the
// same file its successor does. Not a dual read of anything: these are two
// PAGES, the live one and the one an old link still asks for.
const LEGACY_SEGMENTS = {
  'mac/dmg': 'mac/universal',
  'windows/nsis': 'windows/universal',
  'linux/deb': 'linux/debian',
};

/**
 * The desktop shortlinks: one per platform (its first format), one per format,
 * and one per retired segment. Each points straight at that format's file, or
 * at its store page for a format a store publishes (the snap). The platform and
 * format keys (and their order) are the curatedview's own, which is
 * @omega.js/config's format table. A desktop target that did not opt into
 * releases (#124) carries no `downloads` and declares nothing.
 * @param {object} [desktop] - the curated site.targets.desktop view
 * @returns {Array<{ label: string, url: string, redirect: string }>}
 */
function readDownloads(desktop) {
  const downloads = desktop && desktop.downloads;
  if (!downloads) return [];

  const entries = [];

  for (const [platform, formats] of Object.entries(downloads)) {
    const urls = Object.entries(formats || {});
    if (!urls.length) continue;

    // The bare platform URL leads with the first format (legacy parity).
    entries.push({ label: `download.${platform}`, url: `/download/${platform}`, redirect: urls[0][1] });
    for (const [format, url] of urls) {
      entries.push({ label: `download.${platform}.${format}`, url: `/download/${platform}/${format}`, redirect: url });

      const legacy = LEGACY_SEGMENTS[`${platform}/${format}`];
      if (legacy) entries.push({ label: `download.${legacy.replace('/', '.')}`, url: `/download/${legacy}`, redirect: url });
    }
  }

  return entries;
}

/**
 * The extension shortlinks: one per store listing that has a URL. A listing
 * with only a `state` (announced, not shipped) declares no page, exactly the
 * way the /extension page already leaves it on Coming soon. A malformed key is
 * an ERROR — a shortlink that silently fails to generate is a dead link on a
 * third-party listing nobody controls.
 * @param {object} [extension] - the curated site.targets.extension view
 * @returns {Array<{ label: string, url: string, redirect: string }>}
 * @throws {Error} on an unusable store key
 */
function readListings(extension) {
  const listings = extension && extension.listings;
  if (!listings) return [];

  const entries = [];

  for (const [store, entry] of Object.entries(listings)) {
    const url = entry && entry.url;
    if (!url) continue; // a store the brand has not shipped to

    if (!KEY_PATTERN.test(store)) {
      throw new Error(
        `targets.extension.listings.${at(store)} is not a usable store key — a key is lowercase, starts with a letter, and names the shortlink URL (/extension/${store})`,
      );
    }

    entries.push({ label: `extension.${store}`, url: `/extension/${store}`, redirect: url });
  }

  return entries;
}

/**
 * Every shortlink the curated targets view declares.
 * @param {object} [site] - the site global (reads site.targets)
 * @returns {Array<{ label: string, url: string, redirect: string }>}
 */
function readTargetShortlinks(site) {
  const entries = Object.values((site && site.targets) || {});

  // The curated view carries the facts, not the raw `type`, so a target is
  // desktop or extension by the fact ONLY that type derives (the same test
  // @omega.js/config's site-global applies when it curates them). The first
  // target of each kind owns the shortlink namespace: /download/<platform>
  // and /extension/<store> are one URL space per brand.
  return [
    ...readDownloads(entries.find((entry) => entry && entry.downloads)),
    ...readListings(entries.find((entry) => entry && entry.listings)),
  ];
}

/**
 * The generated page of each shortlink.
 * @param {Array<object>} entries - readTargetShortlinks output
 * @returns {Array<{ virtual: string, label: string, url: string, raw: string }>}
 */
function targetShortlinkPages(entries) {
  return entries.map((entry) => redirectPage({
    virtual: `omega-target-shortlinks${entry.url}.html`,
    label: entry.label,
    url: entry.url,
    redirect: entry.redirect,
    note: `Shortlink generated by @omega.js/web from ${entry.label} (#561).`,
  }));
}

module.exports = { readTargetShortlinks, targetShortlinkPages };
