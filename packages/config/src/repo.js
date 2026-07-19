/**
 * @omega.js/config repo — the SINGLE derivation of the brand's GitHub repo
 * name, shared by every surface that targets the brand repo (web
 * `omega deploy --direct`, the manager's github service setup/repo/pages).
 *
 * Chain: explicit `github.repo` → the `github.repo_website` URL's last path
 * segment → `brand.id`. repo_website already names the site repo for the
 * CMS routes, so a brand whose repo name differs from its brand id needs no
 * extra key. Born from the 2026-07-18 launch-night collision: the bare
 * brand-id fallback resolved brand "omega" to Omega-JS-Stack/omega — the
 * framework MONOREPO — instead of the brand repo omegajs.dev.
 */

/**
 * The brand repo's bare name (no owner; the owner is always github.org).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {string} Repo name ('' when nothing in the chain resolves).
 */
function brandRepoName(config) {
  const github = config?.github || {};
  const fromUrl = (github.repo_website || '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop();
  return github.repo || fromUrl || config?.brand?.id || '';
}

module.exports = { brandRepoName };
