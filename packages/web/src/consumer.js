/**
 * Consumer-project resolution for CLI commands: the standard directory
 * layout of an @omega.js/web consumer, and the omega.json5 → site-data
 * pipeline (loadConfig + toSiteGlobal).
 *
 * Consumer layout (scaffolded by every verb's ensureTarget):
 *   src/            - content (pages, _posts, _layouts, ...) — the Eleventy input
 *   src/assets/     - the consumer's asset layer (js/pages, css/pages, images)
 *   dist/           - build output (gitignored)
 *   .omega/         - build machinery (asset manifest, caches; gitignored)
 *   config/omega.json5
 */
const path = require('node:path');
const { loadConfig, toSiteGlobal, formatErrors } = require('@omega.js/config');

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
 * @param {object} [options]
 * @param {string} [options.environment] - The environment this load is FOR,
 *   which names the `omega.<environment>.json5` overlay that composes
 *   ([#856](https://github.com/Omega-JS-Stack/omega/issues/856)). The
 *   PRODUCTION lanes (`omega build`, both deploy lanes) name it, because the
 *   machine running the build answers `development` and a development override
 *   must never reach a published site. A dev boot omits it and takes that
 *   ambient answer, which is the whole point of it.
 * @returns {object} the site data object, carrying `target` = `{ name, type }` for THIS target
 */
function loadSiteData(root, options) {
  const { config, errors, name } = loadConfig(root, 'web', { environment: (options || {}).environment });

  if (errors && errors.length) {
    throw new Error(`config/omega.json5 is invalid:\n${formatErrors(errors)}`);
  }

  const site = toSiteGlobal(config);

  // WHICH target this build IS ([#887](https://github.com/Omega-JS-Stack/omega/issues/887)):
  // the loader already resolved the name from the target's folder (#886), and a
  // brand can run several websites, so a page cannot assume it is `web`. The
  // engine republishes this as the `site.target` build fact; `site.targets`
  // stays the MAP of every target the brand declares, a different question.
  site.target = { name: name, type: 'web' };

  return site;
}

module.exports = { consumerPaths, loadSiteData };
