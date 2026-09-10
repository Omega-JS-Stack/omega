/**
 * @omega.js/config desktop-artifacts — the SINGLE naming rule for a desktop
 * target's release assets ([#620](https://github.com/Omega-JS-Stack/omega/issues/620)).
 *
 * Two readers, one rule: @omega.js/desktop's `gulp/build-config` writes these
 * names into `dist/electron-builder.yml`'s artifactName templates, and
 * [site-global.js](site-global.js) derives the website's direct-download URLs
 * from them (`<releasesUrl>/download/<name>`). A second spelling anywhere is a
 * dead download button on a live site, so the derivation lives here and both
 * sides call it.
 *
 * Names carry NO version. That is the whole point: GitHub's
 * `/releases/latest/download/<asset>` only resolves when the asset name is the
 * same in every release, so releasing a desktop version never touches the
 * website and the published URLs never change. electron-updater is unaffected —
 * it reads the feed files (`latest-mac.yml`, `latest.yml`), which name whatever
 * artifact the build produced.
 *
 * Nothing puts an arch back into a name that omits one: electron-builder's
 * macro expander only REPLACES a `${arch}` token where it appears. So these
 * names support exactly the default build — a UNIVERSAL mac, a SINGLE linux
 * arch, and windows' multi-arch NSIS installer (which merges every arch into
 * one file anyway). @omega.js/desktop's build-config refuses any other arch set
 * rather than let two builds collide on one name; per-arch names are a future
 * additive change.
 */

// Every artifact a release publishes as a user-facing download, per platform,
// in the order the platform offers them — the FIRST is the platform's default
// (`/download/<platform>` leads with it, legacy UJM parity). The artifact keys
// ARE the website's URL vocabulary (`/download/<platform>/<artifact>`).
//
// Deliberately absent: the mac auto-update ZIP (electron-updater fetches it
// from the feed; nobody links it) and the snap (the Snap Store publishes it,
// so it is never a release asset).
const DESKTOP_ARTIFACTS = {
  mac:     { universal: { ext: 'dmg' } },
  windows: { universal: { ext: 'exe' } },
  linux:   { debian: { ext: 'deb' }, appimage: { ext: 'AppImage' } },
};

/**
 * The product name a desktop target packages under — the same derivation
 * @omega.js/desktop's `Manager.getConfig()` applies (`app.productName` ←
 * `brand.name`), so the website reads the name the packager actually used.
 *
 * @param {object} config - Desktop-shaped config (`{ app, brand }`).
 * @returns {string} Product name ('' when neither key resolves).
 */
function desktopProductName(config) {
  return config?.app?.productName || config?.brand?.name || '';
}

/**
 * A product name reduced to filename-safe characters. electron-builder's
 * `${productName}` keeps spaces, which become dots in NSIS output and behave
 * inconsistently across targets; hyphens are consistent everywhere.
 *
 * @param {string} productName - Raw product name ("Deployment Playground").
 * @returns {string} Sanitized name ("Deployment-Playground"), '' when empty.
 */
function sanitizeProductName(productName) {
  return String(productName || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * One artifact's versionless filename: `<Product>-<platform>-<artifact>.<ext>`.
 *
 * @param {string} productName - Raw product name (sanitized here).
 * @param {string} platform - Platform key (mac, windows, linux).
 * @param {string} artifact - Artifact key (universal, debian, appimage, …).
 * @param {string} [ext] - Extension override — pass electron-builder's literal
 *   `${ext}` to get a TEMPLATE that covers every target sharing the platform's
 *   fallback (mac's dmg + auto-update zip).
 * @returns {string} The filename ('' with no product name to build it from).
 */
function desktopArtifactName(productName, platform, artifact, ext) {
  const product = sanitizeProductName(productName);
  const extension = ext || DESKTOP_ARTIFACTS[platform]?.[artifact]?.ext;
  if (!product || !extension) return '';

  return `${product}-${platform}-${artifact}.${extension}`;
}

/**
 * Every published artifact's filename, keyed platform → artifact, in offer
 * order.
 *
 * @param {string} productName - Raw product name.
 * @returns {object} `{ mac: { universal: 'App-mac-universal.dmg' }, … }`, or
 *   `{}` when there is no product name to derive from.
 */
function desktopArtifactNames(productName) {
  if (!sanitizeProductName(productName)) return {};

  const names = {};
  for (const [platform, artifacts] of Object.entries(DESKTOP_ARTIFACTS)) {
    names[platform] = {};
    for (const artifact of Object.keys(artifacts)) {
      names[platform][artifact] = desktopArtifactName(productName, platform, artifact);
    }
  }

  return names;
}

module.exports = { DESKTOP_ARTIFACTS, desktopProductName, sanitizeProductName, desktopArtifactName, desktopArtifactNames };
