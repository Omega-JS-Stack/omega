/**
 * Consumer-project resolution for CLI commands: the standard directory
 * layout of an @omegajs/web consumer, and the omega.json5 → site-data
 * pipeline (loadConfig + toSiteGlobal).
 *
 * Consumer layout (scaffolded by `omega setup`):
 *   src/            - content (pages, _posts, _layouts, ...) — the Eleventy input
 *   src/assets/     - the consumer's asset layer (js/pages, css/pages, images)
 *   dist/           - build output (gitignored)
 *   .omega/         - build machinery (asset manifest, caches; gitignored)
 *   config/omega.json5
 */
const path = require('node:path');
const { loadConfig, toSiteGlobal, formatErrors } = require('@omegajs/config');

/**
 * The standard consumer directories, rooted at `cwd`.
 * @param {string} [cwd] - consumer project root (default process.cwd())
 * @returns {object}
 */
function consumerPaths(cwd) {
  const root = cwd || process.cwd();
  return {
    root,
    src: path.join(root, 'src'),
    assets: path.join(root, 'src', 'assets'),
    out: path.join(root, 'dist'),
    omega: path.join(root, '.omega'),
    manifest: path.join(root, '.omega', 'asset-manifest.json'),
  };
}

/**
 * Load and validate the consumer's omega.json5 for the `web` target and
 * shape it as the Jekyll-style site.* global.
 * @param {string} root - consumer project root
 * @returns {object} the site data object
 */
function loadSiteData(root) {
  const { config, errors } = loadConfig(root, 'web');

  if (errors && errors.length) {
    throw new Error(`config/omega.json5 is invalid:\n${formatErrors(errors)}`);
  }

  return toSiteGlobal(config);
}

module.exports = { consumerPaths, loadSiteData };
