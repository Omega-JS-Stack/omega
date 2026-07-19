/**
 * @omega.js/config repo — the SINGLE derivation of the brand's GitHub repo
 * (owner + name), shared by every surface that targets the brand repo (web
 * `omega deploy --direct`, the manager's github service setup/repo/pages).
 *
 * Name chain: explicit `github.repo` → the `repoWebsite` URL's repo →
 * `brand.id`. Owner chain: the `repoWebsite` URL's account → `github.org`.
 * This mirrors the legacy omega-manager orgMain/orgWebsite split (Ian
 * 2026-07-19): most ITW brands house the WEBSITE repo under the paid
 * company org (itw-creative-works) while the brand's own org carries its
 * public profile — here `github.org` keeps naming the brand's own org for
 * org-profile reconciliation and `repoWebsite` fully names the site repo.
 * Born from the 2026-07-18 launch-night collision: the bare brand-id
 * fallback resolved brand "omega" to Omega-JS-Stack/omega — the framework
 * MONOREPO — instead of the brand repo omegajs.dev.
 */

/**
 * Parse a GitHub repo URL (https or ssh; .git / trailing-slash tolerant).
 *
 * @param {string} url - e.g. https://github.com/ITW-Creative-Works/omegajs.dev
 * @returns {{ owner: string, name: string }} Empty strings when not a GitHub repo URL.
 */
function parseRepoWebsite(url) {
  const match = (url || '').match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1], name: match[2] } : { owner: '', name: '' };
}

/**
 * The brand repo's bare name (no owner).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {string} Repo name ('' when nothing in the chain resolves).
 */
function brandRepoName(config) {
  const github = config?.github || {};
  return github.repo || parseRepoWebsite(github.repoWebsite).name || config?.brand?.id || '';
}

/**
 * The brand repo's owner (GitHub org or user).
 *
 * @param {object} config - Composed omega config (brand + app layers).
 * @returns {string} Owner ('' when nothing in the chain resolves).
 */
function brandRepoOwner(config) {
  const github = config?.github || {};
  return parseRepoWebsite(github.repoWebsite).owner || github.org || '';
}

module.exports = { parseRepoWebsite, brandRepoName, brandRepoOwner };
